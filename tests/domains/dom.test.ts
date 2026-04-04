import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { DomDomain } from "../../src/domains/dom.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("DomDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let dom: DomDomain;

  beforeAll(async () => { server = await startTestServer(); });
  afterAll(async () => { await server.close(); });
  beforeEach(async () => {
    session = new SessionManager();
    dom = new DomDomain();
    await session.registerModule(dom);
  });
  afterEach(async () => { await session.close(); });

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
