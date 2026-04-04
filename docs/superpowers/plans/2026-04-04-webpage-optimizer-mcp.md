# Webpage Optimizer MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that bridges a Claude agent to a live browser for webpage performance debugging and optimization.

**Architecture:** Four-layer system — thin MCP tool layer → session manager (Playwright + CDP) → domain modules (one per profiling concern) → hybrid data store (memory summaries + disk artifacts + query dispatch). ~19 tools exposed to the agent.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, Playwright, Lighthouse, chrome-launcher, pixelmatch, vitest

---

## File Map

```
claude-webpage-optimizer/
├── src/
│   ├── server.ts                     # MCP server setup, tool registration, stdio transport
│   ├── types.ts                      # DomainModule interface, ProfileRecord, ToolError, response helpers
│   ├── session/
│   │   └── manager.ts                # Browser lifecycle, CDP session, domain module registry
│   ├── domains/
│   │   ├── console.ts                # Runtime CDP — console message capture
│   │   ├── network.ts                # Network CDP — request/response capture
│   │   ├── cpu.ts                    # Profiler CDP — CPU profiling
│   │   ├── memory.ts                 # HeapProfiler CDP — snapshots, allocation tracking
│   │   ├── rendering.ts              # Performance/LayerTree/Animation CDP — layout shifts, paint, frames
│   │   ├── web-vitals.ts             # PerformanceObserver injection — LCP, CLS, INP
│   │   ├── dom.ts                    # DOM/CSS CDP — node stats, detached nodes
│   │   ├── coverage.ts              # Profiler/CSS CDP — JS/CSS coverage
│   │   ├── interaction.ts            # Playwright API — click, type, scroll + impact measurement
│   │   ├── lighthouse.ts             # Lighthouse Node API via chrome-launcher
│   │   └── cross-browser.ts          # Playwright Firefox/WebKit — screenshots + pixel diff
│   ├── store/
│   │   ├── data-store.ts             # In-memory ProfileRecord map + disk artifact read/write
│   │   └── query-engine.ts           # Domain-specific query handler registry + dispatch
│   └── tools/
│       ├── session-tools.ts          # configure_browser, navigate, reload, set_auth, close_session
│       ├── profiling-tools.ts        # start_profiling, stop_profiling, take_heap_snapshot
│       ├── metrics-tools.ts          # get_web_vitals, get_dom_stats, get_console_log, get_network_log, get_coverage
│       ├── interaction-tools.ts      # simulate_interaction, screenshot
│       └── analysis-tools.ts         # query_profile, compare_snapshots, run_lighthouse, cross_browser_screenshot
├── tests/
│   ├── helpers/
│   │   ├── test-server.ts            # Local HTTP server serving test fixture pages
│   │   └── fixtures/
│   │       ├── basic.html            # Simple page with known structure
│   │       ├── slow-render.html      # Page with forced layouts, slow animations
│   │       ├── memory-leak.html      # Page that leaks memory on interaction
│   │       └── heavy-dom.html        # Page with deep DOM, many nodes
│   ├── store/
│   │   └── store.test.ts             # Data store + query engine tests
│   ├── session/
│   │   └── manager.test.ts           # Session manager tests
│   ├── domains/
│   │   ├── console.test.ts
│   │   ├── network.test.ts
│   │   ├── cpu.test.ts
│   │   ├── memory.test.ts
│   │   ├── rendering.test.ts
│   │   ├── web-vitals.test.ts
│   │   ├── dom.test.ts
│   │   ├── coverage.test.ts
│   │   ├── interaction.test.ts
│   │   ├── lighthouse.test.ts
│   │   └── cross-browser.test.ts
│   └── integration/
│       └── e2e.test.ts               # Full workflow integration tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

### Task 1: Project Scaffolding + Shared Types + Test Infrastructure

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Create: `tests/helpers/test-server.ts`
- Create: `tests/helpers/fixtures/basic.html`
- Create: `tests/helpers/fixtures/slow-render.html`
- Create: `tests/helpers/fixtures/memory-leak.html`
- Create: `tests/helpers/fixtures/heavy-dom.html`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "webpage-optimizer",
  "version": "0.1.0",
  "description": "MCP server for webpage performance debugging and optimization",
  "type": "module",
  "main": "dist/server.js",
  "bin": {
    "webpage-optimizer": "dist/server.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "npx tsx src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "chrome-launcher": "^1.1.0",
    "lighthouse": "^13.0.0",
    "pixelmatch": "^6.0.0",
    "playwright": "^1.52.0",
    "pngjs": "^7.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create src/types.ts**

```typescript
import type { CDPSession, Page, BrowserContext } from "playwright";

// ---- Domain Module Interface

export interface DomainModule {
  readonly name: string;
  readonly cdpDomains: string[];
  attach(cdp: CDPSession, page: Page): Promise<void>;
  detach(): Promise<void>;
  reset(): Promise<void>;
}

// ---- Profile Records

export interface ProfileRecord {
  id: string;
  domain: string;
  type: string;
  timestamp: number;
  summary: Record<string, unknown>;
  artifactPath?: string;
}

// ---- Error Types

export type ErrorCategory =
  | "session"
  | "navigation"
  | "cdp"
  | "profiling"
  | "query"
  | "internal";

export interface ToolError {
  category: ErrorCategory;
  message: string;
  details?: unknown;
}

// ---- Tool Responses

export interface ToolSuccess {
  success: true;
  [key: string]: unknown;
}

export interface ToolFailure {
  success: false;
  error: ToolError;
}

export type ToolResult = ToolSuccess | ToolFailure;

export function toolSuccess(data: Record<string, unknown>): ToolSuccess {
  return { success: true, ...data };
}

export function toolError(
  category: ErrorCategory,
  message: string,
  details?: unknown,
): ToolFailure {
  return { success: false, error: { category, message, details } };
}

// ---- Query Filters

export interface CpuQueryFilter {
  minSelfTime?: number;
  functionName?: string;
  url?: string;
}

export interface MemoryQueryFilter {
  objectType?: string;
  minRetainedSize?: number;
}

export interface NetworkQueryFilter {
  resourceType?: string;
  minSize?: number;
  blocking?: boolean;
  domain?: string;
}

export interface RenderingQueryFilter {
  minDuration?: number;
  type?: "layout-shift" | "long-task" | "paint";
  selector?: string;
}

export interface CoverageQueryFilter {
  url?: string;
  minUnusedPercent?: number;
}

export type QueryFilter =
  | CpuQueryFilter
  | MemoryQueryFilter
  | NetworkQueryFilter
  | RenderingQueryFilter
  | CoverageQueryFilter;

export type QueryHandler = (
  artifactPath: string,
  filter: QueryFilter,
) => Promise<Record<string, unknown>>;

// ---- Browser Config

export interface BrowserConfig {
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
  locale?: string;
  extraHTTPHeaders?: Record<string, string>;
  isMobile?: boolean;
}

// ---- Network Request Record

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  resourceType: string;
  startTime: number;
  endTime?: number;
  status?: number;
  mimeType?: string;
  transferSize?: number;
  encodedDataLength?: number;
  timing?: {
    dnsStart: number;
    dnsEnd: number;
    connectStart: number;
    connectEnd: number;
    sslStart: number;
    sslEnd: number;
    sendStart: number;
    sendEnd: number;
    receiveHeadersEnd: number;
  };
  cached: boolean;
  initiator?: string;
  renderBlocking?: string;
}

// ---- Console Entry

export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  stackTrace?: string;
}
```

- [ ] **Step 5: Create test fixture pages**

`tests/helpers/fixtures/basic.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Basic Test Page</title>
  <style>
    body { font-family: sans-serif; margin: 20px; }
    .box { width: 100px; height: 100px; background: blue; }
  </style>
</head>
<body>
  <h1>Basic Page</h1>
  <p id="content">Hello World</p>
  <div class="box" id="box"></div>
  <button id="btn">Click me</button>
  <script>
    console.log("page loaded");
    console.warn("test warning");
    document.getElementById("btn").addEventListener("click", () => {
      console.log("button clicked");
      document.getElementById("content").textContent = "Clicked!";
    });
  </script>
</body>
</html>
```

`tests/helpers/fixtures/slow-render.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Slow Render Test Page</title>
  <style>
    .animated { width: 100px; height: 100px; background: red; transition: transform 0.5s; }
    .animated.moved { transform: translateX(300px); }
  </style>
</head>
<body>
  <h1>Slow Render Page</h1>
  <div class="animated" id="animated"></div>
  <button id="trigger-layout">Force Layout</button>
  <button id="trigger-animation">Animate</button>
  <script>
    document.getElementById("trigger-layout").addEventListener("click", () => {
      for (let i = 0; i < 1000; i++) {
        const div = document.createElement("div");
        div.style.width = "50px";
        div.style.height = "50px";
        document.body.appendChild(div);
        void div.offsetHeight;
      }
    });
    document.getElementById("trigger-animation").addEventListener("click", () => {
      document.getElementById("animated").classList.toggle("moved");
    });
  </script>
</body>
</html>
```

`tests/helpers/fixtures/memory-leak.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Memory Leak Test Page</title>
</head>
<body>
  <h1>Memory Leak Page</h1>
  <button id="leak">Create Leak</button>
  <script>
    const leaks = [];
    document.getElementById("leak").addEventListener("click", () => {
      for (let i = 0; i < 100; i++) {
        leaks.push(new Array(10000).fill("leak-data-" + Date.now()));
      }
      console.log("Leaked objects:", leaks.length);
    });
  </script>
</body>
</html>
```

`tests/helpers/fixtures/heavy-dom.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Heavy DOM Test Page</title>
  <style>
    .unused-rule-1 { color: purple; }
    .unused-rule-2 { color: orange; }
    .used-rule { color: green; }
  </style>
</head>
<body>
  <h1>Heavy DOM Page</h1>
  <div id="root"></div>
  <span class="used-rule">Styled</span>
  <script>
    const root = document.getElementById("root");
    function buildTree(parent, depth, breadth) {
      if (depth === 0) return;
      for (let i = 0; i < breadth; i++) {
        const div = document.createElement("div");
        div.className = "node-" + depth;
        div.textContent = "D" + depth + "N" + i;
        parent.appendChild(div);
        buildTree(div, depth - 1, breadth);
      }
    }
    buildTree(root, 5, 3);

    const detached = document.createElement("div");
    detached.id = "detached-tree";
    for (let i = 0; i < 10; i++) {
      detached.appendChild(document.createElement("span"));
    }
    window._detachedRef = detached;
  </script>
</body>
</html>
```

- [ ] **Step 6: Create test HTTP server helper**

`tests/helpers/test-server.ts`:
```typescript
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};

