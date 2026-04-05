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

  let consoleDomain: ConsoleDomain;
  let networkDomain: NetworkDomain;
  let cpuDomain: CpuDomain;
  let memoryDomain: MemoryDomain;
  let renderingDomain: RenderingDomain;
  let webVitalsDomain: WebVitalsDomain;
  let domDomain: DomDomain;
  let coverageDomain: CoverageDomain;
  let interactionDomain: InteractionDomain;

  let sessionTools: ReturnType<typeof createSessionTools>;
  let metricsTools: ReturnType<typeof createMetricsTools>;
  let profilingTools: ReturnType<typeof createProfilingTools>;
  let interactionTools: ReturnType<typeof createInteractionTools>;
  let analysisTools: ReturnType<typeof createAnalysisTools>;

  beforeAll(async () => { testServer = await startTestServer(); });
  afterAll(async () => { await testServer.close(); });

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

    await session.registerModule(consoleDomain);
    await session.registerModule(networkDomain);
    await session.registerModule(cpuDomain);
    await session.registerModule(memoryDomain);
    await session.registerModule(renderingDomain);
    await session.registerModule(webVitalsDomain);
    await session.registerModule(domDomain);
    await session.registerModule(interactionDomain);
    await session.registerModule(coverageDomain);

    // Register query handlers (same as server.ts)
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

    queryEngine.register("memory_allocation", async (artifactPath, filter) => {
      const data = JSON.parse(await readFile(artifactPath, "utf-8"));
      const allocations = memoryDomain.filterAllocationProfile(data, filter as any);
      return { allocations };
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
    const consoleResult = await metricsTools.getConsoleLog({});
    expect(consoleResult.success).toBe(true);

    const networkResult = await metricsTools.getNetworkLog({});
    expect(networkResult.success).toBe(true);
    expect((networkResult as any).summary.totalRequests).toBeGreaterThan(0);
  });

  it("allocation profiling workflow: start → allocate → stop → query", async () => {
    await sessionTools.navigate({ url: testServer.url + "/memory-leak.html" });

    const start = await profilingTools.startProfiling({ domain: "memory_allocation" });
    expect(start.success).toBe(true);

    await session.getPage()!.click("#leak");
    await new Promise((r) => setTimeout(r, 500));

    const stop = await profilingTools.stopProfiling({ id: (start as any).id });
    expect(stop.success).toBe(true);
    expect((stop as any).summary.totalSize).toBeGreaterThan(0);
    expect((stop as any).summary.sampleCount).toBeGreaterThan(0);

    const query = await analysisTools.queryProfile({
      id: (stop as any).profileId,
      filter: {},
    });
    expect(query.success).toBe(true);
    expect((query as any).result.allocations).toBeDefined();
    expect((query as any).result.allocations.length).toBeGreaterThan(0);
  });

  it("close session flushes manifest", async () => {
    await sessionTools.navigate({ url: testServer.url + "/basic.html" });
    await profilingTools.takeHeapSnapshot();

    await sessionTools.closeSession();

    const manifest = JSON.parse(await readFile(join(tempDir, "manifest.json"), "utf-8"));
    expect(manifest.length).toBeGreaterThan(0);
  });
});
