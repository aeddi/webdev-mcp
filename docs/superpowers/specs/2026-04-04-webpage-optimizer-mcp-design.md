# Webpage Optimizer MCP Server — Design Spec

## Overview

An MCP server that bridges a Claude agent to a live browser for webpage performance debugging and optimization. The tool instruments — the agent reasons. It exposes profiling, metrics, interaction simulation, and cross-browser rendering capabilities so the agent can diagnose slow rendering, memory leaks, network bottlenecks, and other performance issues, then correlate findings with source code.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Interface | MCP server | Native fit for Claude agents, structured tool definitions, zero integration code for consumers |
| Browser engine | Playwright + raw CDP | Playwright for browser lifecycle and cross-browser; raw CDP sessions for deep Chrome profiling |
| Language | TypeScript | First-class SDK for both Playwright and MCP |
| Session model | Stateful, single page | Agent controls lifecycle; one active page at a time; agent reloads when it needs a fresh start |
| Data handling | Hybrid (memory + disk + query layer) | Summaries in memory for fast reads, raw artifacts on disk, query dispatch for drilling in |
| Tool surface | Session-aware, ~19 focused tools | One tool per job, session intelligence reduces ceremony (auto-stop previous profile of same domain) |
| Auth | Cookie injection + interaction simulation | Covers both fast-path (injected cookies/headers) and full login flows |
| Deployment | Local-first, remote-ready | Build for local use, no hard localhost assumptions |

## Architecture

Four layers:

```
┌─────────────────────────────────────┐
│          MCP Server Layer           │  Tool definitions, request routing
├─────────────────────────────────────┤
│        Session Manager              │  Browser lifecycle, page state
├──────┬──────┬──────┬──────┬─────────┤
│Memory│Network│Render│ ...  │Lighthouse│  Domain modules (CDP subscriptions)
├──────┴──────┴──────┴──────┴─────────┤
│         Data Store                  │  Summaries in memory, artifacts on disk, query engine
└─────────────────────────────────────┘
```

**MCP Server Layer** — Thin. Defines tools, validates inputs, routes to domain modules, formats responses. No profiling logic.

**Session Manager** — Owns the Playwright browser instance and CDP session. Handles launch, navigation, reload, teardown. Tracks active domain modules. On navigation: signals modules to detach, navigates, reattaches CDP, signals modules to reattach.

**Domain Modules** — One per profiling domain. Each declares its CDP dependencies, manages its own start/stop lifecycle, produces summaries and raw artifacts, and registers query handlers.

**Data Store** — Shared service. In-memory profile records with summaries, raw artifacts on disk, query engine that dispatches to domain-specific handlers.

## Session Management

**Lazy launch** — Browser starts on first `navigate` call. No browser process running until needed.

**Page state** — One active page. Session manager holds:
- Playwright `BrowserContext` (cookies, headers, storage)
- Playwright `Page`
- Raw `CDPSession` attached to the page
- Registry of active domain modules

**Navigation flow:**
1. Signal active domain modules to detach/pause
2. Navigate the page
3. Reattach CDP session
4. Signal domain modules to reattach listeners
5. Return page load metrics (timing, status code, console errors during load)

**Cross-browser** — Firefox/WebKit instances are ephemeral: navigate, screenshot, tear down. No CDP profiling. Primary Chromium session stays alive.

**Teardown** — Explicit `close_session` tool or automatic on server shutdown. In-memory data flushed to disk before teardown.

## MCP Tool Surface

### Session & Navigation

| Tool | Description |
|---|---|
| `configure_browser` | Set viewport, device emulation, locale, user agent, extra headers. Optional — defaults to standard desktop Chrome. |
| `navigate` | Go to URL. Returns load timing, status code, console output during load. Lazily launches browser on first call. |
| `reload` | Reload current page. Same return shape as `navigate`. |
| `set_auth` | Inject cookies, headers, or localStorage values into the browser context. |
| `close_session` | Tear down browser, flush data to disk. |

### Interaction

