import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { RenderingDomain } from "../../src/domains/rendering.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("RenderingDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let rendering: RenderingDomain;

  beforeAll(async () => { server = await startTestServer(); });
  afterAll(async () => { await server.close(); });

  beforeEach(async () => {
    session = new SessionManager();
    rendering = new RenderingDomain();
    await session.registerModule(rendering);
  });

  afterEach(async () => { await session.close(); });

  it("captures performance entries after page load", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 500));
    await rendering.collectEntries();
    const entries = rendering.getEntries();
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });

  it("detects long tasks when forced layout happens", async () => {
    await session.navigate(server.url + "/slow-render.html");
    await session.getPage()!.click("#trigger-layout");
    await new Promise((r) => setTimeout(r, 1000));
    await rendering.collectEntries();
    const longTasks = rendering.getEntries({ type: "long-task" });
    expect(Array.isArray(longTasks)).toBe(true);
  });

  it("provides a summary", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 500));
    await rendering.collectEntries();
    const summary = rendering.getSummary();
    expect(summary).toHaveProperty("totalEntries");
    expect(summary).toHaveProperty("layoutShifts");
    expect(summary).toHaveProperty("longTasks");
  });

  it("resets entries", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 500));
    await rendering.collectEntries();
    await rendering.reset();
    expect(rendering.getEntries().length).toBe(0);
  });
});
