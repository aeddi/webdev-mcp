# webdev-mcp

An MCP server that gives any AI agent a full browser DevTools toolkit: profiling, network inspection, heap analysis, Lighthouse audits, cross-browser screenshots, and more.

It launches a headless Chromium via Playwright, exposes Chrome DevTools Protocol data through 19 MCP tools, and saves profiling artifacts to disk for later analysis.

## Features

**Session & Navigation** -- launch a headless browser, navigate to any URL, configure viewport/device emulation, inject auth (cookies, headers, localStorage), reload, and tear down.

**Metrics** -- capture console logs (filterable by level) and network requests (filterable by resource type, size, blocking status, domain).

**Profiling** -- start/stop CPU profiling, memory allocation sampling, or rendering performance tracing. Take V8 heap snapshots, compare two snapshots to detect leaks. Query any saved profile with domain-specific filters.

**Analysis** -- Core Web Vitals (LCP, CLS, INP), DOM statistics (node count, tree depth, detached nodes, tag distribution), JS/CSS code coverage.

**Interaction** -- simulate clicks, typing, scrolling, and hover. Capture viewport or element screenshots.

**Auditing** -- run Lighthouse audits (performance, accessibility, best practices, SEO) with mobile/desktop form factors.

**Cross-Browser** -- capture screenshots in Firefox and/or WebKit, compute visual diffs against Chromium.

## Tools

| Tool                       | Description                                                 |
| -------------------------- | ----------------------------------------------------------- |
| `configure_browser`        | Set viewport, device emulation, locale, user agent, headers |
| `navigate`                 | Navigate to a URL, returns load timing and HTTP status      |
| `reload`                   | Reload the current page                                     |
| `set_auth`                 | Inject cookies, HTTP headers, or localStorage values        |
| `close_session`            | Tear down the browser and flush data to disk                |
| `get_console_log`          | Console messages since page load, filterable by level       |
| `get_network_log`          | Network requests with timing, size, cache status            |
| `start_profiling`          | Start CPU, memory allocation, or rendering profiling        |
| `stop_profiling`           | Stop profiling and save the captured profile                |
| `take_heap_snapshot`       | Point-in-time V8 heap snapshot with summary                 |
| `compare_snapshots`        | Diff two heap snapshots (added, removed, grown objects)     |
| `get_web_vitals`           | Core Web Vitals: LCP, CLS, INP                              |
| `get_dom_stats`            | Node count, max depth, detached nodes, tag distribution     |
| `get_coverage`             | JS and/or CSS code coverage per file                        |
| `simulate_interaction`     | Click, type, scroll, or hover with timing and layout impact |
| `screenshot`               | Capture viewport, full page, or element screenshot          |
| `run_lighthouse`           | Full Lighthouse audit with scores and opportunities         |
| `cross_browser_screenshot` | Firefox/WebKit screenshots with optional visual diff        |
| `query_profile`            | Drill into any saved profile with domain-specific filters   |

## Requirements

- Node.js >= 18
- Playwright browsers (installed automatically or via `npx playwright install`)

## Installation

```bash
git clone <repo-url> && cd webdev-mcp
npm install
npx playwright install
npm run build
```

### Claude Code

Register the MCP server with `claude mcp add`:

```bash
claude mcp add webdev -- node /absolute/path/to/webdev-mcp/dist/server.js
```

This stores the configuration in `~/.claude.json` (local scope by default). Use `--scope project` to write to `.mcp.json` at the repo root instead (version-controlled, shared with teammates).

Verify the server is registered:

```bash
claude mcp list
```

## Configuration

| Environment Variable | Default             | Description                                   |
| -------------------- | ------------------- | --------------------------------------------- |
| `WPO_OUTPUT_DIR`     | `./webdev-mcp-data` | Directory for profiling artifacts and reports |

## Usage Examples

### Performance audit

```
navigate to https://example.com
run_lighthouse with categories: ["performance", "accessibility"]
get_web_vitals
get_coverage with type: "both"
```

### Memory leak detection

```
navigate to https://example.com
take_heap_snapshot                    # baseline
simulate_interaction click "#load-more"
take_heap_snapshot                    # after action
compare_snapshots snapshotA snapshotB # see what grew
```

### CPU profiling

```
navigate to https://example.com
start_profiling domain: "cpu"
simulate_interaction click "#heavy-button"
stop_profiling id: <session-id>
query_profile id: <profile-id> filter: { functionName: "render" }
```

### Cross-browser testing

```
navigate to https://example.com
cross_browser_screenshot browsers: ["firefox", "webkit"] diff: true
```

## Development

```bash
npm run dev          # run with tsx (no build step)
npm test             # run tests
npm run test:watch   # watch mode
npm run build        # compile TypeScript to dist/
```

## License

MIT
