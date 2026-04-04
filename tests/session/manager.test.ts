import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import type { DomainModule, BrowserConfig } from "../../src/types.js";
import type { CDPSession, Page } from "playwright";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("SessionManager", () => {
  let server: TestServer;
  let session: SessionManager;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    session = new SessionManager();
  });

  afterEach(async () => {
    await session.close();
  });

  it("is not active before navigation", () => {
    expect(session.isActive()).toBe(false);
  });

  it("launches browser and navigates on first navigate call", async () => {
    const result = await session.navigate(server.url + "/basic.html");
    expect(session.isActive()).toBe(true);
    expect(result.status).toBe(200);
    expect(result.url).toContain("/basic.html");
  });

  it("returns page load timing", async () => {
    const result = await session.navigate(server.url + "/basic.html");
    expect(result.loadTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("provides a CDP session for Chromium", async () => {
    await session.navigate(server.url + "/basic.html");
    const cdp = session.getCDPSession();
    expect(cdp).toBeDefined();
    const result = await cdp!.send("Runtime.evaluate", { expression: "1 + 1", returnByValue: true });
    expect(result.result.value).toBe(2);
  });

  it("provides a Playwright page", async () => {
    await session.navigate(server.url + "/basic.html");
    const page = session.getPage();
    expect(page).toBeDefined();
    const title = await page!.title();
    expect(title).toBe("Basic Test Page");
  });

  it("reloads the current page", async () => {
    await session.navigate(server.url + "/basic.html");
    const result = await session.reload();
    expect(result.status).toBe(200);
  });

  it("applies browser config before navigation", async () => {
    const config: BrowserConfig = { viewport: { width: 800, height: 600 } };
    session.configure(config);
    await session.navigate(server.url + "/basic.html");
    const page = session.getPage()!;
    const size = page.viewportSize();
    expect(size).toEqual({ width: 800, height: 600 });
  });

  it("attaches and notifies domain modules", async () => {
    const calls: string[] = [];
    const mockModule: DomainModule = {
      name: "test",
      cdpDomains: [],
      async attach() { calls.push("attach"); },
      async detach() { calls.push("detach"); },
      async reset() { calls.push("reset"); },
    };

    await session.registerModule(mockModule);
    await session.navigate(server.url + "/basic.html");
    expect(calls).toContain("attach");
  });

  it("resets modules on navigation", async () => {
    const calls: string[] = [];
    const mockModule: DomainModule = {
      name: "test",
      cdpDomains: [],
      async attach() { calls.push("attach"); },
      async detach() { calls.push("detach"); },
      async reset() { calls.push("reset"); },
    };

    await session.registerModule(mockModule);
    await session.navigate(server.url + "/basic.html");
    await session.navigate(server.url + "/slow-render.html");
    expect(calls.filter((c) => c === "reset")).toHaveLength(1);
  });

  it("closes cleanly", async () => {
    await session.navigate(server.url + "/basic.html");
    await session.close();
    expect(session.isActive()).toBe(false);
  });

  it("sets cookies via setAuth", async () => {
    await session.navigate(server.url + "/basic.html");
    await session.setAuth({
      cookies: [{ name: "session", value: "abc123", domain: "127.0.0.1", path: "/" }],
    });
    const page = session.getPage()!;
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "session")?.value).toBe("abc123");
  });
});