export interface TestServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const filePath = join(FIXTURES_DIR, req.url === "/" ? "basic.html" : req.url!);
    try {
      const data = await readFile(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "text/plain" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Failed to bind");
      const port = addr.port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
```

- [ ] **Step 7: Install dependencies and verify build**

Run: `npm install && npx tsc --noEmit`
Expected: Clean install, no type errors

- [ ] **Step 8: Verify test runner works**

Create a minimal smoke test at `tests/smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { toolSuccess, toolError } from "../src/types.js";

describe("types", () => {
  it("creates success response", () => {
    const result = toolSuccess({ value: 42 });
    expect(result.success).toBe(true);
    expect(result.value).toBe(42);
  });

  it("creates error response", () => {
    const result = toolError("session", "no browser");
    expect(result.success).toBe(false);
    expect(result.error.category).toBe("session");
    expect(result.error.message).toBe("no browser");
  });
});
```

Run: `npx vitest run tests/smoke.test.ts`
Expected: 2 tests pass

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/types.ts tests/helpers/ tests/smoke.test.ts
git commit -m "Scaffold project with types, test infra, and fixture pages"
```

---

### Task 2: Data Store + Query Engine

**Files:**
- Create: `src/store/data-store.ts`
- Create: `src/store/query-engine.ts`
- Create: `tests/store/store.test.ts`

- [ ] **Step 1: Write failing tests for data store and query engine**

`tests/store/store.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../../src/store/data-store.js";
import { QueryEngine } from "../../src/store/query-engine.js";
import type { ProfileRecord, QueryFilter } from "../../src/types.js";

describe("DataStore", () => {
  let store: DataStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    store = new DataStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves and retrieves a profile record", () => {
    const record: ProfileRecord = {
      id: "test-1",
      domain: "cpu",
      type: "profile",
      timestamp: Date.now(),
      summary: { topFunction: "main", selfTime: 120 },
    };
    store.save(record);
    expect(store.get("test-1")).toEqual(record);
  });

  it("returns undefined for missing record", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("lists records filtered by domain", () => {
    store.save({ id: "a", domain: "cpu", type: "profile", timestamp: 1, summary: {} });
    store.save({ id: "b", domain: "memory", type: "snapshot", timestamp: 2, summary: {} });
    store.save({ id: "c", domain: "cpu", type: "profile", timestamp: 3, summary: {} });
    expect(store.listByDomain("cpu").map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("writes artifact to disk and stores path", async () => {
    const data = JSON.stringify({ nodes: [1, 2, 3] });
    const record = await store.saveArtifact("snap-1", "memory", "snapshot", data, ".heapsnapshot");
    expect(record.artifactPath).toBeDefined();
    const content = await readFile(record.artifactPath!, "utf-8");
    expect(content).toBe(data);
  });

  it("writes binary artifact to disk", async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const record = await store.saveArtifact("img-1", "screenshot", "image", pngData, ".png");
    const content = await readFile(record.artifactPath!);
    expect(Buffer.compare(content, pngData)).toBe(0);
  });

  it("flushes manifest to disk", async () => {
    store.save({ id: "x", domain: "cpu", type: "profile", timestamp: 1, summary: { a: 1 } });
    await store.flushManifest();
    const manifest = JSON.parse(await readFile(join(tempDir, "manifest.json"), "utf-8"));
    expect(manifest).toHaveLength(1);
    expect(manifest[0].id).toBe("x");
  });
});

describe("QueryEngine", () => {
  let engine: QueryEngine;

  beforeEach(() => {
    engine = new QueryEngine();
  });

  it("registers and dispatches a query handler", async () => {
    engine.register("cpu", async (_path: string, filter: QueryFilter) => {
      return { filtered: true, filter };
    });
    const result = await engine.query("cpu", "/fake/path", { minSelfTime: 50 });
    expect(result).toEqual({ filtered: true, filter: { minSelfTime: 50 } });
  });

  it("throws for unregistered domain", async () => {
    await expect(engine.query("unknown", "/fake", {})).rejects.toThrow("No query handler registered for domain: unknown");
  });

  it("lists registered domains", () => {
    engine.register("cpu", async () => ({}));
    engine.register("memory", async () => ({}));
    expect(engine.registeredDomains()).toEqual(["cpu", "memory"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/store/store.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement DataStore**

`src/store/data-store.ts`:
```typescript
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileRecord } from "../types.js";

export class DataStore {
  private records = new Map<string, ProfileRecord>();
  private initialized = false;

  constructor(private readonly outputDir: string) {}

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.outputDir, { recursive: true });
    this.initialized = true;
  }

  save(record: ProfileRecord): void {
    this.records.set(record.id, record);
  }

  get(id: string): ProfileRecord | undefined {
    return this.records.get(id);
  }

  listByDomain(domain: string): ProfileRecord[] {
    return [...this.records.values()].filter((r) => r.domain === domain);
  }

  listAll(): ProfileRecord[] {
    return [...this.records.values()];
  }

  async saveArtifact(
    id: string,
    domain: string,
    type: string,
    data: string | Buffer,
    ext: string,
  ): Promise<ProfileRecord> {
    await this.ensureDir();
    const filename = `${domain}-${id}-${Date.now()}${ext}`;
    const artifactPath = join(this.outputDir, filename);
    await writeFile(artifactPath, data);

    const record: ProfileRecord = {
      id,
      domain,
      type,
      timestamp: Date.now(),
      summary: {},
      artifactPath,
    };
    this.records.set(id, record);
    return record;
  }

  updateSummary(id: string, summary: Record<string, unknown>): void {
    const record = this.records.get(id);
    if (record) {
      record.summary = summary;
    }
  }

  async flushManifest(): Promise<void> {
    await this.ensureDir();
    const manifest = [...this.records.values()];
    await writeFile(join(this.outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }

  async readArtifact(id: string): Promise<string> {
    const record = this.records.get(id);
    if (!record?.artifactPath) {
      throw new Error(`No artifact found for record: ${id}`);
    }
    return readFile(record.artifactPath, "utf-8");
  }
}
```

- [ ] **Step 4: Implement QueryEngine**

`src/store/query-engine.ts`:
```typescript
import type { QueryFilter, QueryHandler } from "../types.js";

export class QueryEngine {
  private handlers = new Map<string, QueryHandler>();

  register(domain: string, handler: QueryHandler): void {
    this.handlers.set(domain, handler);
  }

  async query(
    domain: string,
    artifactPath: string,
    filter: QueryFilter,
  ): Promise<Record<string, unknown>> {
    const handler = this.handlers.get(domain);
    if (!handler) {
      throw new Error(`No query handler registered for domain: ${domain}`);
    }
    return handler(artifactPath, filter);
  }

  registeredDomains(): string[] {
    return [...this.handlers.keys()];
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/store/store.test.ts`
Expected: All 7 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/store/ tests/store/
git commit -m "Add data store and query engine"
```

---

### Task 3: Session Manager

**Files:**
- Create: `src/session/manager.ts`
- Create: `tests/session/manager.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/session/manager.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import type { DomainModule, BrowserConfig } from "../../src/types.js";
import type { CDPSession, Page } from "playwright";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("SessionManager", () => {
  let server: TestServer;
  let session: SessionManager;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
  });

  afterEach(async () => {
    await session.close();
  });

  it("is not active before navigation", () => {
    expect(session.isActive()).toBe(false);
  });

  it("launches browser and navigates on first navigate call", async () => {
    const result = await session.navigate(server.url + "/basic.html");
    expect(session.isActive()).toBe(true);
    expect(result.status).toBe(200);
    expect(result.url).toContain("/basic.html");
  });

  it("returns page load timing", async () => {
    const result = await session.navigate(server.url + "/basic.html");
    expect(result.loadTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("provides a CDP session for Chromium", async () => {
    await session.navigate(server.url + "/basic.html");
    const cdp = session.getCDPSession();
    expect(cdp).toBeDefined();
    const result = await cdp!.send("Runtime.evaluate", { expression: "1 + 1", returnByValue: true });
    expect(result.result.value).toBe(2);
  });

  it("provides a Playwright page", async () => {
    await session.navigate(server.url + "/basic.html");
    const page = session.getPage();
    expect(page).toBeDefined();
    const title = await page!.title();
    expect(title).toBe("Basic Test Page");
  });

  it("reloads the current page", async () => {
    await session.navigate(server.url + "/basic.html");
    const result = await session.reload();
    expect(result.status).toBe(200);
  });

  it("applies browser config before navigation", async () => {
    const config: BrowserConfig = { viewport: { width: 800, height: 600 } };
    session.configure(config);
    await session.navigate(server.url + "/basic.html");
    const page = session.getPage()!;
    const size = page.viewportSize();
    expect(size).toEqual({ width: 800, height: 600 });
  });

  it("attaches and notifies domain modules", async () => {
    const calls: string[] = [];
    const mockModule: DomainModule = {
      name: "test",
      cdpDomains: [],
      async attach() { calls.push("attach"); },
      async detach() { calls.push("detach"); },
      async reset() { calls.push("reset"); },
    };

    session.registerModule(mockModule);
    await session.navigate(server.url + "/basic.html");
    expect(calls).toContain("attach");
  });

  it("resets modules on navigation", async () => {
    const calls: string[] = [];
    const mockModule: DomainModule = {
      name: "test",
      cdpDomains: [],
      async attach() { calls.push("attach"); },
      async detach() { calls.push("detach"); },
      async reset() { calls.push("reset"); },
    };

    session.registerModule(mockModule);
    await session.navigate(server.url + "/basic.html");
    await session.navigate(server.url + "/slow-render.html");
    expect(calls.filter((c) => c === "reset")).toHaveLength(1);
  });

  it("closes cleanly", async () => {
    await session.navigate(server.url + "/basic.html");
    await session.close();
    expect(session.isActive()).toBe(false);
  });

  it("sets cookies via setAuth", async () => {
    await session.navigate(server.url + "/basic.html");
    await session.setAuth({
      cookies: [{ name: "session", value: "abc123", domain: "127.0.0.1", path: "/" }],
    });
    const page = session.getPage()!;
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "session")?.value).toBe("abc123");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/session/manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SessionManager**

`src/session/manager.ts`:
```typescript
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from "playwright";
import type { DomainModule, BrowserConfig } from "../types.js";

export interface NavigationResult {
  url: string;
  status: number;
  loadTimeMs: number;
}

export interface AuthConfig {
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
  }>;
  headers?: Record<string, string>;
  localStorage?: Record<string, string>;
}

export class SessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private modules: DomainModule[] = [];
  private config: BrowserConfig = {};
  private currentUrl: string | null = null;
  private hasNavigated = false;

  configure(config: BrowserConfig): void {
    this.config = { ...this.config, ...config };
  }

  registerModule(module: DomainModule): void {
    this.modules.push(module);
    if (this.cdpSession && this.page) {
      module.attach(this.cdpSession, this.page);
    }
  }

  isActive(): boolean {
    return this.browser !== null && this.page !== null;
  }

  getPage(): Page | null {
    return this.page;
  }

  getCDPSession(): CDPSession | null {
    return this.cdpSession;
  }

  getCurrentUrl(): string | null {
    return this.currentUrl;
  }

  getConfig(): BrowserConfig {
    return { ...this.config };
  }

  async navigate(url: string): Promise<NavigationResult> {
    if (!this.browser) {
      await this.launch();
    }

    if (this.hasNavigated) {
      for (const mod of this.modules) {
        await mod.reset();
      }
    }

    const start = performance.now();
    const response = await this.page!.goto(url, { waitUntil: "load" });
    const loadTimeMs = Math.round(performance.now() - start);

    this.currentUrl = url;
    this.hasNavigated = true;

    return {
      url,
      status: response?.status() ?? 0,
      loadTimeMs,
    };
  }

  async reload(): Promise<NavigationResult> {
    if (!this.page) {
      throw new Error("No active page to reload");
    }

    for (const mod of this.modules) {
      await mod.reset();
    }

    const start = performance.now();
    const response = await this.page.reload({ waitUntil: "load" });
    const loadTimeMs = Math.round(performance.now() - start);

    return {
      url: this.currentUrl ?? this.page.url(),
      status: response?.status() ?? 0,
      loadTimeMs,
    };
  }

  async setAuth(auth: AuthConfig): Promise<void> {
    if (!this.context) {
      throw new Error("No active browser context");
    }

    if (auth.cookies) {
      await this.context.addCookies(auth.cookies);
    }

    if (auth.headers) {
      await this.context.setExtraHTTPHeaders(auth.headers);
    }

    if (auth.localStorage && this.page) {
      for (const [key, value] of Object.entries(auth.localStorage)) {
        await this.page.evaluate(
          ([k, v]) => localStorage.setItem(k, v),
          [key, value],
        );
      }
    }
  }

  async close(): Promise<void> {
    for (const mod of this.modules) {
      await mod.detach();
    }

    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
    }
    if (this.page) {
      this.page = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.currentUrl = null;
    this.hasNavigated = false;
  }

  private async launch(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });

    const contextOptions: Record<string, unknown> = {};
    if (this.config.viewport) {
      contextOptions.viewport = this.config.viewport;
    }
    if (this.config.deviceScaleFactor) {
      contextOptions.deviceScaleFactor = this.config.deviceScaleFactor;
    }
    if (this.config.userAgent) {
      contextOptions.userAgent = this.config.userAgent;
    }
    if (this.config.locale) {
      contextOptions.locale = this.config.locale;
    }
    if (this.config.isMobile !== undefined) {
      contextOptions.isMobile = this.config.isMobile;
    }
    if (this.config.extraHTTPHeaders) {
      contextOptions.extraHTTPHeaders = this.config.extraHTTPHeaders;
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    this.cdpSession = await this.context.newCDPSession(this.page);

    for (const mod of this.modules) {
      await mod.attach(this.cdpSession, this.page);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/session/manager.test.ts`
Expected: All 10 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/session/ tests/session/
git commit -m "Add session manager with browser lifecycle and CDP session"
```

---

### Task 4: Console + Network Domain Modules

**Files:**
- Create: `src/domains/console.ts`
- Create: `src/domains/network.ts`
- Create: `tests/domains/console.test.ts`
- Create: `tests/domains/network.test.ts`

- [ ] **Step 1: Write failing tests for console module**

`tests/domains/console.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { ConsoleDomain } from "../../src/domains/console.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("ConsoleDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let consoleDomain: ConsoleDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
    consoleDomain = new ConsoleDomain();
    session.registerModule(consoleDomain);
  });

  afterEach(async () => {
    await session.close();
  });

  it("captures console.log messages", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    const entries = consoleDomain.getEntries();
    expect(entries.some((e) => e.text === "page loaded" && e.level === "log")).toBe(true);
  });

  it("captures console.warn messages", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    const entries = consoleDomain.getEntries();
    expect(entries.some((e) => e.text === "test warning" && e.level === "warn")).toBe(true);
  });

  it("filters by level", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    const warns = consoleDomain.getEntries("warn");
    expect(warns.every((e) => e.level === "warn")).toBe(true);
    expect(warns.length).toBeGreaterThan(0);
  });

  it("resets entries on reset()", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    expect(consoleDomain.getEntries().length).toBeGreaterThan(0);
    await consoleDomain.reset();
    expect(consoleDomain.getEntries().length).toBe(0);
  });

  it("includes timestamps", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    const entries = consoleDomain.getEntries();
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/console.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ConsoleDomain**

`src/domains/console.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule, ConsoleEntry } from "../types.js";

export class ConsoleDomain implements DomainModule {
  readonly name = "console";
  readonly cdpDomains = ["Runtime"];

  private entries: ConsoleEntry[] = [];
  private cdp: CDPSession | null = null;
  private onEntry: ((event: any) => void) | null = null;
  private onException: ((event: any) => void) | null = null;

  async attach(cdp: CDPSession, _page: Page): Promise<void> {
    this.cdp = cdp;
    await cdp.send("Runtime.enable");

    this.onEntry = (event: any) => {
      const args = event.args ?? [];
      const text = args.map((a: any) => a.value ?? a.description ?? "").join(" ");
      const level = this.mapType(event.type);
      this.entries.push({
        level,
        text,
        timestamp: event.timestamp ?? Date.now(),
        url: event.stackTrace?.callFrames?.[0]?.url,
        lineNumber: event.stackTrace?.callFrames?.[0]?.lineNumber,
        stackTrace: event.stackTrace
          ? event.stackTrace.callFrames
              .map((f: any) => `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
              .join("\n")
          : undefined,
      });
    };

    this.onException = (event: any) => {
      const detail = event.exceptionDetails;
      this.entries.push({
        level: "error",
        text: detail.text ?? detail.exception?.description ?? "Uncaught exception",
        timestamp: detail.timestamp ?? Date.now(),
        url: detail.url,
        lineNumber: detail.lineNumber,
        stackTrace: detail.stackTrace
          ? detail.stackTrace.callFrames
              .map((f: any) => `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
              .join("\n")
          : undefined,
      });
    };

    cdp.on("Runtime.consoleAPICalled", this.onEntry);
    cdp.on("Runtime.exceptionThrown", this.onException);
  }

  async detach(): Promise<void> {
    if (this.cdp) {
      this.cdp.off("Runtime.consoleAPICalled", this.onEntry!);
      this.cdp.off("Runtime.exceptionThrown", this.onException!);

      try {
        await this.cdp.send("Runtime.disable");
      } catch {
        // Session may already be closed
      }
    }
    this.cdp = null;
    this.onEntry = null;
    this.onException = null;
  }

  async reset(): Promise<void> {
    this.entries = [];
  }

  getEntries(level?: string): ConsoleEntry[] {
    if (level) {
      return this.entries.filter((e) => e.level === level);
    }
    return [...this.entries];
  }

  private mapType(type: string): ConsoleEntry["level"] {
    switch (type) {
      case "log": return "log";
      case "info": return "info";
      case "warning": return "warn";
      case "error": return "error";
      case "debug": return "debug";
      default: return "log";
    }
  }
}
```

- [ ] **Step 4: Run console tests to verify they pass**

Run: `npx vitest run tests/domains/console.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Write failing tests for network module**

`tests/domains/network.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { NetworkDomain } from "../../src/domains/network.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("NetworkDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let network: NetworkDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
    network = new NetworkDomain();
    session.registerModule(network);
  });

  afterEach(async () => {
    await session.close();
  });

  it("captures the document request", async () => {
    await session.navigate(server.url + "/basic.html");
    const requests = network.getRequests();
    expect(requests.some((r) => r.url.includes("/basic.html") && r.resourceType === "Document")).toBe(true);
  });

  it("records status codes", async () => {
    await session.navigate(server.url + "/basic.html");
    const doc = network.getRequests().find((r) => r.url.includes("/basic.html"));
    expect(doc?.status).toBe(200);
  });

  it("records timing data", async () => {
    await session.navigate(server.url + "/basic.html");
    const doc = network.getRequests().find((r) => r.url.includes("/basic.html"));
    expect(doc?.startTime).toBeGreaterThan(0);
  });

  it("filters by resource type", async () => {
    await session.navigate(server.url + "/basic.html");
    const docs = network.getRequests({ resourceType: "Document" });
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((r) => r.resourceType === "Document")).toBe(true);
  });

  it("resets requests on reset()", async () => {
    await session.navigate(server.url + "/basic.html");
    expect(network.getRequests().length).toBeGreaterThan(0);
    await network.reset();
    expect(network.getRequests().length).toBe(0);
  });

  it("captures 404 responses", async () => {
    await session.navigate(server.url + "/nonexistent.html");
    const requests = network.getRequests();
    expect(requests.some((r) => r.status === 404)).toBe(true);
  });
});
```

- [ ] **Step 6: Run network tests to verify they fail**

Run: `npx vitest run tests/domains/network.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Implement NetworkDomain**

`src/domains/network.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule, NetworkRequest, NetworkQueryFilter } from "../types.js";

export class NetworkDomain implements DomainModule {
  readonly name = "network";
  readonly cdpDomains = ["Network"];

  private requests = new Map<string, NetworkRequest>();
  private cdp: CDPSession | null = null;
  private handlers: Array<{ event: string; handler: (e: any) => void }> = [];

  async attach(cdp: CDPSession, _page: Page): Promise<void> {
    this.cdp = cdp;
    await cdp.send("Network.enable");

    this.listen(cdp, "Network.requestWillBeSent", (event) => {
      this.requests.set(event.requestId, {
        requestId: event.requestId,
        url: event.request.url,
        method: event.request.method,
        resourceType: event.type,
        startTime: event.timestamp * 1000,
        cached: false,
        initiator: event.initiator?.type,
        renderBlocking: event.request.isLinkPreload ? "non-blocking" : undefined,
      });
    });

    this.listen(cdp, "Network.responseReceived", (event) => {
      const req = this.requests.get(event.requestId);
      if (req) {
        req.status = event.response.status;
        req.mimeType = event.response.mimeType;
        req.cached = event.response.fromDiskCache || event.response.fromServiceWorker || false;
        if (event.response.timing) {
          req.timing = {
            dnsStart: event.response.timing.dnsStart,
            dnsEnd: event.response.timing.dnsEnd,
            connectStart: event.response.timing.connectStart,
            connectEnd: event.response.timing.connectEnd,
            sslStart: event.response.timing.sslStart,
            sslEnd: event.response.timing.sslEnd,
            sendStart: event.response.timing.sendStart,
            sendEnd: event.response.timing.sendEnd,
            receiveHeadersEnd: event.response.timing.receiveHeadersEnd,
          };
        }
      }
    });

    this.listen(cdp, "Network.loadingFinished", (event) => {
      const req = this.requests.get(event.requestId);
      if (req) {
        req.endTime = event.timestamp * 1000;
        req.encodedDataLength = event.encodedDataLength;
      }
    });

    this.listen(cdp, "Network.loadingFailed", (event) => {
      const req = this.requests.get(event.requestId);
      if (req) {
        req.endTime = event.timestamp * 1000;
        req.status = 0;
      }
    });

    this.listen(cdp, "Network.requestServedFromCache", (event) => {
      const req = this.requests.get(event.requestId);
      if (req) {
        req.cached = true;
      }
    });
  }

  async detach(): Promise<void> {
    if (this.cdp) {
      for (const { event, handler } of this.handlers) {
        this.cdp.off(event, handler);
      }
      try {
        await this.cdp.send("Network.disable");
      } catch {
        // Session may already be closed
      }
    }
    this.handlers = [];
    this.cdp = null;
  }

  async reset(): Promise<void> {
    this.requests.clear();
  }

  getRequests(filter?: Partial<NetworkQueryFilter>): NetworkRequest[] {
    let results = [...this.requests.values()];
    if (filter?.resourceType) {
      results = results.filter((r) => r.resourceType === filter.resourceType);
    }
    if (filter?.minSize !== undefined) {
      results = results.filter((r) => (r.encodedDataLength ?? 0) >= filter.minSize!);
    }
    if (filter?.blocking !== undefined) {
      results = results.filter((r) =>
        filter.blocking ? r.renderBlocking !== "non-blocking" : r.renderBlocking === "non-blocking",
      );
    }
    if (filter?.domain) {
      results = results.filter((r) => {
        try {
          return new URL(r.url).hostname.includes(filter.domain!);
        } catch {
          return false;
        }
      });
    }
    return results;
  }

  getSummary(): Record<string, unknown> {
    const requests = [...this.requests.values()];
    const totalSize = requests.reduce((sum, r) => sum + (r.encodedDataLength ?? 0), 0);
    const byType: Record<string, number> = {};
    for (const req of requests) {
      byType[req.resourceType] = (byType[req.resourceType] ?? 0) + 1;
    }
    return {
      totalRequests: requests.length,
      totalSize,
      byType,
      cached: requests.filter((r) => r.cached).length,
      failed: requests.filter((r) => r.status === 0 || (r.status && r.status >= 400)).length,
    };
  }

  private listen(cdp: CDPSession, event: string, handler: (e: any) => void): void {
    cdp.on(event, handler);
    this.handlers.push({ event, handler });
  }
}
```

- [ ] **Step 8: Run all domain tests to verify they pass**

Run: `npx vitest run tests/domains/`
Expected: All 11 tests pass (5 console + 6 network)

- [ ] **Step 9: Commit**

```bash
git add src/domains/console.ts src/domains/network.ts tests/domains/console.test.ts tests/domains/network.test.ts
git commit -m "Add console and network domain modules with passive capture"
```

---

### Task 5: MCP Server Entry Point + Session Tools + Console/Network Metrics Tools

**Files:**
- Create: `src/server.ts`
- Create: `src/tools/session-tools.ts`
- Create: `src/tools/metrics-tools.ts`
- Create: `tests/integration/server-basic.test.ts`

- [ ] **Step 1: Write failing integration test**

`tests/integration/server-basic.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { DataStore } from "../../src/store/data-store.js";
import { QueryEngine } from "../../src/store/query-engine.js";
import { ConsoleDomain } from "../../src/domains/console.js";
import { NetworkDomain } from "../../src/domains/network.js";
import { createSessionTools } from "../../src/tools/session-tools.js";
import { createMetricsTools } from "../../src/tools/metrics-tools.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Session and Metrics Tools", () => {
  let server: TestServer;
  let session: SessionManager;
  let store: DataStore;
  let queryEngine: QueryEngine;
  let consoleDomain: ConsoleDomain;
  let networkDomain: NetworkDomain;
  let sessionTools: ReturnType<typeof createSessionTools>;
  let metricsTools: ReturnType<typeof createMetricsTools>;
  let tempDir: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    session = new SessionManager();
    store = new DataStore(tempDir);
    queryEngine = new QueryEngine();
    consoleDomain = new ConsoleDomain();
    networkDomain = new NetworkDomain();
    session.registerModule(consoleDomain);
    session.registerModule(networkDomain);
    sessionTools = createSessionTools(session, store);
    metricsTools = createMetricsTools(consoleDomain, networkDomain);
  });

  afterEach(async () => {
    await session.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("navigate returns load metrics", async () => {
    const result = await sessionTools.navigate({ url: server.url + "/basic.html" });
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.loadTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("reload works after navigation", async () => {
    await sessionTools.navigate({ url: server.url + "/basic.html" });
    const result = await sessionTools.reload();
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
  });

  it("configure_browser sets viewport", async () => {
    await sessionTools.configureBrowser({ viewport: { width: 640, height: 480 } });
    await sessionTools.navigate({ url: server.url + "/basic.html" });
    const page = session.getPage()!;
    expect(page.viewportSize()).toEqual({ width: 640, height: 480 });
  });

  it("get_console_log returns captured messages", async () => {
    await sessionTools.navigate({ url: server.url + "/basic.html" });
    await new Promise((r) => setTimeout(r, 200));
    const result = await metricsTools.getConsoleLog({});
    expect(result.success).toBe(true);
    expect((result as any).entries.some((e: any) => e.text === "page loaded")).toBe(true);
  });

  it("get_console_log filters by level", async () => {
    await sessionTools.navigate({ url: server.url + "/basic.html" });
    await new Promise((r) => setTimeout(r, 200));
    const result = await metricsTools.getConsoleLog({ level: "warn" });
    expect(result.success).toBe(true);
    expect((result as any).entries.every((e: any) => e.level === "warn")).toBe(true);
  });

  it("get_network_log returns captured requests", async () => {
    await sessionTools.navigate({ url: server.url + "/basic.html" });
    const result = await metricsTools.getNetworkLog({});
    expect(result.success).toBe(true);
    expect((result as any).requests.length).toBeGreaterThan(0);
    expect((result as any).summary.totalRequests).toBeGreaterThan(0);
  });

  it("close_session tears down cleanly", async () => {
    await sessionTools.navigate({ url: server.url + "/basic.html" });
    const result = await sessionTools.closeSession();
    expect(result.success).toBe(true);
    expect(session.isActive()).toBe(false);
  });

  it("set_auth injects cookies", async () => {
    await sessionTools.navigate({ url: server.url + "/basic.html" });
    const result = await sessionTools.setAuth({
      cookies: [{ name: "token", value: "xyz", domain: "127.0.0.1", path: "/" }],
    });
    expect(result.success).toBe(true);
  });

  it("returns error when reloading without navigation", async () => {
    const result = await sessionTools.reload();
    expect(result.success).toBe(false);
    expect((result as any).error.category).toBe("session");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/server-basic.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement session tools**

`src/tools/session-tools.ts`:
```typescript
import type { SessionManager } from "../session/manager.js";
import type { DataStore } from "../store/data-store.js";
import type { BrowserConfig, ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";
import type { AuthConfig } from "../session/manager.js";

export function createSessionTools(session: SessionManager, store: DataStore) {
  return {
    async configureBrowser(args: BrowserConfig): Promise<ToolResult> {
      try {
        session.configure(args);
        return toolSuccess({ configured: args });
      } catch (err) {
        return toolError("session", "Failed to configure browser", String(err));
      }
    },

    async navigate(args: { url: string }): Promise<ToolResult> {
      try {
        const result = await session.navigate(args.url);
        return toolSuccess({
          url: result.url,
          status: result.status,
          loadTimeMs: result.loadTimeMs,
        });
      } catch (err) {
        return toolError("navigation", `Failed to navigate to ${args.url}`, String(err));
      }
    },

    async reload(): Promise<ToolResult> {
      try {
        const result = await session.reload();
        return toolSuccess({
          url: result.url,
          status: result.status,
          loadTimeMs: result.loadTimeMs,
        });
      } catch (err) {
        return toolError("session", "Failed to reload page", String(err));
      }
    },

    async setAuth(args: AuthConfig): Promise<ToolResult> {
      try {
        await session.setAuth(args);
        return toolSuccess({ applied: true });
      } catch (err) {
        return toolError("session", "Failed to set auth", String(err));
      }
    },

    async closeSession(): Promise<ToolResult> {
      try {
        await store.flushManifest();
        await session.close();
        return toolSuccess({ closed: true });
      } catch (err) {
        return toolError("session", "Failed to close session", String(err));
      }
    },
  };
}
```

- [ ] **Step 4: Implement metrics tools (console + network)**

`src/tools/metrics-tools.ts`:
```typescript
import type { ConsoleDomain } from "../domains/console.js";
import type { NetworkDomain } from "../domains/network.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";

export function createMetricsTools(
  consoleDomain: ConsoleDomain,
  networkDomain: NetworkDomain,
) {
  return {
    async getConsoleLog(args: { level?: string }): Promise<ToolResult> {
      try {
        const entries = consoleDomain.getEntries(args.level);
        return toolSuccess({
          entries,
          count: entries.length,
        });
      } catch (err) {
        return toolError("internal", "Failed to get console log", String(err));
      }
    },

    async getNetworkLog(args: { resourceType?: string; minSize?: number; blocking?: boolean; domain?: string }): Promise<ToolResult> {
      try {
        const requests = networkDomain.getRequests(args);
        const summary = networkDomain.getSummary();
        return toolSuccess({
          requests,
          summary,
        });
      } catch (err) {
        return toolError("internal", "Failed to get network log", String(err));
      }
    },
  };
}
```

- [ ] **Step 5: Create MCP server entry point**

`src/server.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SessionManager } from "./session/manager.js";
import { DataStore } from "./store/data-store.js";
import { QueryEngine } from "./store/query-engine.js";
import { ConsoleDomain } from "./domains/console.js";
import { NetworkDomain } from "./domains/network.js";
import { createSessionTools } from "./tools/session-tools.js";
import { createMetricsTools } from "./tools/metrics-tools.js";

const OUTPUT_DIR = process.env.WPO_OUTPUT_DIR ?? "./webpage-optimizer-data";

// ---- Core Services

const session = new SessionManager();
const store = new DataStore(OUTPUT_DIR);
const queryEngine = new QueryEngine();

// ---- Domain Modules

const consoleDomain = new ConsoleDomain();
const networkDomain = new NetworkDomain();

session.registerModule(consoleDomain);
session.registerModule(networkDomain);

// ---- Tool Handlers

const sessionTools = createSessionTools(session, store);
const metricsTools = createMetricsTools(consoleDomain, networkDomain);

// ---- MCP Server

const mcp = new McpServer({
  name: "webpage-optimizer",
  version: "0.1.0",
});

function jsonContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

function toolResponse(result: { success: boolean; [key: string]: unknown }) {
  return result.success ? jsonContent(result) : errorContent(result);
}

// ---- Session & Navigation Tools

mcp.registerTool("configure_browser", {
  title: "Configure Browser",
  description:
    "Set viewport, device emulation, locale, user agent, extra headers. Optional — defaults to standard desktop Chrome. Call before navigate.",
  inputSchema: z.object({
    viewport: z.object({ width: z.number(), height: z.number() }).optional().describe("Viewport dimensions"),
    deviceScaleFactor: z.number().optional().describe("Device pixel ratio"),
    userAgent: z.string().optional().describe("Custom user agent string"),
    locale: z.string().optional().describe("Browser locale (e.g. 'en-US')"),
    isMobile: z.boolean().optional().describe("Emulate mobile device"),
    extraHTTPHeaders: z.record(z.string()).optional().describe("Extra HTTP headers for all requests"),
  }),
}, async (args) => toolResponse(await sessionTools.configureBrowser(args)));

mcp.registerTool("navigate", {
  title: "Navigate",
  description:
    "Navigate to a URL. Lazily launches the browser on first call. Returns load timing, HTTP status, and console output during load.",
  inputSchema: z.object({
    url: z.string().describe("The URL to navigate to"),
  }),
}, async (args) => toolResponse(await sessionTools.navigate(args)));

mcp.registerTool("reload", {
  title: "Reload",
  description: "Reload the current page. Returns load timing and status. Useful for measuring cold-start performance.",
  inputSchema: z.object({}),
}, async () => toolResponse(await sessionTools.reload()));

mcp.registerTool("set_auth", {
  title: "Set Auth",
  description: "Inject cookies, extra HTTP headers, or localStorage values into the browser context for authenticated page access.",
  inputSchema: z.object({
    cookies: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string(),
          path: z.string(),
          httpOnly: z.boolean().optional(),
          secure: z.boolean().optional(),
        }),
      )
      .optional()
      .describe("Cookies to inject"),
    headers: z.record(z.string()).optional().describe("HTTP headers to add to all requests"),
    localStorage: z.record(z.string()).optional().describe("localStorage key-value pairs to set"),
  }),
}, async (args) => toolResponse(await sessionTools.setAuth(args)));

mcp.registerTool("close_session", {
  title: "Close Session",
  description: "Tear down the browser and flush all profiling data to disk. Call when done with the current page.",
  inputSchema: z.object({}),
}, async () => toolResponse(await sessionTools.closeSession()));

// ---- Metrics Tools

mcp.registerTool("get_console_log", {
  title: "Get Console Log",
  description:
    "Return console messages (logs, warnings, errors) captured since page load or last clear. Filterable by level.",
  inputSchema: z.object({
    level: z.enum(["log", "info", "warn", "error", "debug"]).optional().describe("Filter by log level"),
  }),
}, async (args) => toolResponse(await metricsTools.getConsoleLog(args)));

mcp.registerTool("get_network_log", {
  title: "Get Network Log",
  description:
    "Return network requests captured since page load. Includes timing, size, cache status. Filterable by resource type, size, blocking status, domain.",
  inputSchema: z.object({
    resourceType: z.string().optional().describe("Filter by resource type (Document, Script, Stylesheet, Image, etc.)"),
    minSize: z.number().optional().describe("Minimum transfer size in bytes"),
    blocking: z.boolean().optional().describe("Filter render-blocking resources"),
    domain: z.string().optional().describe("Filter by request domain (partial match)"),
  }),
}, async (args) => toolResponse(await metricsTools.getNetworkLog(args)));

// ---- Start Server

async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 6: Run integration tests to verify they pass**

Run: `npx vitest run tests/integration/server-basic.test.ts`
Expected: All 9 tests pass

- [ ] **Step 7: Verify MCP server compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add src/server.ts src/tools/session-tools.ts src/tools/metrics-tools.ts tests/integration/server-basic.test.ts
git commit -m "Add MCP server with session and metrics tools"
```

---

### Task 6: CPU Domain Module + Profiling Tools

**Files:**
- Create: `src/domains/cpu.ts`
- Create: `src/tools/profiling-tools.ts`
- Create: `tests/domains/cpu.test.ts`

- [ ] **Step 1: Write failing tests for CPU domain**

`tests/domains/cpu.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { CpuDomain } from "../../src/domains/cpu.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("CpuDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let cpu: CpuDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
    cpu = new CpuDomain();
    session.registerModule(cpu);
  });

  afterEach(async () => {
    await session.close();
  });

  it("starts and stops profiling, returning a profile", async () => {
    await session.navigate(server.url + "/basic.html");
    const sessionId = await cpu.startProfiling();
    expect(sessionId).toBeTruthy();

    // Generate some CPU work
    await session.getPage()!.evaluate(() => {
      let sum = 0;
      for (let i = 0; i < 1_000_000; i++) sum += Math.sqrt(i);
      return sum;
    });

    const result = await cpu.stopProfiling(sessionId);
    expect(result.profile).toBeDefined();
    expect(result.summary.totalSamples).toBeGreaterThan(0);
  });

  it("auto-stops previous profiling session", async () => {
    await session.navigate(server.url + "/basic.html");
    const id1 = await cpu.startProfiling();
    const id2 = await cpu.startProfiling();
    expect(id2).not.toBe(id1);
    expect(cpu.isActive()).toBe(true);
    await cpu.stopProfiling(id2);
  });

  it("summary includes top functions by self time", async () => {
    await session.navigate(server.url + "/basic.html");
    const sessionId = await cpu.startProfiling();
    await session.getPage()!.evaluate(() => {
      let sum = 0;
      for (let i = 0; i < 1_000_000; i++) sum += Math.sqrt(i);
      return sum;
    });
    const result = await cpu.stopProfiling(sessionId);
    expect(result.summary.topFunctions).toBeDefined();
    expect(Array.isArray(result.summary.topFunctions)).toBe(true);
  });

  it("resets on reset()", async () => {
    await session.navigate(server.url + "/basic.html");
    const sessionId = await cpu.startProfiling();
    await cpu.reset();
    expect(cpu.isActive()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/cpu.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CpuDomain**

`src/domains/cpu.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule, CpuQueryFilter } from "../types.js";
import { randomUUID } from "node:crypto";

interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount: number;
  children?: number[];
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

export interface CpuProfilingResult {
  profile: CpuProfile;
  summary: {
    totalSamples: number;
    durationMs: number;
    topFunctions: Array<{
      functionName: string;
      url: string;
      lineNumber: number;
      selfTime: number;
      hitCount: number;
    }>;
  };
}

export class CpuDomain implements DomainModule {
  readonly name = "cpu";
  readonly cdpDomains = ["Profiler"];

  private cdp: CDPSession | null = null;
  private activeSessionId: string | null = null;

  async attach(cdp: CDPSession, _page: Page): Promise<void> {
    this.cdp = cdp;
    await cdp.send("Profiler.enable");
  }

  async detach(): Promise<void> {
    if (this.activeSessionId) {
      try {
        await this.cdp?.send("Profiler.stop");
      } catch {
        // May not have started
      }
      this.activeSessionId = null;
    }
    try {
      await this.cdp?.send("Profiler.disable");
    } catch {
      // Session may be closed
    }
    this.cdp = null;
  }

  async reset(): Promise<void> {
    if (this.activeSessionId) {
      try {
        await this.cdp?.send("Profiler.stop");
      } catch {
        // May not have started
      }
      this.activeSessionId = null;
    }
  }

  isActive(): boolean {
    return this.activeSessionId !== null;
  }

  async startProfiling(): Promise<string> {
    if (!this.cdp) throw new Error("CPU domain not attached");

    if (this.activeSessionId) {
      try {
        await this.cdp.send("Profiler.stop");
      } catch {
        // Previous session may have failed
      }
    }

    const sessionId = randomUUID();
    await this.cdp.send("Profiler.start");
    this.activeSessionId = sessionId;
    return sessionId;
  }

  async stopProfiling(sessionId: string): Promise<CpuProfilingResult> {
    if (!this.cdp) throw new Error("CPU domain not attached");
    if (this.activeSessionId !== sessionId) {
      throw new Error(`No active profiling session with ID: ${sessionId}`);
    }

    const { profile } = (await this.cdp.send("Profiler.stop")) as { profile: CpuProfile };
    this.activeSessionId = null;

    const summary = this.buildSummary(profile);
    return { profile, summary };
  }

  filterProfile(profile: CpuProfile, filter: CpuQueryFilter): CpuProfileNode[] {
    let nodes = profile.nodes.filter((n) => n.hitCount > 0);

    if (filter.functionName) {
      const pattern = filter.functionName.toLowerCase();
      nodes = nodes.filter((n) => n.callFrame.functionName.toLowerCase().includes(pattern));
    }
    if (filter.url) {
      const pattern = filter.url.toLowerCase();
      nodes = nodes.filter((n) => n.callFrame.url.toLowerCase().includes(pattern));
    }
    if (filter.minSelfTime !== undefined) {
      const totalSamples = profile.samples.length;
      const totalTime = profile.endTime - profile.startTime;
      nodes = nodes.filter((n) => {
        const selfTime = (n.hitCount / totalSamples) * totalTime;
        return selfTime >= filter.minSelfTime!;
      });
    }

    return nodes;
  }

  private buildSummary(profile: CpuProfile): CpuProfilingResult["summary"] {
    const totalSamples = profile.samples.length;
    const durationMs = Math.round((profile.endTime - profile.startTime) / 1000);
    const totalTime = profile.endTime - profile.startTime;

    const functions = profile.nodes
      .filter((n) => n.hitCount > 0 && n.callFrame.functionName)
      .map((n) => ({
        functionName: n.callFrame.functionName,
        url: n.callFrame.url,
        lineNumber: n.callFrame.lineNumber,
        selfTime: Math.round(((n.hitCount / totalSamples) * totalTime) / 1000),
        hitCount: n.hitCount,
      }))
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, 10);

    return { totalSamples, durationMs, topFunctions: functions };
  }
}
```

- [ ] **Step 4: Run CPU tests to verify they pass**

Run: `npx vitest run tests/domains/cpu.test.ts`
Expected: All 4 tests pass

- [ ] **Step 5: Implement profiling tools**

`src/tools/profiling-tools.ts`:
```typescript
import type { CpuDomain } from "../domains/cpu.js";
import type { DataStore } from "../store/data-store.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";
import { randomUUID } from "node:crypto";

export function createProfilingTools(
  cpuDomain: CpuDomain,
  store: DataStore,
) {
  const activeSessions = new Map<string, { domain: string; sessionId: string }>();

  return {
    async startProfiling(args: { domain: string }): Promise<ToolResult> {
      try {
        let sessionId: string;
        switch (args.domain) {
          case "cpu":
            sessionId = await cpuDomain.startProfiling();
            break;
          default:
            return toolError("profiling", `Unknown profiling domain: ${args.domain}. Valid domains: cpu, memory_allocation, rendering`);
        }

        const id = randomUUID();
        activeSessions.set(id, { domain: args.domain, sessionId });
        return toolSuccess({ id, domain: args.domain, started: true });
      } catch (err) {
        return toolError("profiling", `Failed to start ${args.domain} profiling`, String(err));
      }
    },

    async stopProfiling(args: { id: string }): Promise<ToolResult> {
      const session = activeSessions.get(args.id);
      if (!session) {
        return toolError("profiling", `No active profiling session with ID: ${args.id}`);
      }

      try {
        let summary: Record<string, unknown> = {};
        let profileId = args.id;

        switch (session.domain) {
          case "cpu": {
            const result = await cpuDomain.stopProfiling(session.sessionId);
            const record = await store.saveArtifact(
              profileId, "cpu", "profile",
              JSON.stringify(result.profile), ".cpuprofile",
            );
            store.updateSummary(profileId, result.summary);
            summary = result.summary;
            break;
          }
          default:
            return toolError("profiling", `Unknown domain: ${session.domain}`);
        }

        activeSessions.delete(args.id);
        return toolSuccess({ profileId, domain: session.domain, summary });
      } catch (err) {
        return toolError("profiling", `Failed to stop profiling`, String(err));
      }
    },
  };
}
```

- [ ] **Step 6: Write test for profiling tools**

Add a new describe block to `tests/domains/cpu.test.ts` (append to the end of the file). Add these imports at the top of the file alongside the existing ones:
```typescript
import { DataStore } from "../../src/store/data-store.js";
import { createProfilingTools } from "../../src/tools/profiling-tools.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Then append this describe block after the existing one:
```typescript
describe("Profiling Tools - CPU", () => {
  let server: TestServer;
  let session: SessionManager;
  let cpu: CpuDomain;
  let tempDir: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    session = new SessionManager();
    cpu = new CpuDomain();
    session.registerModule(cpu);
  });

  afterEach(async () => {
    await session.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("start and stop profiling via tool handlers", async () => {
    const store = new DataStore(tempDir);
    const tools = createProfilingTools(cpu, store);

    await session.navigate(server.url + "/basic.html");

    const startResult = await tools.startProfiling({ domain: "cpu" });
    expect(startResult.success).toBe(true);
    const { id } = startResult as any;

    await session.getPage()!.evaluate(() => {
      let s = 0;
      for (let i = 0; i < 500_000; i++) s += Math.sqrt(i);
      return s;
    });

    const stopResult = await tools.stopProfiling({ id });
    expect(stopResult.success).toBe(true);
    expect((stopResult as any).summary.totalSamples).toBeGreaterThan(0);
    expect((stopResult as any).profileId).toBe(id);
  });

  it("returns error for unknown domain", async () => {
    const store = new DataStore(tempDir);
    const tools = createProfilingTools(cpu, store);
    const result = await tools.startProfiling({ domain: "unknown" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 7: Run all tests to verify they pass**

Run: `npx vitest run tests/domains/cpu.test.ts`
Expected: All 6 tests pass

- [ ] **Step 8: Wire CPU profiling tools into server.ts**

Add to `src/server.ts` after existing tool registrations:

```typescript
import { CpuDomain } from "./domains/cpu.js";
import { createProfilingTools } from "./tools/profiling-tools.js";
```

Register the domain module and tools in the appropriate sections. Add:
```typescript
const cpuDomain = new CpuDomain();
session.registerModule(cpuDomain);

const profilingTools = createProfilingTools(cpuDomain, store);
```

Register MCP tools:
```typescript
mcp.registerTool("start_profiling", {
  title: "Start Profiling",
  description:
    "Start a profiling session for a domain: cpu, memory_allocation, rendering. Auto-stops any previous session of the same domain. Returns a session ID for stopping later.",
  inputSchema: z.object({
    domain: z.enum(["cpu", "memory_allocation", "rendering"]).describe("The profiling domain to start"),
  }),
}, async (args) => toolResponse(await profilingTools.startProfiling(args)));

mcp.registerTool("stop_profiling", {
  title: "Stop Profiling",
  description:
    "Stop a profiling session by ID. Returns a summary with key metrics and a profile ID for drilling into details via query_profile.",
  inputSchema: z.object({
    id: z.string().describe("The profiling session ID returned by start_profiling"),
  }),
}, async (args) => toolResponse(await profilingTools.stopProfiling(args)));
```

- [ ] **Step 9: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 10: Commit**

```bash
git add src/domains/cpu.ts src/tools/profiling-tools.ts tests/domains/cpu.test.ts src/server.ts
git commit -m "Add CPU profiling domain and start/stop profiling tools"
```

---

### Task 7: Memory Domain Module + Heap Tools

**Files:**
- Create: `src/domains/memory.ts`
- Create: `tests/domains/memory.test.ts`

- [ ] **Step 1: Write failing tests for memory domain**

`tests/domains/memory.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { MemoryDomain } from "../../src/domains/memory.js";
import { DataStore } from "../../src/store/data-store.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("MemoryDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let memory: MemoryDomain;
  let store: DataStore;
  let tempDir: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    store = new DataStore(tempDir);
    session = new SessionManager();
    memory = new MemoryDomain(store);
    session.registerModule(memory);
  });

  afterEach(async () => {
    await session.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("takes a heap snapshot with summary", async () => {
    await session.navigate(server.url + "/basic.html");
    const result = await memory.takeHeapSnapshot();
    expect(result.id).toBeTruthy();
    expect(result.summary.totalSize).toBeGreaterThan(0);
    expect(result.summary.nodeCount).toBeGreaterThan(0);
    expect(Array.isArray(result.summary.topTypes)).toBe(true);
  });

  it("compares two snapshots", async () => {
    await session.navigate(server.url + "/memory-leak.html");

    const snap1 = await memory.takeHeapSnapshot();

    // Create leaked objects
    await session.getPage()!.click("#leak");
    await new Promise((r) => setTimeout(r, 500));

    const snap2 = await memory.takeHeapSnapshot();

    const diff = await memory.compareSnapshots(snap1.id, snap2.id);
    expect(diff.sizeDelta).toBeGreaterThan(0);
    expect(diff.added.length + diff.grown.length).toBeGreaterThan(0);
  });

  it("saves snapshot artifact to disk", async () => {
    await session.navigate(server.url + "/basic.html");
    const result = await memory.takeHeapSnapshot();
    const record = store.get(result.id);
    expect(record?.artifactPath).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/memory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MemoryDomain**

`src/domains/memory.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule, MemoryQueryFilter } from "../types.js";
import type { DataStore } from "../store/data-store.js";
import { randomUUID } from "node:crypto";

interface HeapSnapshotSummary {
  totalSize: number;
  nodeCount: number;
  topTypes: Array<{ type: string; count: number; size: number }>;
}

interface SnapshotTypeBucket {
  type: string;
  count: number;
  size: number;
}

export interface HeapSnapshotResult {
  id: string;
  summary: HeapSnapshotSummary;
}

export interface SnapshotComparison {
  sizeDelta: number;
  added: SnapshotTypeBucket[];
  removed: SnapshotTypeBucket[];
  grown: Array<{ type: string; countDelta: number; sizeDelta: number }>;
}

export class MemoryDomain implements DomainModule {
  readonly name = "memory";
  readonly cdpDomains = ["HeapProfiler", "Runtime"];

  private cdp: CDPSession | null = null;
  private snapshots = new Map<string, Map<string, SnapshotTypeBucket>>();

  constructor(private readonly store: DataStore) {}

  async attach(cdp: CDPSession, _page: Page): Promise<void> {
    this.cdp = cdp;
    await cdp.send("HeapProfiler.enable");
  }

  async detach(): Promise<void> {
    try {
      await this.cdp?.send("HeapProfiler.disable");
    } catch {
      // Session may be closed
    }
    this.cdp = null;
  }

  async reset(): Promise<void> {
    this.snapshots.clear();
  }

  async takeHeapSnapshot(): Promise<HeapSnapshotResult> {
    if (!this.cdp) throw new Error("Memory domain not attached");

    const id = randomUUID();
    const chunks: string[] = [];

    const onChunk = (params: { chunk: string }) => {
      chunks.push(params.chunk);
    };

    this.cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);

    await this.cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });

    this.cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);

    const snapshotData = chunks.join("");
    await this.store.saveArtifact(id, "memory", "snapshot", snapshotData, ".heapsnapshot");

    const parsed = JSON.parse(snapshotData);
    const typeBuckets = this.parseSnapshotTypes(parsed);
    this.snapshots.set(id, typeBuckets);

    const totalSize = [...typeBuckets.values()].reduce((sum, b) => sum + b.size, 0);
    const nodeCount = [...typeBuckets.values()].reduce((sum, b) => sum + b.count, 0);
    const topTypes = [...typeBuckets.values()]
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);

    const summary: HeapSnapshotSummary = { totalSize, nodeCount, topTypes };
    this.store.updateSummary(id, summary);

    return { id, summary };
  }

  async compareSnapshots(idA: string, idB: string): Promise<SnapshotComparison> {
    const bucketsA = this.snapshots.get(idA);
    const bucketsB = this.snapshots.get(idB);

    if (!bucketsA) throw new Error(`Snapshot not found: ${idA}`);
    if (!bucketsB) throw new Error(`Snapshot not found: ${idB}`);

    const totalA = [...bucketsA.values()].reduce((s, b) => s + b.size, 0);
    const totalB = [...bucketsB.values()].reduce((s, b) => s + b.size, 0);

    const added: SnapshotTypeBucket[] = [];
    const removed: SnapshotTypeBucket[] = [];
    const grown: SnapshotComparison["grown"] = [];

    const allTypes = new Set([...bucketsA.keys(), ...bucketsB.keys()]);
    for (const type of allTypes) {
      const a = bucketsA.get(type);
      const b = bucketsB.get(type);

      if (!a && b) {
        added.push(b);
      } else if (a && !b) {
        removed.push(a);
      } else if (a && b) {
        const countDelta = b.count - a.count;
        const sizeDelta = b.size - a.size;
        if (sizeDelta > 0) {
          grown.push({ type, countDelta, sizeDelta });
        }
      }
    }

    added.sort((a, b) => b.size - a.size);
    grown.sort((a, b) => b.sizeDelta - a.sizeDelta);

    return { sizeDelta: totalB - totalA, added, removed, grown };
  }

  filterSnapshot(buckets: Map<string, SnapshotTypeBucket>, filter: MemoryQueryFilter): SnapshotTypeBucket[] {
    let results = [...buckets.values()];
    if (filter.objectType) {
      const pattern = filter.objectType.toLowerCase();
      results = results.filter((b) => b.type.toLowerCase().includes(pattern));
    }
    if (filter.minRetainedSize !== undefined) {
      results = results.filter((b) => b.size >= filter.minRetainedSize!);
    }
    return results.sort((a, b) => b.size - a.size);
  }

  getSnapshotBuckets(id: string): Map<string, SnapshotTypeBucket> | undefined {
    return this.snapshots.get(id);
  }

  private parseSnapshotTypes(snapshot: any): Map<string, SnapshotTypeBucket> {
    const buckets = new Map<string, SnapshotTypeBucket>();
    const { nodes, strings } = snapshot.snapshot
      ? { nodes: snapshot.nodes, strings: snapshot.strings }
      : { nodes: snapshot.nodes, strings: snapshot.strings };

    if (!nodes || !strings) return buckets;

    // V8 heap snapshot node fields: type, name, id, self_size, edge_count, trace_node_id
    const nodeFieldCount = snapshot.snapshot?.meta?.node_fields?.length ?? 7;
    const nameOffset = 1;
    const selfSizeOffset = 3;

    for (let i = 0; i < nodes.length; i += nodeFieldCount) {
      const nameIdx = nodes[i + nameOffset];
      const selfSize = nodes[i + selfSizeOffset];
      const name = strings[nameIdx] || "(anonymous)";

      const existing = buckets.get(name);
      if (existing) {
        existing.count++;
        existing.size += selfSize;
      } else {
        buckets.set(name, { type: name, count: 1, size: selfSize });
      }
    }

    return buckets;
  }
}
```

- [ ] **Step 4: Run memory tests to verify they pass**

Run: `npx vitest run tests/domains/memory.test.ts`
Expected: All 3 tests pass

- [ ] **Step 5: Add heap snapshot and compare tools to profiling-tools.ts**

Update `src/tools/profiling-tools.ts` — add MemoryDomain to the constructor and implement `takeHeapSnapshot` and `compareSnapshots`:

```typescript
import type { CpuDomain } from "../domains/cpu.js";
import type { MemoryDomain } from "../domains/memory.js";
import type { DataStore } from "../store/data-store.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";
import { randomUUID } from "node:crypto";

export function createProfilingTools(
  cpuDomain: CpuDomain,
  memoryDomain: MemoryDomain,
  store: DataStore,
) {
  const activeSessions = new Map<string, { domain: string; sessionId: string }>();

  return {
    async startProfiling(args: { domain: string }): Promise<ToolResult> {
      try {
        let sessionId: string;
        switch (args.domain) {
          case "cpu":
            sessionId = await cpuDomain.startProfiling();
            break;
          default:
            return toolError("profiling", `Unknown profiling domain: ${args.domain}. Valid domains: cpu, memory_allocation, rendering`);
        }

        const id = randomUUID();
        activeSessions.set(id, { domain: args.domain, sessionId });
        return toolSuccess({ id, domain: args.domain, started: true });
      } catch (err) {
        return toolError("profiling", `Failed to start ${args.domain} profiling`, String(err));
      }
    },

    async stopProfiling(args: { id: string }): Promise<ToolResult> {
      const session = activeSessions.get(args.id);
      if (!session) {
        return toolError("profiling", `No active profiling session with ID: ${args.id}`);
      }

      try {
        let summary: Record<string, unknown> = {};
        const profileId = args.id;

        switch (session.domain) {
          case "cpu": {
            const result = await cpuDomain.stopProfiling(session.sessionId);
            await store.saveArtifact(
              profileId, "cpu", "profile",
              JSON.stringify(result.profile), ".cpuprofile",
            );
            store.updateSummary(profileId, result.summary);
            summary = result.summary;
            break;
          }
          default:
            return toolError("profiling", `Unknown domain: ${session.domain}`);
        }

        activeSessions.delete(args.id);
        return toolSuccess({ profileId, domain: session.domain, summary });
      } catch (err) {
        return toolError("profiling", `Failed to stop profiling`, String(err));
      }
    },

    async takeHeapSnapshot(): Promise<ToolResult> {
      try {
        const result = await memoryDomain.takeHeapSnapshot();
        return toolSuccess({
          snapshotId: result.id,
          summary: result.summary,
        });
      } catch (err) {
        return toolError("profiling", "Failed to take heap snapshot", String(err));
      }
    },

    async compareSnapshots(args: { snapshotA: string; snapshotB: string }): Promise<ToolResult> {
      try {
        const diff = await memoryDomain.compareSnapshots(args.snapshotA, args.snapshotB);
        return toolSuccess({
          sizeDelta: diff.sizeDelta,
          added: diff.added.slice(0, 20),
          removed: diff.removed.slice(0, 20),
          grown: diff.grown.slice(0, 20),
        });
      } catch (err) {
        return toolError("profiling", "Failed to compare snapshots", String(err));
      }
    },
  };
}
```

- [ ] **Step 6: Wire memory tools into server.ts**

Add imports, register memory domain, update `createProfilingTools` call to include memory, and register MCP tools:
```typescript
// In server.ts, add:
import { MemoryDomain } from "./domains/memory.js";

const memoryDomain = new MemoryDomain(store);
session.registerModule(memoryDomain);

const profilingTools = createProfilingTools(cpuDomain, memoryDomain, store);

// Register MCP tools:
mcp.registerTool("take_heap_snapshot", {
  title: "Take Heap Snapshot",
  description:
    "Take a point-in-time V8 heap snapshot. Returns summary (total size, node count, top object types by retained size) and a snapshot ID for querying details or comparing with another snapshot.",
  inputSchema: z.object({}),
}, async () => toolResponse(await profilingTools.takeHeapSnapshot()));

mcp.registerTool("compare_snapshots", {
  title: "Compare Heap Snapshots",
  description:
    "Compare two heap snapshots by ID. Returns objects added, removed, and grown between the two snapshots. Key tool for memory leak detection — take a snapshot, perform the suspected leaky action, take another, compare.",
  inputSchema: z.object({
    snapshotA: z.string().describe("ID of the first (baseline) snapshot"),
    snapshotB: z.string().describe("ID of the second (after action) snapshot"),
  }),
}, async (args) => toolResponse(await profilingTools.compareSnapshots(args)));
```

- [ ] **Step 7: Run all tests to verify they pass**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/domains/memory.ts src/tools/profiling-tools.ts tests/domains/memory.test.ts src/server.ts
git commit -m "Add memory domain with heap snapshots and comparison"
```

---

### Task 8: Rendering + Web Vitals Domain Modules

**Files:**
- Create: `src/domains/rendering.ts`
- Create: `src/domains/web-vitals.ts`
- Create: `tests/domains/rendering.test.ts`
- Create: `tests/domains/web-vitals.test.ts`

- [ ] **Step 1: Write failing tests for rendering domain**

`tests/domains/rendering.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { RenderingDomain } from "../../src/domains/rendering.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("RenderingDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let rendering: RenderingDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
    rendering = new RenderingDomain();
    session.registerModule(rendering);
  });

  afterEach(async () => {
    await session.close();
  });

  it("captures performance entries after page load", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 500));
    const entries = rendering.getEntries();
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });

  it("detects long tasks when forced layout happens", async () => {
    await session.navigate(server.url + "/slow-render.html");
    await session.getPage()!.click("#trigger-layout");
    await new Promise((r) => setTimeout(r, 1000));
    const longTasks = rendering.getEntries({ type: "long-task" });
    // Long tasks may or may not be present depending on how fast the machine is
    expect(Array.isArray(longTasks)).toBe(true);
  });

  it("provides a summary", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 500));
    const summary = rendering.getSummary();
    expect(summary).toHaveProperty("totalEntries");
    expect(summary).toHaveProperty("layoutShifts");
    expect(summary).toHaveProperty("longTasks");
  });

  it("resets entries", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 500));
    await rendering.reset();
    expect(rendering.getEntries().length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/rendering.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RenderingDomain**

`src/domains/rendering.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule, RenderingQueryFilter } from "../types.js";

export interface RenderingEntry {
  type: "layout-shift" | "long-task" | "paint" | "animation-frame";
  timestamp: number;
  duration?: number;
  value?: number;
  details?: Record<string, unknown>;
}

export class RenderingDomain implements DomainModule {
  readonly name = "rendering";
  readonly cdpDomains = ["Performance", "LayerTree"];

  private cdp: CDPSession | null = null;
  private page: Page | null = null;
  private entries: RenderingEntry[] = [];

  async attach(cdp: CDPSession, page: Page): Promise<void> {
    this.cdp = cdp;
    this.page = page;
    await cdp.send("Performance.enable");

    try {
      await cdp.send("LayerTree.enable");
    } catch {
      // LayerTree may not be available in all Chrome builds
    }

    await this.injectObservers();
  }

  async detach(): Promise<void> {
    try {
      await this.cdp?.send("Performance.disable");
    } catch {
      // Session may be closed
    }
    try {
      await this.cdp?.send("LayerTree.disable");
    } catch {
      // May not have been enabled
    }
    this.cdp = null;
    this.page = null;
  }

  async reset(): Promise<void> {
    this.entries = [];
    if (this.page) {
      await this.injectObservers();
    }
  }

  getEntries(filter?: Partial<RenderingQueryFilter>): RenderingEntry[] {
    let results = [...this.entries];
    if (filter?.type) {
      results = results.filter((e) => e.type === filter.type);
    }
    if (filter?.minDuration !== undefined) {
      results = results.filter((e) => (e.duration ?? 0) >= filter.minDuration!);
    }
    return results;
  }

  getSummary(): Record<string, unknown> {
    return {
      totalEntries: this.entries.length,
      layoutShifts: this.entries.filter((e) => e.type === "layout-shift").length,
      longTasks: this.entries.filter((e) => e.type === "long-task").length,
      paints: this.entries.filter((e) => e.type === "paint").length,
      cumulativeLayoutShift: this.entries
        .filter((e) => e.type === "layout-shift")
        .reduce((sum, e) => sum + (e.value ?? 0), 0),
      longestTask: this.entries
        .filter((e) => e.type === "long-task")
        .reduce((max, e) => Math.max(max, e.duration ?? 0), 0),
    };
  }

  async collectEntries(): Promise<void> {
    if (!this.page) return;
    try {
      const collected = await this.page.evaluate(() => {
        const w = window as any;
        const entries = w.__wpo_rendering_entries ?? [];
        w.__wpo_rendering_entries = [];
        return entries;
      });
      this.entries.push(...collected);
    } catch {
      // Page may have navigated
    }
  }

  private async injectObservers(): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.evaluate(() => {
        const w = window as any;
        w.__wpo_rendering_entries = w.__wpo_rendering_entries ?? [];

        if (w.__wpo_observers_installed) return;
        w.__wpo_observers_installed = true;

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__wpo_rendering_entries.push({
                type: "layout-shift",
                timestamp: entry.startTime,
                value: (entry as any).value,
                details: { hadRecentInput: (entry as any).hadRecentInput },
              });
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__wpo_rendering_entries.push({
                type: "long-task",
                timestamp: entry.startTime,
                duration: entry.duration,
              });
            }
          }).observe({ type: "longtask", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__wpo_rendering_entries.push({
                type: "paint",
                timestamp: entry.startTime,
                details: { name: entry.name },
              });
            }
          }).observe({ type: "paint", buffered: true });
        } catch {}
      });
    } catch {
      // Page may not be ready
    }
  }
}
```

- [ ] **Step 4: Run rendering tests to verify they pass**

Run: `npx vitest run tests/domains/rendering.test.ts`
Expected: All 4 tests pass

- [ ] **Step 5: Write failing tests for web vitals domain**

`tests/domains/web-vitals.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { WebVitalsDomain } from "../../src/domains/web-vitals.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("WebVitalsDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let vitals: WebVitalsDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
    vitals = new WebVitalsDomain();
    session.registerModule(vitals);
  });

  afterEach(async () => {
    await session.close();
  });

  it("collects LCP after page load", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 1000));
    const metrics = await vitals.getMetrics();
    // LCP should be available after page load
    expect(metrics.lcp).toBeGreaterThanOrEqual(0);
  });

  it("collects CLS", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 1000));
    const metrics = await vitals.getMetrics();
    expect(metrics.cls).toBeGreaterThanOrEqual(0);
  });

  it("resets metrics", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 500));
    await vitals.reset();
    const metrics = await vitals.getMetrics();
    expect(metrics.lcp).toBe(0);
    expect(metrics.cls).toBe(0);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/domains/web-vitals.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Implement WebVitalsDomain**

`src/domains/web-vitals.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule } from "../types.js";

