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
import { RenderingDomain } from "./domains/rendering.js";
import { WebVitalsDomain } from "./domains/web-vitals.js";
import { DomDomain } from "./domains/dom.js";
import { CoverageDomain } from "./domains/coverage.js";
import { InteractionDomain } from "./domains/interaction.js";
import { createSessionTools } from "./tools/session-tools.js";
import { createMetricsTools } from "./tools/metrics-tools.js";
import { createProfilingTools } from "./tools/profiling-tools.js";
import { createInteractionTools } from "./tools/interaction-tools.js";
import { toolSuccess, toolError, type ToolResult } from "./types.js";

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
const renderingDomain = new RenderingDomain();
const webVitalsDomain = new WebVitalsDomain();
const domDomain = new DomDomain();
const coverageDomain = new CoverageDomain(store);
const interactionDomain = new InteractionDomain(renderingDomain);

// ---- Tool Handlers

const sessionTools = createSessionTools(session, store);
const metricsTools = createMetricsTools(consoleDomain, networkDomain);
const profilingTools = createProfilingTools(cpuDomain, memoryDomain, store);
const interactionTools = createInteractionTools(interactionDomain, store);

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

// ---- Web Vitals Tool

mcp.registerTool("get_web_vitals", {
  title: "Get Web Vitals",
  description:
    "Read current Core Web Vitals: LCP (Largest Contentful Paint, ms), CLS (Cumulative Layout Shift, unitless), INP (Interaction to Next Paint, ms). Also returns rendering summary (layout shifts, long tasks, paint events).",
  inputSchema: z.object({}),
}, async () => {
  try {
    await renderingDomain.collectEntries();
    const metrics = await webVitalsDomain.getMetrics();
    const rendering = renderingDomain.getSummary();
    return toolResponse(toolSuccess({ metrics, rendering }));
  } catch (err) {
    return toolResponse(toolError("internal", "Failed to get web vitals", String(err)));
  }
});

// ---- DOM + Coverage Tools

mcp.registerTool("get_dom_stats", {
  title: "Get DOM Stats",
  description: "Get DOM statistics: total node count, max tree depth, detached node count, element distribution by tag.",
  inputSchema: z.object({}),
}, async () => {
  try {
    const stats = await domDomain.getStats();
    return toolResponse(toolSuccess(stats as unknown as Record<string, unknown>));
  } catch (err) {
    return toolResponse(toolError("internal", "Failed to get DOM stats", String(err)));
  }
});

mcp.registerTool("get_coverage", {
  title: "Get Coverage",
  description: "Collect JS and/or CSS code coverage. Returns per-file used/unused percentages.",
  inputSchema: z.object({
    type: z.enum(["js", "css", "both"]).describe("Coverage type to collect"),
  }),
}, async (args) => {
  try {
    const results: Record<string, unknown> = {};
    if (args.type === "js" || args.type === "both") {
      await coverageDomain.startJsCoverage();
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
    return toolResponse(toolSuccess(results));
  } catch (err) {
    return toolResponse(toolError("internal", "Failed to get coverage", String(err)));
  }
});

// ---- Interaction Tools

mcp.registerTool("simulate_interaction", {
  title: "Simulate Interaction",
  description: "Simulate a user interaction: click, type, scroll, or hover. Returns timing and layout impact.",
  inputSchema: z.object({
    action: z.enum(["click", "type", "scroll", "hover"]).describe("Type of interaction"),
    selector: z.string().optional().describe("CSS selector of target element"),
    text: z.string().optional().describe("Text to type (for 'type' action)"),
    x: z.number().optional().describe("X coordinate"),
    y: z.number().optional().describe("Y coordinate"),
  }),
}, async (args) => toolResponse(await interactionTools.simulateInteraction(args)));

mcp.registerTool("screenshot", {
  title: "Screenshot",
  description: "Capture a screenshot of the current page or a specific element. Returns the image.",
  inputSchema: z.object({
    selector: z.string().optional().describe("CSS selector for element screenshot"),
    fullPage: z.boolean().optional().describe("Capture full scrollable page"),
    label: z.string().optional().describe("Label for comparison"),
  }),
}, async (args) => interactionTools.screenshot(args));

// ---- Start Server

async function main() {
  await session.registerModule(consoleDomain);
  await session.registerModule(networkDomain);
  await session.registerModule(cpuDomain);
  await session.registerModule(memoryDomain);
  await session.registerModule(renderingDomain);
  await session.registerModule(interactionDomain);
  await session.registerModule(webVitalsDomain);
  await session.registerModule(domDomain);
  await session.registerModule(coverageDomain);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
