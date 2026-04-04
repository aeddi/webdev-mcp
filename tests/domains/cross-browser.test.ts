import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { CrossBrowserDomain } from "../../src/domains/cross-browser.js";
import { SessionManager } from "../../src/session/manager.js";
import { DataStore } from "../../src/store/data-store.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CrossBrowserDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let crossBrowser: CrossBrowserDomain;
  let store: DataStore;
  let tempDir: string;

  beforeAll(async () => { server = await startTestServer(); });
  afterAll(async () => { await server.close(); });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    store = new DataStore(tempDir);
    session = new SessionManager();
    crossBrowser = new CrossBrowserDomain(store);
  });

  afterEach(async () => {
    await session.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("captures Firefox screenshot", async () => {
    await session.navigate(server.url + "/basic.html");
    const results = await crossBrowser.capture(server.url + "/basic.html", {
      browsers: ["firefox"],
      viewport: { width: 1280, height: 720 },
    });
    expect(results.screenshots.firefox).toBeDefined();
    expect(results.screenshots.firefox!.length).toBeGreaterThan(0);
  }, 30_000);

  it("captures WebKit screenshot", async () => {
    await session.navigate(server.url + "/basic.html");
    const results = await crossBrowser.capture(server.url + "/basic.html", {
      browsers: ["webkit"],
      viewport: { width: 1280, height: 720 },
    });
    expect(results.screenshots.webkit).toBeDefined();
    expect(results.screenshots.webkit!.length).toBeGreaterThan(0);
  }, 30_000);

  it("captures multiple browsers", async () => {
    await session.navigate(server.url + "/basic.html");
    const results = await crossBrowser.capture(server.url + "/basic.html", {
      browsers: ["firefox", "webkit"],
      viewport: { width: 1280, height: 720 },
    });
    expect(results.screenshots.firefox).toBeDefined();
    expect(results.screenshots.webkit).toBeDefined();
  }, 30_000);

  it("computes visual diff against reference", async () => {
    await session.navigate(server.url + "/basic.html");
    const page = session.getPage()!;
    const chromiumScreenshot = Buffer.from(await page.screenshot({ type: "png" }));

    const results = await crossBrowser.capture(server.url + "/basic.html", {
      browsers: ["firefox"],
      viewport: { width: 1280, height: 720 },
      referenceScreenshot: chromiumScreenshot,
    });
    expect(results.diffs?.firefox).toBeDefined();
    expect(typeof results.diffs!.firefox!.mismatchPercent).toBe("number");
  }, 30_000);
});