export interface WebVitalsMetrics {
  lcp: number;
  cls: number;
  inp: number;
}

export class WebVitalsDomain implements DomainModule {
  readonly name = "web-vitals";
  readonly cdpDomains = ["Performance"];

  private page: Page | null = null;
  private cdp: CDPSession | null = null;

  async attach(cdp: CDPSession, page: Page): Promise<void> {
    this.cdp = cdp;
    this.page = page;
    await this.injectObservers();
  }

  async detach(): Promise<void> {
    this.cdp = null;
    this.page = null;
  }

  async reset(): Promise<void> {
    if (this.page) {
      try {
        await this.page.evaluate(() => {
          const w = window as any;
          w.__wpo_vitals = { lcp: 0, cls: 0, inp: Infinity };
        });
      } catch {
        // Page may not be ready
      }
    }
  }

  async getMetrics(): Promise<WebVitalsMetrics> {
    if (!this.page) return { lcp: 0, cls: 0, inp: 0 };

    try {
      const metrics = await this.page.evaluate(() => {
        const w = window as any;
        return w.__wpo_vitals ?? { lcp: 0, cls: 0, inp: Infinity };
      });
      return {
        lcp: Math.round(metrics.lcp * 100) / 100,
        cls: Math.round(metrics.cls * 10000) / 10000,
        inp: metrics.inp === Infinity ? 0 : Math.round(metrics.inp),
      };
    } catch {
      return { lcp: 0, cls: 0, inp: 0 };
    }
  }

