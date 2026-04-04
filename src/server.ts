import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SessionManager } from "./session/manager.js";
import { DataStore } from "./store/data-store.js";
import { QueryEngine } from "./store/query-engine.js";
import { ConsoleDomain } from "./domains/console.js";
import { NetworkDomain } from "./domains/network.js";
import { CpuDomain } from "./domains/cpu.js";
import { MemoryDomain } from "./domains/memory.js";
import { createSessionTools } from "./tools/session-tools.js";
import { createMetricsTools } from "./tools/metrics-tools.js";
import { createProfilingTools } from "./tools/profiling-tools.js";
import type { ToolResult } from "./types.js";

const OUTPUT_DIR = process.env.WPO_OUTPUT_DIR ?? "./webdev-mcp-data";

// ---- Core Services

const session = new SessionManager();
const store = new DataStore(OUTPUT_DIR);
const queryEngine = new QueryEngine();

// ---- Domain Modules

const consoleDomain = new ConsoleDomain();
const networkDomain = new NetworkDomain();
const cpuDomain = new CpuDomain();
const memoryDomain = new MemoryDomain(store);

// ---- Tool Handlers

const sessionTools = createSessionTools(session, store);
const metricsTools = createMetricsTools(consoleDomain, networkDomain);
const profilingTools = createProfilingTools(cpuDomain, memoryDomain, store);

// ---- MCP Server

const mcp = new McpServer({
  name: "claude-webdev-mcp",
  version: "0.1.0",
});

function jsonContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

function toolResponse(result: ToolResult) {
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

// ---- Profiling Tools

mcp.registerTool("start_profiling", {
  title: "Start Profiling",
  description: "Start a profiling session for the given domain. Returns a session ID to pass to stop_profiling.",
  inputSchema: z.object({
    domain: z.enum(["cpu", "memory_allocation", "rendering"]).describe("The profiling domain to start"),
  }),
}, async (args) => toolResponse(await profilingTools.startProfiling(args)));

mcp.registerTool("stop_profiling", {
  title: "Stop Profiling",
  description: "Stop a profiling session and save the captured profile. Returns a summary and a profile ID for querying.",
  inputSchema: z.object({
    id: z.string().describe("The profiling session ID returned by start_profiling"),
  }),
}, async (args) => toolResponse(await profilingTools.stopProfiling(args)));

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

// ---- Start Server

async function main() {
  await session.registerModule(consoleDomain);
  await session.registerModule(networkDomain);
  await session.registerModule(cpuDomain);
  await session.registerModule(memoryDomain);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
