import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { ConsoleDomain } from "../../src/domains/console.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("ConsoleDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let consoleDomain: ConsoleDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    session = new SessionManager();
    consoleDomain = new ConsoleDomain();
    await session.registerModule(consoleDomain);
  });

  afterEach(async () => {
    await session.close();
  });

  it("captures console.log messages", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    const entries = consoleDomain.getEntries();
    expect(entries.some((e) => e.text === "page loaded" && e.level === "log")).toBe(true);
  });

  it("captures console.warn messages", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    const entries = consoleDomain.getEntries();
    expect(entries.some((e) => e.text === "test warning" && e.level === "warn")).toBe(true);
  });

  it("filters by level", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    const warns = consoleDomain.getEntries("warn");
    expect(warns.every((e) => e.level === "warn")).toBe(true);
    expect(warns.length).toBeGreaterThan(0);
  });

  it("resets entries on reset()", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    expect(consoleDomain.getEntries().length).toBeGreaterThan(0);
    await consoleDomain.reset();
    expect(consoleDomain.getEntries().length).toBe(0);
  });

  it("includes timestamps", async () => {
    await session.navigate(server.url + "/basic.html");
    await new Promise((r) => setTimeout(r, 200));
    const entries = consoleDomain.getEntries();
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });
});