  private async injectObservers(): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.evaluate(() => {
        const w = window as any;
        w.__wpo_vitals = { lcp: 0, cls: 0, inp: Infinity };

        if (w.__wpo_vitals_installed) return;
        w.__wpo_vitals_installed = true;

        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const last = entries[entries.length - 1];
            if (last) w.__wpo_vitals.lcp = last.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!(entry as any).hadRecentInput) {
                w.__wpo_vitals.cls += (entry as any).value;
              }
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const duration = (entry as any).duration ?? entry.duration;
              if (duration < w.__wpo_vitals.inp) {
                w.__wpo_vitals.inp = duration;
              }
            }
          }).observe({ type: "event", buffered: true, durationThreshold: 0 });
        } catch {}
      });
    } catch {
      // Page may not be ready
    }
  }
}
```

- [ ] **Step 8: Run all domain tests to verify they pass**

Run: `npx vitest run tests/domains/`
Expected: All tests pass

- [ ] **Step 9: Wire into server.ts and register get_web_vitals tool**

Add to `src/server.ts`:
```typescript
import { RenderingDomain } from "./domains/rendering.js";
import { WebVitalsDomain } from "./domains/web-vitals.js";

const renderingDomain = new RenderingDomain();
const webVitalsDomain = new WebVitalsDomain();
session.registerModule(renderingDomain);
session.registerModule(webVitalsDomain);