| Tool | Description |
|---|---|
| `simulate_interaction` | Click, type, scroll, hover. Takes action type + selector/coordinates. Returns interaction timing + any layout shifts or long tasks triggered. |
| `screenshot` | Capture full page or element screenshot. Returns the image. Optional label for later comparison. |

### Profiling

| Tool | Description |
|---|---|
| `start_profiling` | Start profiling for a domain: `cpu`, `memory_allocation`, `rendering`. Auto-stops any previous session of the same domain. Returns session ID. Network is captured passively from page load (read via `get_network_log`); this tool covers domains that need explicit start/stop windows. |
| `stop_profiling` | Stop profiling session by ID. Returns summary (top functions, allocation rate, frame drops, etc.) + profile ID for querying. |
| `take_heap_snapshot` | Point-in-time heap snapshot. Returns summary (total size, top object types, retained size breakdown) + snapshot ID. |
| `get_coverage` | JS and/or CSS coverage. Returns per-file used/unused percentages + coverage ID for drilling in. |

### Metrics (point-in-time reads)

| Tool | Description |
|---|---|
| `get_web_vitals` | Current LCP, CLS, INP values. |
| `get_dom_stats` | Node count, max depth, detached nodes, element distribution by tag. |
| `get_console_log` | Console messages since page load or last clear. Filterable by level. |
| `get_network_log` | Network requests since page load. Timing, size, cache status. Filterable. |

### Analysis

| Tool | Description |
|---|---|
| `query_profile` | Drill into a profiling artifact by ID with domain-specific filters. Dispatches to the domain module's query handler. |
| `compare_snapshots` | Compare two heap snapshots by ID. Returns objects added, removed, grown. |
| `run_lighthouse` | Full Lighthouse audit. Returns scores + top opportunities + diagnostics. Raw report saved to disk. |

### Cross-browser

| Tool | Description |
|---|---|
| `cross_browser_screenshot` | Load current URL in Firefox and/or WebKit, capture screenshots. Optional visual diff against Chromium. |

## Domain Modules

All modules implement a shared interface:

```typescript
interface DomainModule {
  name: string;
  cdpDomains: string[];
  attach(cdp: CDPSession): void;
  detach(): void;
}
```

### cpu
CDP domains: `Profiler`. Start/stop CPU profiling, collect call trees with timing. Query filters: `{ minSelfTime?, functionName?, url? }`.

### memory
CDP domains: `HeapProfiler`, `Runtime`. Heap snapshots, allocation tracking, GC event monitoring. Query filters: `{ objectType?, minRetainedSize? }`. Also powers `compare_snapshots`.

### network
CDP domains: `Network`. Passively captures all requests from page load — no explicit start/stop needed. Records timing breakdown (DNS, connect, TLS, TTFB, download), size, cache status, initiator chain, render-blocking flag. Read via `get_network_log`; drill into details via `query_profile`. Query filters: `{ resourceType?, minSize?, blocking?, domain? }`.

### rendering
CDP domains: `Performance`, `LayerTree`, `Animation`. Tracks layout shifts, long animation frames, paint timing, compositor layers, forced reflows. Query filters: `{ minDuration?, type?, selector? }`.

### web-vitals
CDP domains: `Performance` + PerformanceObserver injection via `page.evaluate`. Passively collects LCP, CLS, INP from page load. No start/stop.

### dom
CDP domains: `DOM`, `CSS`. Node count, tree depth, detached nodes, selector complexity. On-demand reads.

### coverage
CDP domains: `Profiler`, `CSS`. JS/CSS coverage on demand. Query filters: `{ url?, minUnusedPercent? }`.

### console
CDP domains: `Runtime`. Passive capture of `console.*` calls and unhandled exceptions with timestamps and stack traces.

### interaction
Uses Playwright's high-level API (click, type, scroll) rather than CDP. After each interaction, reads from rendering/web-vitals modules to report triggered layout shifts, long tasks, INP impact.

### lighthouse
Uses Lighthouse's Node API programmatically. Runs in a separate Chromium instance (Lighthouse needs its own browser context). Returns structured scores/audits, raw report to disk.

