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

  beforeAll(async () => { server = await startTestServer(); });
  afterAll(async () => { await server.close(); });
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    store = new DataStore(tempDir);
    session = new SessionManager();
    coverage = new CoverageDomain(store);
    await session.registerModule(coverage);
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