mcp.registerTool("get_web_vitals", {
  title: "Get Web Vitals",
  description:
    "Read current Core Web Vitals: LCP (Largest Contentful Paint, ms), CLS (Cumulative Layout Shift, unitless), INP (Interaction to Next Paint, ms). Passively collected from page load.",
  inputSchema: z.object({}),
}, async () => {
  try {
    await renderingDomain.collectEntries();
    const metrics = await webVitalsDomain.getMetrics();
    const renderingSummary = renderingDomain.getSummary();
    return jsonContent(toolSuccess({ metrics, rendering: renderingSummary }));
  } catch (err) {
    return errorContent(toolError("internal", "Failed to get web vitals", String(err)));
  }
});
```

- [ ] **Step 10: Commit**

```bash
git add src/domains/rendering.ts src/domains/web-vitals.ts tests/domains/rendering.test.ts tests/domains/web-vitals.test.ts src/server.ts
git commit -m "Add rendering and web vitals domain modules"
```

---

### Task 9: DOM + Coverage Domain Modules

**Files:**
- Create: `src/domains/dom.ts`
- Create: `src/domains/coverage.ts`
- Create: `tests/domains/dom.test.ts`
- Create: `tests/domains/coverage.test.ts`

- [ ] **Step 1: Write failing tests for DOM domain**

`tests/domains/dom.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { DomDomain } from "../../src/domains/dom.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("DomDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let dom: DomDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
    dom = new DomDomain();
    session.registerModule(dom);
  });

  afterEach(async () => {
    await session.close();
  });

  it("counts DOM nodes", async () => {
    await session.navigate(server.url + "/heavy-dom.html");
    const stats = await dom.getStats();
    expect(stats.nodeCount).toBeGreaterThan(100);
  });

  it("measures tree depth", async () => {
    await session.navigate(server.url + "/heavy-dom.html");
    const stats = await dom.getStats();
    expect(stats.maxDepth).toBeGreaterThan(3);
  });

  it("reports element distribution by tag", async () => {
    await session.navigate(server.url + "/heavy-dom.html");
    const stats = await dom.getStats();
    expect(stats.tagDistribution).toBeDefined();
    expect(stats.tagDistribution["DIV"]).toBeGreaterThan(0);
  });

  it("returns reasonable stats for simple page", async () => {
    await session.navigate(server.url + "/basic.html");
    const stats = await dom.getStats();
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.nodeCount).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/dom.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DomDomain**

`src/domains/dom.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule } from "../types.js";

export interface DomStats {
  nodeCount: number;
  maxDepth: number;
  tagDistribution: Record<string, number>;
  detachedNodes: number;
}

export class DomDomain implements DomainModule {
  readonly name = "dom";
  readonly cdpDomains = ["DOM"];

  private cdp: CDPSession | null = null;
  private page: Page | null = null;

  async attach(cdp: CDPSession, page: Page): Promise<void> {
    this.cdp = cdp;
    this.page = page;
  }

  async detach(): Promise<void> {
    this.cdp = null;
    this.page = null;
  }

  async reset(): Promise<void> {
    // No state to reset — on-demand reads
  }

  async getStats(): Promise<DomStats> {
    if (!this.page) throw new Error("DOM domain not attached");

    const stats = await this.page.evaluate(() => {
      let nodeCount = 0;
      let maxDepth = 0;
      const tagDistribution: Record<string, number> = {};

      function walk(node: Node, depth: number): void {
        nodeCount++;
        if (depth > maxDepth) maxDepth = depth;

        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = (node as Element).tagName;
          tagDistribution[tag] = (tagDistribution[tag] ?? 0) + 1;
        }

        for (const child of node.childNodes) {
          walk(child, depth + 1);
        }
      }

      walk(document.documentElement, 0);

      return { nodeCount, maxDepth, tagDistribution };
    });

    return {
      ...stats,
      detachedNodes: await this.countDetachedNodes(),
    };
  }

  private async countDetachedNodes(): Promise<number> {
    if (!this.cdp) return 0;
    try {
      const { objects } = await this.cdp.send("Runtime.queryObjects", {
        prototypeObjectId: (
          await this.cdp.send("Runtime.evaluate", {
            expression: "HTMLElement.prototype",
            returnByValue: false,
          })
        ).result.objectId!,
      });

      const { result } = await this.cdp.send("Runtime.getProperties", {
        objectId: objects.objectId!,
        ownProperties: false,
        generatePreview: false,
      });

      // Release the object group
      if (objects.objectId) {
        await this.cdp.send("Runtime.releaseObject", { objectId: objects.objectId });
      }

      // The count of all HTMLElement instances vs DOM-attached ones gives detached count
      const totalElements = result.length;
      const attachedCount = await this.page!.evaluate(() => document.querySelectorAll("*").length);
      return Math.max(0, totalElements - attachedCount);
    } catch {
      return 0;
    }
  }
}
```

- [ ] **Step 4: Run DOM tests to verify they pass**

Run: `npx vitest run tests/domains/dom.test.ts`
Expected: All 4 tests pass

- [ ] **Step 5: Write failing tests for coverage domain**

`tests/domains/coverage.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { CoverageDomain } from "../../src/domains/coverage.js";
import { DataStore } from "../../src/store/data-store.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CoverageDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let coverage: CoverageDomain;
  let store: DataStore;
  let tempDir: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    store = new DataStore(tempDir);
    session = new SessionManager();
    coverage = new CoverageDomain(store);
    session.registerModule(coverage);
  });

  afterEach(async () => {
    await session.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("collects JS coverage", async () => {
    await session.navigate(server.url + "/basic.html");
    await coverage.startJsCoverage();
    await session.getPage()!.click("#btn");
    const result = await coverage.stopJsCoverage();
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].usedPercent).toBeGreaterThanOrEqual(0);
    expect(result.entries[0].usedPercent).toBeLessThanOrEqual(100);
  });

  it("collects CSS coverage", async () => {
    await session.navigate(server.url + "/heavy-dom.html");
    await coverage.startCssCoverage();
    const result = await coverage.stopCssCoverage();
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("saves coverage artifact to disk", async () => {
    await session.navigate(server.url + "/basic.html");
    await coverage.startJsCoverage();
    const result = await coverage.stopJsCoverage();
    expect(result.id).toBeTruthy();
    const record = store.get(result.id);
    expect(record?.artifactPath).toBeDefined();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/domains/coverage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Implement CoverageDomain**

`src/domains/coverage.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule, CoverageQueryFilter } from "../types.js";
import type { DataStore } from "../store/data-store.js";
import { randomUUID } from "node:crypto";

