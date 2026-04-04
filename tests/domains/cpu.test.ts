import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { CpuDomain } from "../../src/domains/cpu.js";
import { DataStore } from "../../src/store/data-store.js";
import { createProfilingTools } from "../../src/tools/profiling-tools.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  beforeEach(async () => {
    session = new SessionManager();
    cpu = new CpuDomain();
    await session.registerModule(cpu);
  });

  afterEach(async () => {
    await session.close();
  });

  it("starts and stops profiling, returning a profile", async () => {
    await session.navigate(server.url + "/basic.html");
    const sessionId = await cpu.startProfiling();
    expect(sessionId).toBeTruthy();

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
    await cpu.startProfiling();
    await cpu.reset();
    expect(cpu.isActive()).toBe(false);
  });
});

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
    await session.registerModule(cpu);
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