### cross-browser
Uses Playwright to launch Firefox/WebKit, navigate with same viewport config, capture screenshots. Optional pixel-diff comparison using a lightweight image diff library.

## Data Store & Query Layer

### In-memory tier

Profile records indexed by ID:

```typescript
interface ProfileRecord {
  id: string;
  domain: string;
  type: string;
  timestamp: number;
  summary: Record<string, any>;
  artifactPath?: string;
}
```

Summary is what the agent receives immediately on profile stop or snapshot. Contains enough signal to decide whether to dig deeper.

### Disk tier

Raw artifacts stored in a configurable output directory (default `./webpage-optimizer-data/`). Named `{domain}-{id}-{timestamp}.{ext}`. File types:
- Heap snapshots: `.heapsnapshot`
- CPU profiles: `.cpuprofile`
- Traces: `.json`
- Lighthouse reports: `.json`
- Screenshots: `.png`
- Coverage reports: `.json`

### Query dispatch

`query_profile(id, filter)` flow:
1. Look up `ProfileRecord` by ID
2. Determine domain from record
3. Dispatch to domain module's query handler with filter and artifact path
4. Query handler reads raw artifact, applies filter, returns structured results

Domain-specific filter shapes:
- **cpu**: `{ minSelfTime?, functionName?, url? }`
- **memory**: `{ objectType?, minRetainedSize? }`
- **network**: `{ resourceType?, minSize?, blocking?, domain? }`
- **rendering**: `{ minDuration?, type?, selector? }`
- **coverage**: `{ url?, minUnusedPercent? }`

### Cleanup

Data persists until session close or explicit cleanup. On `close_session`, in-memory records are written to a manifest file alongside artifacts so the data directory is self-describing after server shutdown.

## Error Handling

Every tool response includes `success: boolean`. On failure, an `error` object:

```typescript
interface ToolError {
  category: "session" | "navigation" | "cdp" | "profiling" | "query" | "internal";
  message: string;
  details: any;
}
```

Principles:
- **Surface errors honestly.** CDP errors, HTTP status codes, Lighthouse stderr — passed through to the agent.
- **No silent degradation.** If a capability isn't available in the current context, return a clear error.
- **Fail gracefully on crashes.** If the browser crashes mid-profiling, save collected data, return error explaining what happened. Agent can re-launch with `navigate`.
- **Helpful query errors.** Bad filter fields return the valid fields for that domain so the agent can self-correct.
- **No retry logic.** The agent decides whether and how to retry.

## Project Structure

```
claude-webpage-optimizer/
├── src/
│   ├── server.ts                  # MCP server setup, tool registration
│   ├── session/
│   │   └── manager.ts             # Browser lifecycle, CDP session, page state
│   ├── domains/
│   │   ├── types.ts               # DomainModule interface, shared types
│   │   ├── cpu.ts
│   │   ├── memory.ts
│   │   ├── network.ts
│   │   ├── rendering.ts
│   │   ├── web-vitals.ts
│   │   ├── dom.ts
│   │   ├── coverage.ts
│   │   ├── console.ts
│   │   ├── interaction.ts
│   │   ├── lighthouse.ts
│   │   └── cross-browser.ts
│   ├── store/
│   │   ├── data-store.ts          # In-memory records + disk artifact management
│   │   └── query-engine.ts        # Query dispatch to domain handlers
│   └── tools/
│       ├── session-tools.ts       # configure_browser, navigate, reload, set_auth, close_session
│       ├── interaction-tools.ts   # simulate_interaction, screenshot
│       ├── profiling-tools.ts     # start_profiling, stop_profiling, take_heap_snapshot, get_coverage
│       ├── metrics-tools.ts       # get_web_vitals, get_dom_stats, get_console_log, get_network_log
│       └── analysis-tools.ts      # query_profile, compare_snapshots, run_lighthouse, cross_browser_screenshot
├── tests/
│   └── (mirrors src/ structure)
├── package.json
├── tsconfig.json
└── README.md
```