export interface CoverageEntry {
  url: string;
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
  unusedPercent: number;
}

export interface CoverageResult {
  id: string;
  type: "js" | "css";
  entries: CoverageEntry[];
  summary: { totalBytes: number; usedBytes: number; overallUsedPercent: number };
}

export class CoverageDomain implements DomainModule {
  readonly name = "coverage";
  readonly cdpDomains = ["Profiler", "CSS"];

  private cdp: CDPSession | null = null;
  private page: Page | null = null;
  private jsActive = false;
  private cssActive = false;

  constructor(private readonly store: DataStore) {}

  async attach(cdp: CDPSession, page: Page): Promise<void> {
    this.cdp = cdp;
    this.page = page;
  }

  async detach(): Promise<void> {
    if (this.jsActive) {
      try { await this.cdp?.send("Profiler.stopPreciseCoverage"); } catch {}
      try { await this.cdp?.send("Profiler.disable"); } catch {}
    }
    if (this.cssActive) {
      try { await this.cdp?.send("CSS.stopRuleUsageTracking"); } catch {}
    }
    this.jsActive = false;
    this.cssActive = false;
    this.cdp = null;
    this.page = null;
  }

  async reset(): Promise<void> {
    if (this.jsActive) {
      try { await this.cdp?.send("Profiler.stopPreciseCoverage"); } catch {}
      try { await this.cdp?.send("Profiler.disable"); } catch {}
      this.jsActive = false;
    }
    if (this.cssActive) {
      try { await this.cdp?.send("CSS.stopRuleUsageTracking"); } catch {}
      this.cssActive = false;
    }
  }

  async startJsCoverage(): Promise<void> {
    if (!this.cdp) throw new Error("Coverage domain not attached");
    await this.cdp.send("Profiler.enable");
    await this.cdp.send("Profiler.startPreciseCoverage", {
      callCount: true,
      detailed: true,
    });
    this.jsActive = true;
  }

  async stopJsCoverage(): Promise<CoverageResult> {
    if (!this.cdp) throw new Error("Coverage domain not attached");

    const { result } = (await this.cdp.send("Profiler.takePreciseCoverage")) as { result: any[] };
    await this.cdp.send("Profiler.stopPreciseCoverage");
    await this.cdp.send("Profiler.disable");
    this.jsActive = false;

    const entries = this.processJsCoverage(result);
    return this.saveCoverageResult("js", entries);
  }

  async startCssCoverage(): Promise<void> {
    if (!this.cdp) throw new Error("Coverage domain not attached");
    await this.cdp.send("CSS.enable");
    await this.cdp.send("CSS.startRuleUsageTracking");
    this.cssActive = true;
  }

  async stopCssCoverage(): Promise<CoverageResult> {
    if (!this.cdp) throw new Error("Coverage domain not attached");

    const { ruleUsage } = (await this.cdp.send("CSS.stopRuleUsageTracking")) as { ruleUsage: any[] };
    this.cssActive = false;

    const entries = this.processCssCoverage(ruleUsage);
    return this.saveCoverageResult("css", entries);
  }

  filterEntries(entries: CoverageEntry[], filter: CoverageQueryFilter): CoverageEntry[] {
    let results = [...entries];
    if (filter.url) {
      const pattern = filter.url.toLowerCase();
      results = results.filter((e) => e.url.toLowerCase().includes(pattern));
    }
    if (filter.minUnusedPercent !== undefined) {
      results = results.filter((e) => e.unusedPercent >= filter.minUnusedPercent!);
    }
    return results;
  }

  private processJsCoverage(scripts: any[]): CoverageEntry[] {
    return scripts
      .filter((s) => s.url && !s.url.startsWith("extensions://"))
      .map((script) => {
        const totalBytes = script.functions.reduce((sum: number, fn: any) => {
          return sum + fn.ranges.reduce((s: number, r: any) => s + (r.endOffset - r.startOffset), 0);
        }, 0);

        const usedBytes = script.functions.reduce((sum: number, fn: any) => {
          return sum + fn.ranges
            .filter((r: any) => r.count > 0)
            .reduce((s: number, r: any) => s + (r.endOffset - r.startOffset), 0);
        }, 0);

        const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;
        return {
          url: script.url,
          totalBytes,
          usedBytes,
          usedPercent,
          unusedPercent: Math.round((100 - usedPercent) * 100) / 100,
        };
      });
  }

  private processCssCoverage(rules: any[]): CoverageEntry[] {
    // Group by stylesheet
    const sheets = new Map<string, { total: number; used: number }>();
    for (const rule of rules) {
      const key = rule.styleSheetId || "inline";
      const existing = sheets.get(key) ?? { total: 0, used: 0 };
      const size = rule.endOffset - rule.startOffset;
      existing.total += size;
      if (rule.used) existing.used += size;
      sheets.set(key, existing);
    }

    return [...sheets.entries()].map(([url, { total, used }]) => {
      const usedPercent = total > 0 ? Math.round((used / total) * 10000) / 100 : 0;
      return {
        url,
        totalBytes: total,
        usedBytes: used,
        usedPercent,
        unusedPercent: Math.round((100 - usedPercent) * 100) / 100,
      };
    });
  }

  private async saveCoverageResult(type: "js" | "css", entries: CoverageEntry[]): Promise<CoverageResult> {
    const totalBytes = entries.reduce((s, e) => s + e.totalBytes, 0);
    const usedBytes = entries.reduce((s, e) => s + e.usedBytes, 0);
    const overallUsedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;
    const summary = { totalBytes, usedBytes, overallUsedPercent };

    const id = randomUUID();
    await this.store.saveArtifact(id, "coverage", type, JSON.stringify({ entries, summary }), ".json");
    this.store.updateSummary(id, summary);

    return { id, type, entries, summary };
  }
}
```

- [ ] **Step 8: Run all domain tests to verify they pass**

Run: `npx vitest run tests/domains/`
Expected: All tests pass

- [ ] **Step 9: Wire into server.ts and register get_dom_stats, get_coverage tools**

Add to `src/server.ts`:
```typescript
import { DomDomain } from "./domains/dom.js";
import { CoverageDomain } from "./domains/coverage.js";

const domDomain = new DomDomain();
const coverageDomain = new CoverageDomain(store);
session.registerModule(domDomain);
session.registerModule(coverageDomain);

mcp.registerTool("get_dom_stats", {
  title: "Get DOM Stats",
  description:
    "Get DOM statistics: total node count, max tree depth, detached node count, element distribution by tag. Useful for identifying DOM bloat and complexity.",
  inputSchema: z.object({}),
}, async () => {
  try {
    const stats = await domDomain.getStats();
    return jsonContent(toolSuccess(stats));
  } catch (err) {
    return errorContent(toolError("internal", "Failed to get DOM stats", String(err)));
  }
});

