import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { NetworkDomain } from "../../src/domains/network.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("NetworkDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let network: NetworkDomain;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    session = new SessionManager();
    network = new NetworkDomain();
    await session.registerModule(network);
  });

  afterEach(async () => {
    await session.close();
  });

  it("captures the document request", async () => {
    await session.navigate(server.url + "/basic.html");
    const requests = network.getRequests();
    expect(requests.some((r) => r.url.includes("/basic.html") && r.resourceType === "Document")).toBe(true);
  });

  it("records status codes", async () => {
    await session.navigate(server.url + "/basic.html");
    const doc = network.getRequests().find((r) => r.url.includes("/basic.html"));
    expect(doc?.status).toBe(200);
  });

  it("records timing data", async () => {
    await session.navigate(server.url + "/basic.html");
    const doc = network.getRequests().find((r) => r.url.includes("/basic.html"));
    expect(doc?.startTime).toBeGreaterThan(0);
  });

  it("filters by resource type", async () => {
    await session.navigate(server.url + "/basic.html");
    const docs = network.getRequests({ resourceType: "Document" });
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((r) => r.resourceType === "Document")).toBe(true);
  });

  it("resets requests on reset()", async () => {
    await session.navigate(server.url + "/basic.html");
    expect(network.getRequests().length).toBeGreaterThan(0);
    await network.reset();
    expect(network.getRequests().length).toBe(0);
  });

  it("captures 404 responses", async () => {
    await session.navigate(server.url + "/nonexistent.html");
    const requests = network.getRequests();
    expect(requests.some((r) => r.status === 404)).toBe(true);
  });
});
