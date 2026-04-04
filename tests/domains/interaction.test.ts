import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import { InteractionDomain } from "../../src/domains/interaction.js";
import { RenderingDomain } from "../../src/domains/rendering.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("InteractionDomain", () => {
  let server: TestServer;
  let session: SessionManager;
  let interaction: InteractionDomain;
  let rendering: RenderingDomain;

  beforeAll(async () => { server = await startTestServer(); });
  afterAll(async () => { await server.close(); });

  beforeEach(async () => {
    session = new SessionManager();
    rendering = new RenderingDomain();
    interaction = new InteractionDomain(rendering);
    await session.registerModule(rendering);
    await session.registerModule(interaction);
  });

  afterEach(async () => { await session.close(); });

  it("clicks an element and returns timing", async () => {
    await session.navigate(server.url + "/basic.html");
    const result = await interaction.perform({ action: "click", selector: "#btn" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.action).toBe("click");
  });

  it("scrolls the page", async () => {
    await session.navigate(server.url + "/heavy-dom.html");
    const result = await interaction.perform({ action: "scroll", y: 500 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.action).toBe("scroll");
  });

  it("takes a screenshot", async () => {
    await session.navigate(server.url + "/basic.html");
    const buffer = await interaction.screenshot({});
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("takes an element screenshot", async () => {
    await session.navigate(server.url + "/basic.html");
    const buffer = await interaction.screenshot({ selector: "#box" });
    expect(buffer.length).toBeGreaterThan(0);
  });
});