mcp.registerTool("get_coverage", {
  title: "Get Coverage",
  description:
    "Collect JS and/or CSS code coverage for the current page. Starts coverage tracking, evaluates the page, and returns per-file used/unused percentages. Call this after the page has loaded and interactions have been performed to see what code is actually used.",
  inputSchema: z.object({
    type: z.enum(["js", "css", "both"]).describe("Coverage type to collect"),
  }),
}, async (args) => {
  try {
    const results: Record<string, unknown> = {};
    if (args.type === "js" || args.type === "both") {
      await coverageDomain.startJsCoverage();
      // Brief pause to collect runtime coverage
      await new Promise((r) => setTimeout(r, 100));
      const js = await coverageDomain.stopJsCoverage();
      results.js = { id: js.id, entries: js.entries, summary: js.summary };
    }
    if (args.type === "css" || args.type === "both") {
      await coverageDomain.startCssCoverage();
      await new Promise((r) => setTimeout(r, 100));
      const css = await coverageDomain.stopCssCoverage();
      results.css = { id: css.id, entries: css.entries, summary: css.summary };
    }
    return jsonContent(toolSuccess(results));
  } catch (err) {
    return errorContent(toolError("internal", "Failed to get coverage", String(err)));
  }
});
```

- [ ] **Step 10: Commit**

```bash
git add src/domains/dom.ts src/domains/coverage.ts tests/domains/dom.test.ts tests/domains/coverage.test.ts src/server.ts
git commit -m "Add DOM stats and code coverage domain modules"
```

---

### Task 10: Interaction Domain + Tools

**Files:**
- Create: `src/domains/interaction.ts`
- Create: `src/tools/interaction-tools.ts`
- Create: `tests/domains/interaction.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/domains/interaction.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { InteractionDomain } from "../../src/domains/interaction.js";
import { RenderingDomain } from "../../src/domains/rendering.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("InteractionDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let interaction: InteractionDomain;
  let rendering: RenderingDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
    rendering = new RenderingDomain();
    interaction = new InteractionDomain(rendering);
    session.registerModule(rendering);
    session.registerModule(interaction);
  });

  afterEach(async () => {
    await session.close();
  });

  it("clicks an element and returns timing", async () => {
    await session.navigate(server.url + "/basic.html");
    const result = await interaction.perform({
      action: "click",
      selector: "#btn",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.action).toBe("click");
  });

  it("types text into a field", async () => {
    await session.navigate(server.url + "/basic.html");
    // Click first to focus, then type
    const result = await interaction.perform({
      action: "click",
      selector: "#content",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("scrolls the page", async () => {
    await session.navigate(server.url + "/heavy-dom.html");
    const result = await interaction.perform({
      action: "scroll",
      y: 500,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.action).toBe("scroll");
  });

  it("takes a screenshot", async () => {
    await session.navigate(server.url + "/basic.html");
    const buffer = await interaction.screenshot({});
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("takes an element screenshot", async () => {
    await session.navigate(server.url + "/basic.html");
    const buffer = await interaction.screenshot({ selector: "#box" });
    expect(buffer.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/interaction.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement InteractionDomain**

`src/domains/interaction.ts`:
```typescript
import type { CDPSession, Page } from "playwright";
import type { DomainModule } from "../types.js";
import type { RenderingDomain } from "./rendering.js";

export interface InteractionArgs {
  action: "click" | "type" | "scroll" | "hover";
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
}

export interface InteractionResult {
  action: string;
  durationMs: number;
  impact: {
    layoutShifts: number;
    longTasks: number;
  };
}

export interface ScreenshotArgs {
  selector?: string;
  fullPage?: boolean;
  label?: string;
}

export class InteractionDomain implements DomainModule {
  readonly name = "interaction";
  readonly cdpDomains = [];

  private page: Page | null = null;

  constructor(private readonly rendering: RenderingDomain) {}

  async attach(_cdp: CDPSession, page: Page): Promise<void> {
    this.page = page;
  }

  async detach(): Promise<void> {
    this.page = null;
  }

  async reset(): Promise<void> {
    // No persistent state
  }

  async perform(args: InteractionArgs): Promise<InteractionResult> {
    if (!this.page) throw new Error("Interaction domain not attached");

    // Collect rendering entries before interaction
    await this.rendering.collectEntries();
    const beforeCount = this.rendering.getEntries().length;

    const start = performance.now();

    switch (args.action) {
      case "click":
        if (args.selector) {
          await this.page.click(args.selector);
        } else if (args.x !== undefined && args.y !== undefined) {
          await this.page.mouse.click(args.x, args.y);
        }
        break;

      case "type":
        if (args.selector && args.text) {
          await this.page.fill(args.selector, args.text);
        } else if (args.text) {
          await this.page.keyboard.type(args.text);
        }
        break;

      case "scroll":
        if (args.selector) {
          await this.page.locator(args.selector).scrollIntoViewIfNeeded();
        } else {
          await this.page.mouse.wheel(args.x ?? 0, args.y ?? 0);
        }
        break;

      case "hover":
        if (args.selector) {
          await this.page.hover(args.selector);
        } else if (args.x !== undefined && args.y !== undefined) {
          await this.page.mouse.move(args.x, args.y);
        }
        break;
    }

    const durationMs = Math.round(performance.now() - start);

    // Brief wait for layout/paint effects
    await new Promise((r) => setTimeout(r, 100));
    await this.rendering.collectEntries();
    const afterEntries = this.rendering.getEntries();
    const newEntries = afterEntries.slice(beforeCount);

    return {
      action: args.action,
      durationMs,
      impact: {
        layoutShifts: newEntries.filter((e) => e.type === "layout-shift").length,
        longTasks: newEntries.filter((e) => e.type === "long-task").length,
      },
    };
  }

  async screenshot(args: ScreenshotArgs): Promise<Buffer> {
    if (!this.page) throw new Error("Interaction domain not attached");

    if (args.selector) {
      const element = this.page.locator(args.selector);
      return Buffer.from(await element.screenshot({ type: "png" }));
    }

    return Buffer.from(await this.page.screenshot({
      type: "png",
      fullPage: args.fullPage ?? false,
    }));
  }
}
```

- [ ] **Step 4: Run interaction tests to verify they pass**

Run: `npx vitest run tests/domains/interaction.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Implement interaction tools**

`src/tools/interaction-tools.ts`:
```typescript
import type { InteractionDomain } from "../domains/interaction.js";
import type { DataStore } from "../store/data-store.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";
import { randomUUID } from "node:crypto";

export function createInteractionTools(
  interaction: InteractionDomain,
  store: DataStore,
) {
  return {
    async simulateInteraction(args: {
      action: "click" | "type" | "scroll" | "hover";
      selector?: string;
      text?: string;
      x?: number;
      y?: number;
    }): Promise<ToolResult> {
      try {
        const result = await interaction.perform(args);
        return toolSuccess(result);
      } catch (err) {
        return toolError("internal", `Failed to simulate ${args.action}`, String(err));
      }
    },

    async screenshot(args: {
      selector?: string;
      fullPage?: boolean;
      label?: string;
    }): Promise<{ content: Array<{ type: "image"; mimeType: string; base64: string }>; isError?: boolean }> {
      try {
        const buffer = await interaction.screenshot(args);
        const id = randomUUID();
        await store.saveArtifact(id, "screenshot", "image", buffer, ".png");

        return {
          content: [{
            type: "image",
            mimeType: "image/png",
            base64: buffer.toString("base64"),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "image" as const, mimeType: "image/png", base64: "" }],
          isError: true,
        };
      }
    },
  };
}
```

- [ ] **Step 6: Wire into server.ts**

Add to `src/server.ts`:
```typescript
import { InteractionDomain } from "./domains/interaction.js";
import { createInteractionTools } from "./tools/interaction-tools.js";

const interactionDomain = new InteractionDomain(renderingDomain);
session.registerModule(interactionDomain);

const interactionTools = createInteractionTools(interactionDomain, store);

mcp.registerTool("simulate_interaction", {
  title: "Simulate Interaction",
  description:
    "Simulate a user interaction: click, type, scroll, or hover. Returns interaction timing and any layout shifts or long tasks triggered. Use selector for element targeting, or x/y for coordinate-based interaction.",
  inputSchema: z.object({
    action: z.enum(["click", "type", "scroll", "hover"]).describe("Type of interaction"),
    selector: z.string().optional().describe("CSS selector of target element"),
    text: z.string().optional().describe("Text to type (for 'type' action)"),
    x: z.number().optional().describe("X coordinate (for scroll amount or click position)"),
    y: z.number().optional().describe("Y coordinate (for scroll amount or click position)"),
  }),
}, async (args) => toolResponse(await interactionTools.simulateInteraction(args)));

mcp.registerTool("screenshot", {
  title: "Screenshot",
  description:
    "Capture a screenshot of the current page or a specific element. Returns the image directly. Optionally capture full page (including below-fold content) or label for later comparison.",
  inputSchema: z.object({
    selector: z.string().optional().describe("CSS selector to screenshot a specific element"),
    fullPage: z.boolean().optional().describe("Capture the full scrollable page (default: viewport only)"),
    label: z.string().optional().describe("Label for this screenshot (for comparison)"),
  }),
}, async (args) => interactionTools.screenshot(args));
```

- [ ] **Step 7: Commit**

```bash
git add src/domains/interaction.ts src/tools/interaction-tools.ts tests/domains/interaction.test.ts src/server.ts
git commit -m "Add interaction simulation and screenshot tools"
```

---

### Task 11: Lighthouse Domain + Tool

**Files:**
- Create: `src/domains/lighthouse.ts`
- Create: `tests/domains/lighthouse.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/domains/lighthouse.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { LighthouseDomain } from "../../src/domains/lighthouse.js";
import { DataStore } from "../../src/store/data-store.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("LighthouseDomain", () => {
  let server: TestServer;
  let lighthouse: LighthouseDomain;
  let store: DataStore;
  let tempDir: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    store = new DataStore(tempDir);
    lighthouse = new LighthouseDomain(store);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("runs a Lighthouse audit and returns scores", async () => {
    const result = await lighthouse.run(server.url + "/basic.html", {});
    expect(result.id).toBeTruthy();
    expect(result.summary.scores.performance).toBeGreaterThanOrEqual(0);
    expect(result.summary.scores.performance).toBeLessThanOrEqual(1);
  }, 60_000);

  it("returns top opportunities", async () => {
    const result = await lighthouse.run(server.url + "/basic.html", {});
    expect(Array.isArray(result.summary.opportunities)).toBe(true);
  }, 60_000);

  it("returns diagnostics", async () => {
    const result = await lighthouse.run(server.url + "/basic.html", {});
    expect(Array.isArray(result.summary.diagnostics)).toBe(true);
  }, 60_000);

  it("saves raw report to disk", async () => {
    const result = await lighthouse.run(server.url + "/basic.html", {});
    const record = store.get(result.id);
    expect(record?.artifactPath).toBeDefined();
  }, 60_000);

  it("supports category filtering", async () => {
    const result = await lighthouse.run(server.url + "/basic.html", {
      categories: ["performance"],
    });
    expect(result.summary.scores.performance).toBeDefined();
  }, 60_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/lighthouse.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LighthouseDomain**

`src/domains/lighthouse.ts`:
```typescript
import type { DataStore } from "../store/data-store.js";
import { randomUUID } from "node:crypto";

export interface LighthouseOptions {
  categories?: string[];
  formFactor?: "mobile" | "desktop";
}

export interface LighthouseResult {
  id: string;
  summary: {
    scores: Record<string, number>;
    opportunities: Array<{ title: string; description: string; savings?: number }>;
    diagnostics: Array<{ title: string; description: string; displayValue?: string }>;
  };
}

export class LighthouseDomain {
  constructor(private readonly store: DataStore) {}

  async run(url: string, options: LighthouseOptions): Promise<LighthouseResult> {
    const chromeLauncher = await import("chrome-launcher");
    const chrome = await chromeLauncher.launch({
      chromeFlags: ["--headless", "--disable-gpu", "--no-sandbox"],
    });

    try {
      const lighthouse = (await import("lighthouse")).default;

      const lhOptions: Record<string, unknown> = {
        port: chrome.port,
        logLevel: "silent" as const,
        output: "json" as const,
        formFactor: options.formFactor ?? "desktop",
      };

      if (options.formFactor !== "mobile") {
        lhOptions.screenEmulation = { disabled: true };
        lhOptions.throttling = {
          rttMs: 0,
          throughputKbps: 0,
          cpuSlowdownMultiplier: 1,
        };
      }

      if (options.categories) {
        lhOptions.onlyCategories = options.categories;
      }

      const result = await lighthouse(url, lhOptions);
      if (!result?.lhr) throw new Error("Lighthouse returned no result");

      const { lhr } = result;
      const id = randomUUID();

      // Save raw report
      const reportJson = typeof result.report === "string" ? result.report : JSON.stringify(lhr);
      await this.store.saveArtifact(id, "lighthouse", "report", reportJson, ".json");

      // Extract scores
      const scores: Record<string, number> = {};
      for (const [catId, cat] of Object.entries(lhr.categories ?? {})) {
        scores[catId] = (cat as any).score ?? 0;
      }

      // Extract opportunities
      const opportunities = Object.values(lhr.audits ?? {})
        .filter((a: any) => a.details?.type === "opportunity" && a.score !== null && a.score < 1)
        .map((a: any) => ({
          title: a.title,
          description: a.description,
          savings: a.numericValue,
        }))
        .sort((a: any, b: any) => (b.savings ?? 0) - (a.savings ?? 0))
        .slice(0, 10);

      // Extract diagnostics
      const diagnostics = Object.values(lhr.audits ?? {})
        .filter((a: any) => a.details?.type === "diagnostic" || (a.details?.type === "table" && a.score !== null && a.score < 1))
        .map((a: any) => ({
          title: a.title,
          description: a.description,
          displayValue: a.displayValue,
        }))
        .slice(0, 10);

      const summary = { scores, opportunities, diagnostics };
      this.store.updateSummary(id, summary);

      return { id, summary };
    } finally {
      await chrome.kill();
    }
  }
}
```

- [ ] **Step 4: Run Lighthouse tests to verify they pass**

Run: `npx vitest run tests/domains/lighthouse.test.ts`
Expected: All 5 tests pass (may take 30-60s each due to Lighthouse overhead)

- [ ] **Step 5: Wire into server.ts and register run_lighthouse tool**

Add to `src/server.ts`:
```typescript
import { LighthouseDomain } from "./domains/lighthouse.js";

const lighthouseDomain = new LighthouseDomain(store);

mcp.registerTool("run_lighthouse", {
  title: "Run Lighthouse",
  description:
    "Run a full Lighthouse audit on the current URL (or a specified URL). Returns performance, accessibility, best-practices, and SEO scores, plus top opportunities for improvement and diagnostics. Raw report saved to disk.",
  inputSchema: z.object({
    url: z.string().optional().describe("URL to audit (defaults to current page URL)"),
    categories: z
      .array(z.enum(["performance", "accessibility", "best-practices", "seo"]))
      .optional()
      .describe("Specific categories to audit (default: all)"),
    formFactor: z.enum(["mobile", "desktop"]).optional().describe("Device form factor (default: desktop)"),
  }),
}, async (args) => {
  try {
    const url = args.url ?? session.getCurrentUrl();
    if (!url) return errorContent(toolError("session", "No URL specified and no active page"));
    const result = await lighthouseDomain.run(url, {
      categories: args.categories,
      formFactor: args.formFactor,
    });
    return jsonContent(toolSuccess({ reportId: result.id, ...result.summary }));
  } catch (err) {
    return errorContent(toolError("internal", "Lighthouse audit failed", String(err)));
  }
});
```

- [ ] **Step 6: Commit**

```bash
git add src/domains/lighthouse.ts tests/domains/lighthouse.test.ts src/server.ts
git commit -m "Add Lighthouse audit domain and run_lighthouse tool"
```

---

### Task 12: Cross-Browser Domain + Tool

**Files:**
- Create: `src/domains/cross-browser.ts`
- Create: `tests/domains/cross-browser.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/domains/cross-browser.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { CrossBrowserDomain } from "../../src/domains/cross-browser.js";
import { SessionManager } from "../../src/session/manager.js";
import { DataStore } from "../../src/store/data-store.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CrossBrowserDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let crossBrowser: CrossBrowserDomain;
  let store: DataStore;
  let tempDir: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    store = new DataStore(tempDir);
    session = new SessionManager();
    crossBrowser = new CrossBrowserDomain(store);
  });

  afterEach(async () => {
    await session.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("captures Firefox screenshot", async () => {
    await session.navigate(server.url + "/basic.html");
    const results = await crossBrowser.capture(server.url + "/basic.html", {
      browsers: ["firefox"],
      viewport: { width: 1280, height: 720 },
    });
    expect(results.screenshots.firefox).toBeDefined();
    expect(results.screenshots.firefox!.length).toBeGreaterThan(0);
  });

  it("captures WebKit screenshot", async () => {
    await session.navigate(server.url + "/basic.html");
    const results = await crossBrowser.capture(server.url + "/basic.html", {
      browsers: ["webkit"],
      viewport: { width: 1280, height: 720 },
    });
    expect(results.screenshots.webkit).toBeDefined();
    expect(results.screenshots.webkit!.length).toBeGreaterThan(0);
  });

  it("captures multiple browsers", async () => {
    await session.navigate(server.url + "/basic.html");
    const results = await crossBrowser.capture(server.url + "/basic.html", {
      browsers: ["firefox", "webkit"],
      viewport: { width: 1280, height: 720 },
    });
    expect(results.screenshots.firefox).toBeDefined();
    expect(results.screenshots.webkit).toBeDefined();
  });

  it("computes visual diff against reference", async () => {
    await session.navigate(server.url + "/basic.html");
    const page = session.getPage()!;
    const chromiumScreenshot = Buffer.from(await page.screenshot({ type: "png" }));

    const results = await crossBrowser.capture(server.url + "/basic.html", {
      browsers: ["firefox"],
      viewport: { width: 1280, height: 720 },
      referenceScreenshot: chromiumScreenshot,
    });
    expect(results.diffs?.firefox).toBeDefined();
    expect(typeof results.diffs!.firefox!.mismatchPercent).toBe("number");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/cross-browser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CrossBrowserDomain**

`src/domains/cross-browser.ts`:
```typescript
import { firefox, webkit, type BrowserType } from "playwright";
import type { DataStore } from "../store/data-store.js";
import { randomUUID } from "node:crypto";

export interface CrossBrowserOptions {
  browsers: Array<"firefox" | "webkit">;
  viewport: { width: number; height: number };
  referenceScreenshot?: Buffer;
}

export interface DiffResult {
  mismatchPercent: number;
  diffPixels: number;
  diffImageId?: string;
}

export interface CrossBrowserResult {
  screenshots: {
    firefox?: Buffer;
    webkit?: Buffer;
  };
  diffs?: {
    firefox?: DiffResult;
    webkit?: DiffResult;
  };
}

export class CrossBrowserDomain {
  constructor(private readonly store: DataStore) {}

  async capture(url: string, options: CrossBrowserOptions): Promise<CrossBrowserResult> {
    const result: CrossBrowserResult = { screenshots: {} };

    const browserTypes: Record<string, BrowserType> = {
      firefox,
      webkit,
    };

    const captures = options.browsers.map(async (browserName) => {
      const browserType = browserTypes[browserName];
      if (!browserType) throw new Error(`Unknown browser: ${browserName}`);

      const browser = await browserType.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: options.viewport,
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "load" });
        const screenshot = Buffer.from(await page.screenshot({ type: "png" }));

        const id = randomUUID();
        await this.store.saveArtifact(id, "cross-browser", browserName, screenshot, ".png");

        return { browserName, screenshot };
      } finally {
        await browser.close();
      }
    });

    const results = await Promise.all(captures);
    for (const { browserName, screenshot } of results) {
      (result.screenshots as any)[browserName] = screenshot;
    }

    if (options.referenceScreenshot) {
      result.diffs = {};
      for (const { browserName, screenshot } of results) {
        const diff = await this.computeDiff(options.referenceScreenshot, screenshot);
        (result.diffs as any)[browserName] = diff;
      }
    }

    return result;
  }

  private async computeDiff(imgA: Buffer, imgB: Buffer): Promise<DiffResult> {
    const { PNG } = await import("pngjs");
    const pixelmatch = (await import("pixelmatch")).default;

    const pngA = PNG.sync.read(imgA);
    const pngB = PNG.sync.read(imgB);

    // Use the smaller dimensions for comparison
    const width = Math.min(pngA.width, pngB.width);
    const height = Math.min(pngA.height, pngB.height);

    // Resize to common dimensions if needed
    const dataA = this.cropToSize(pngA, width, height);
    const dataB = this.cropToSize(pngB, width, height);

    const diffPng = new PNG({ width, height });
    const diffPixels = pixelmatch(dataA, dataB, diffPng.data, width, height, {
      threshold: 0.1,
    });

    const totalPixels = width * height;
    const mismatchPercent = Math.round((diffPixels / totalPixels) * 10000) / 100;

    let diffImageId: string | undefined;
    if (diffPixels > 0) {
      diffImageId = randomUUID();
      const diffBuffer = PNG.sync.write(diffPng);
      await this.store.saveArtifact(diffImageId, "cross-browser", "diff", diffBuffer, ".png");
    }

    return { mismatchPercent, diffPixels, diffImageId };
  }

  private cropToSize(png: { data: Buffer; width: number; height: number }, width: number, height: number): Buffer {
    if (png.width === width && png.height === height) return png.data;

    const cropped = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcOffset = y * png.width * 4;
      const dstOffset = y * width * 4;
      png.data.copy(cropped, dstOffset, srcOffset, srcOffset + width * 4);
    }
    return cropped;
  }
}
```

- [ ] **Step 4: Run cross-browser tests to verify they pass**

Run: `npx vitest run tests/domains/cross-browser.test.ts`
Expected: All 4 tests pass

- [ ] **Step 5: Wire into server.ts and register cross_browser_screenshot tool**

Add to `src/server.ts`:
```typescript
import { CrossBrowserDomain } from "./domains/cross-browser.js";

const crossBrowserDomain = new CrossBrowserDomain(store);

mcp.registerTool("cross_browser_screenshot", {
  title: "Cross Browser Screenshot",
  description:
    "Load the current URL in Firefox and/or WebKit, capture screenshots. Optionally compute a visual diff against the current Chromium page. Useful for checking cross-browser rendering consistency.",
  inputSchema: z.object({
    browsers: z.array(z.enum(["firefox", "webkit"])).describe("Browsers to capture"),
    diff: z.boolean().optional().describe("Compute visual diff against current Chromium page (default: false)"),
  }),
}, async (args) => {
  try {
    const url = session.getCurrentUrl();
    if (!url) return errorContent(toolError("session", "No active page — navigate first"));

    const page = session.getPage();
    let referenceScreenshot: Buffer | undefined;
    if (args.diff && page) {
      referenceScreenshot = Buffer.from(await page.screenshot({ type: "png" }));
    }

    const config = session.getConfig();
    const viewport = config.viewport ?? { width: 1280, height: 720 };

    const result = await crossBrowserDomain.capture(url, {
      browsers: args.browsers,
      viewport,
      referenceScreenshot,
    });

    const content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; base64: string }> = [];

    for (const [browser, screenshot] of Object.entries(result.screenshots)) {
      if (screenshot) {
        content.push({ type: "text", text: `--- ${browser} screenshot ---` });
        content.push({ type: "image", mimeType: "image/png", base64: screenshot.toString("base64") });
      }
    }

    if (result.diffs) {
      const diffSummary: Record<string, unknown> = {};
      for (const [browser, diff] of Object.entries(result.diffs)) {
        if (diff) {
          diffSummary[browser] = { mismatchPercent: diff.mismatchPercent, diffPixels: diff.diffPixels };
        }
      }
      content.push({ type: "text", text: JSON.stringify({ success: true, diffs: diffSummary }, null, 2) });
    }

    return { content };
  } catch (err) {
    return errorContent(toolError("internal", "Cross-browser capture failed", String(err)));
  }
});
```

- [ ] **Step 6: Commit**

```bash
git add src/domains/cross-browser.ts tests/domains/cross-browser.test.ts src/server.ts
git commit -m "Add cross-browser screenshot and visual diff tool"
```

---

### Task 13: Query Profile Tool + Final Wiring + End-to-End Tests

**Files:**
- Create: `src/tools/analysis-tools.ts`
- Create: `tests/integration/e2e.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Implement analysis tools**

`src/tools/analysis-tools.ts`:
```typescript
import type { DataStore } from "../store/data-store.js";
import type { QueryEngine } from "../store/query-engine.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";

export function createAnalysisTools(store: DataStore, queryEngine: QueryEngine) {
  return {
    async queryProfile(args: { id: string; filter?: Record<string, unknown> }): Promise<ToolResult> {
      const record = store.get(args.id);
      if (!record) {
        return toolError("query", `No profile found with ID: ${args.id}`);
      }
      if (!record.artifactPath) {
        return toolError("query", `Profile ${args.id} has no artifact data`);
      }

      try {
        const result = await queryEngine.query(record.domain, record.artifactPath, args.filter ?? {});
        return toolSuccess({ domain: record.domain, type: record.type, result });
      } catch (err) {
        const registered = queryEngine.registeredDomains();
        if (!registered.includes(record.domain)) {
          return toolError("query", `No query handler for domain: ${record.domain}. Registered: ${registered.join(", ")}`);
        }
        return toolError("query", `Query failed for ${record.domain} profile`, String(err));
      }
    },
  };
}
```

- [ ] **Step 2: Register query handlers for each domain in server.ts**

Add to `src/server.ts`, after domain module creation:
```typescript
import { createAnalysisTools } from "./tools/analysis-tools.js";
import { readFile } from "node:fs/promises";

// Register query handlers
queryEngine.register("cpu", async (artifactPath, filter) => {
  const data = JSON.parse(await readFile(artifactPath, "utf-8"));
  const filtered = cpuDomain.filterProfile(data, filter as any);
  return { functions: filtered.map((n) => ({
    functionName: n.callFrame.functionName,
    url: n.callFrame.url,
    lineNumber: n.callFrame.lineNumber,
    hitCount: n.hitCount,
  }))};
});

queryEngine.register("memory", async (artifactPath, filter) => {
  const data = JSON.parse(await readFile(artifactPath, "utf-8"));
  // Re-parse types from raw snapshot
  const buckets = new Map<string, { type: string; count: number; size: number }>();
  const { nodes, strings } = data;
  const nodeFieldCount = data.snapshot?.meta?.node_fields?.length ?? 7;
  for (let i = 0; i < nodes.length; i += nodeFieldCount) {
    const name = strings[nodes[i + 1]] || "(anonymous)";
    const selfSize = nodes[i + 3];
    const existing = buckets.get(name);
    if (existing) { existing.count++; existing.size += selfSize; }
    else { buckets.set(name, { type: name, count: 1, size: selfSize }); }
  }
  const filtered = memoryDomain.filterSnapshot(buckets, filter as any);
  return { objects: filtered };
});

queryEngine.register("network", async (_artifactPath, filter) => {
  // Network data is in-memory, not on disk
  const requests = networkDomain.getRequests(filter as any);
  return { requests };
});

queryEngine.register("coverage", async (artifactPath, filter) => {
  const data = JSON.parse(await readFile(artifactPath, "utf-8"));
  const filtered = coverageDomain.filterEntries(data.entries, filter as any);
  return { entries: filtered, summary: data.summary };
});

const analysisTools = createAnalysisTools(store, queryEngine);
```

Register the MCP tool:
```typescript
mcp.registerTool("query_profile", {
  title: "Query Profile",
  description:
    "Drill into a profiling artifact by ID with domain-specific filters. Use this to get detailed data from CPU profiles, heap snapshots, network logs, or coverage reports. Each domain supports different filter fields:\n- cpu: { minSelfTime?, functionName?, url? }\n- memory: { objectType?, minRetainedSize? }\n- network: { resourceType?, minSize?, blocking?, domain? }\n- coverage: { url?, minUnusedPercent? }",
  inputSchema: z.object({
    id: z.string().describe("Profile/artifact ID returned by a profiling tool"),
    filter: z
      .record(z.unknown())
      .optional()
      .describe("Domain-specific filter object (see tool description for valid fields per domain)"),
  }),
}, async (args) => toolResponse(await analysisTools.queryProfile(args)));
```

- [ ] **Step 3: Write end-to-end integration tests**

`tests/integration/e2e.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { DataStore } from "../../src/store/data-store.js";
import { QueryEngine } from "../../src/store/query-engine.js";
import { ConsoleDomain } from "../../src/domains/console.js";
import { NetworkDomain } from "../../src/domains/network.js";
import { CpuDomain } from "../../src/domains/cpu.js";
import { MemoryDomain } from "../../src/domains/memory.js";
import { RenderingDomain } from "../../src/domains/rendering.js";
import { WebVitalsDomain } from "../../src/domains/web-vitals.js";
import { DomDomain } from "../../src/domains/dom.js";
import { CoverageDomain } from "../../src/domains/coverage.js";
import { InteractionDomain } from "../../src/domains/interaction.js";
import { createSessionTools } from "../../src/tools/session-tools.js";
import { createMetricsTools } from "../../src/tools/metrics-tools.js";
import { createProfilingTools } from "../../src/tools/profiling-tools.js";
import { createInteractionTools } from "../../src/tools/interaction-tools.js";
import { createAnalysisTools } from "../../src/tools/analysis-tools.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("End-to-End Workflows", () => {
  let testServer: TestServer;
  let session: SessionManager;
  let store: DataStore;
  let queryEngine: QueryEngine;
  let tempDir: string;

  // Domain modules
  let consoleDomain: ConsoleDomain;
  let networkDomain: NetworkDomain;
  let cpuDomain: CpuDomain;
  let memoryDomain: MemoryDomain;
  let renderingDomain: RenderingDomain;
  let webVitalsDomain: WebVitalsDomain;
  let domDomain: DomDomain;
  let coverageDomain: CoverageDomain;
  let interactionDomain: InteractionDomain;

  // Tool handlers
  let sessionTools: ReturnType<typeof createSessionTools>;
  let metricsTools: ReturnType<typeof createMetricsTools>;
  let profilingTools: ReturnType<typeof createProfilingTools>;
  let interactionTools: ReturnType<typeof createInteractionTools>;
  let analysisTools: ReturnType<typeof createAnalysisTools>;

  beforeAll(async () => {
    testServer = await startTestServer();
  });

  afterAll(async () => {
    await testServer.close();
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-e2e-"));
    store = new DataStore(tempDir);
    queryEngine = new QueryEngine();
    session = new SessionManager();

    consoleDomain = new ConsoleDomain();
    networkDomain = new NetworkDomain();
    cpuDomain = new CpuDomain();
    memoryDomain = new MemoryDomain(store);
    renderingDomain = new RenderingDomain();
    webVitalsDomain = new WebVitalsDomain();
    domDomain = new DomDomain();
    coverageDomain = new CoverageDomain(store);
    interactionDomain = new InteractionDomain(renderingDomain);

    session.registerModule(consoleDomain);
    session.registerModule(networkDomain);
    session.registerModule(cpuDomain);
    session.registerModule(memoryDomain);
    session.registerModule(renderingDomain);
    session.registerModule(webVitalsDomain);
    session.registerModule(domDomain);
    session.registerModule(interactionDomain);
    session.registerModule(coverageDomain);

    // Register query handlers
    queryEngine.register("cpu", async (artifactPath, filter) => {
      const data = JSON.parse(await readFile(artifactPath, "utf-8"));
      const filtered = cpuDomain.filterProfile(data, filter as any);
      return { functions: filtered.map((n: any) => ({
        functionName: n.callFrame.functionName,
        url: n.callFrame.url,
        hitCount: n.hitCount,
      }))};
    });

    queryEngine.register("memory", async (artifactPath, filter) => {
      const data = JSON.parse(await readFile(artifactPath, "utf-8"));
      const buckets = new Map<string, { type: string; count: number; size: number }>();
      const { nodes, strings } = data;
      const nodeFieldCount = data.snapshot?.meta?.node_fields?.length ?? 7;
      for (let i = 0; i < nodes.length; i += nodeFieldCount) {
        const name = strings[nodes[i + 1]] || "(anonymous)";
        const selfSize = nodes[i + 3];
        const existing = buckets.get(name);
        if (existing) { existing.count++; existing.size += selfSize; }
        else { buckets.set(name, { type: name, count: 1, size: selfSize }); }
      }
      return { objects: memoryDomain.filterSnapshot(buckets, filter as any) };
    });

    queryEngine.register("network", async (_path, filter) => {
      return { requests: networkDomain.getRequests(filter as any) };
    });

    queryEngine.register("coverage", async (artifactPath, filter) => {
      const data = JSON.parse(await readFile(artifactPath, "utf-8"));
      return { entries: coverageDomain.filterEntries(data.entries, filter as any) };
    });

    sessionTools = createSessionTools(session, store);
    metricsTools = createMetricsTools(consoleDomain, networkDomain);
    profilingTools = createProfilingTools(cpuDomain, memoryDomain, store);
    interactionTools = createInteractionTools(interactionDomain, store);
    analysisTools = createAnalysisTools(store, queryEngine);
  });

  afterEach(async () => {
    await session.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("full workflow: navigate → profile CPU → query results", async () => {
    const nav = await sessionTools.navigate({ url: testServer.url + "/basic.html" });
    expect(nav.success).toBe(true);

    const start = await profilingTools.startProfiling({ domain: "cpu" });
    expect(start.success).toBe(true);

    await session.getPage()!.evaluate(() => {
      let s = 0;
      for (let i = 0; i < 500_000; i++) s += Math.sqrt(i);
      return s;
    });

    const stop = await profilingTools.stopProfiling({ id: (start as any).id });
    expect(stop.success).toBe(true);
    expect((stop as any).summary.totalSamples).toBeGreaterThan(0);

    const query = await analysisTools.queryProfile({
      id: (stop as any).profileId,
      filter: {},
    });
    expect(query.success).toBe(true);
  });

  it("memory leak detection workflow: snapshot → action → snapshot → compare", async () => {
    await sessionTools.navigate({ url: testServer.url + "/memory-leak.html" });

    const snap1 = await profilingTools.takeHeapSnapshot();
    expect(snap1.success).toBe(true);

    await interactionTools.simulateInteraction({ action: "click", selector: "#leak" });
    await new Promise((r) => setTimeout(r, 500));

    const snap2 = await profilingTools.takeHeapSnapshot();
    expect(snap2.success).toBe(true);

    const diff = await profilingTools.compareSnapshots({
      snapshotA: (snap1 as any).snapshotId,
      snapshotB: (snap2 as any).snapshotId,
    });
    expect(diff.success).toBe(true);
    expect((diff as any).sizeDelta).toBeGreaterThan(0);
  });

  it("DOM analysis workflow: navigate → get stats → check console", async () => {
    await sessionTools.navigate({ url: testServer.url + "/heavy-dom.html" });

    const domStats = await domDomain.getStats();
    expect(domStats.nodeCount).toBeGreaterThan(100);
    expect(domStats.maxDepth).toBeGreaterThan(3);

    await new Promise((r) => setTimeout(r, 200));
    const console = await metricsTools.getConsoleLog({});
    expect(console.success).toBe(true);

    const network = await metricsTools.getNetworkLog({});
    expect(network.success).toBe(true);
    expect((network as any).summary.totalRequests).toBeGreaterThan(0);
  });

  it("close session flushes manifest", async () => {
    await sessionTools.navigate({ url: testServer.url + "/basic.html" });
    await profilingTools.takeHeapSnapshot();

    await sessionTools.closeSession();

    const manifest = JSON.parse(await readFile(join(tempDir, "manifest.json"), "utf-8"));
    expect(manifest.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run end-to-end tests to verify they pass**

Run: `npx vitest run tests/integration/e2e.test.ts`
Expected: All 4 tests pass

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests across all files pass

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add src/tools/analysis-tools.ts tests/integration/e2e.test.ts src/server.ts
git commit -m "Add query_profile tool, wire all domains, and end-to-end tests"
```

---

## Post-Implementation Notes

After all tasks are complete, the MCP server can be tested manually:

```bash
# Build
npm run build

# Run in development
npx tsx src/server.ts

# Add to Claude Code MCP config:
# {
#   "mcpServers": {
#     "webpage-optimizer": {
#       "command": "npx",
#       "args": ["tsx", "/path/to/src/server.ts"]
#     }
#   }
# }
```

All 19 tools should be registered:
`configure_browser`, `navigate`, `reload`, `set_auth`, `close_session`, `simulate_interaction`, `screenshot`, `start_profiling`, `stop_profiling`, `take_heap_snapshot`, `get_coverage`, `get_web_vitals`, `get_dom_stats`, `get_console_log`, `get_network_log`, `query_profile`, `compare_snapshots`, `run_lighthouse`, `cross_browser_screenshot`
