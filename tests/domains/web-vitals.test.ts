import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { WebVitalsDomain } from "../../src/domains/web-vitals.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("WebVitalsDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let vitals: WebVitalsDomain;

  beforeAll(async () => { server = await startTestServer(); });
  afterAll(async () => { await server.close(); });

  beforeEach(async () => {
    session = new SessionManager();
    vitals = new WebVitalsDomain();
    await session.registerModule(vitals);
  });

  afterEach(async () => { await session.close(); });

  it("collects LCP after page load", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 1000));
    const metrics = await vitals.getMetrics();
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
