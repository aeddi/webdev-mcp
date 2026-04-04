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

  beforeAll(async () => { server = await startTestServer(); });
  afterAll(async () => { await server.close(); });

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
    const result = await lighthouse.run(server.url + "/basic.html", { categories: ["performance"] });
    expect(result.summary.scores.performance).toBeDefined();
  }, 60_000);
});
