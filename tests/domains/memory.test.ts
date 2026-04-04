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
    await session.registerModule(memory);
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
