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
    await session.registerModule(consoleDomain);
    await session.registerModule(networkDomain);
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
    expect((result as any).status).toBe(200);
    expect((result as any).loadTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("reload works after navigation", async () => {
    await sessionTools.navigate({ url: server.url + "/basic.html" });
    const result = await sessionTools.reload();
    expect(result.success).toBe(true);
    expect((result as any).status).toBe(200);
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
