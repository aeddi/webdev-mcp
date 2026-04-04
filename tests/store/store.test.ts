import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../../src/store/data-store.js";
import { QueryEngine } from "../../src/store/query-engine.js";
import type { ProfileRecord, QueryFilter } from "../../src/types.js";

describe("DataStore", () => {
  let store: DataStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wpo-test-"));
    store = new DataStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves and retrieves a profile record", () => {
    const record: ProfileRecord = {
      id: "test-1",
      domain: "cpu",
      type: "profile",
      timestamp: Date.now(),
      summary: { topFunction: "main", selfTime: 120 },
    };
    store.save(record);
    expect(store.get("test-1")).toEqual(record);
  });

  it("returns undefined for missing record", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("lists records filtered by domain", () => {
    store.save({ id: "a", domain: "cpu", type: "profile", timestamp: 1, summary: {} });
    store.save({ id: "b", domain: "memory", type: "snapshot", timestamp: 2, summary: {} });
    store.save({ id: "c", domain: "cpu", type: "profile", timestamp: 3, summary: {} });
    expect(store.listByDomain("cpu").map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("writes artifact to disk and stores path", async () => {
    const data = JSON.stringify({ nodes: [1, 2, 3] });
    const record = await store.saveArtifact("snap-1", "memory", "snapshot", data, ".heapsnapshot");
    expect(record.artifactPath).toBeDefined();
    const content = await readFile(record.artifactPath!, "utf-8");
    expect(content).toBe(data);
  });

  it("writes binary artifact to disk", async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const record = await store.saveArtifact("img-1", "screenshot", "image", pngData, ".png");
    const content = await readFile(record.artifactPath!);
    expect(Buffer.compare(content, pngData)).toBe(0);
  });

  it("updateSummary updates the summary on an existing record", () => {
    store.save({ id: "s1", domain: "cpu", type: "profile", timestamp: 1, summary: {} });
    store.updateSummary("s1", { topFunction: "render", selfTime: 42 });
    expect(store.get("s1")?.summary).toEqual({ topFunction: "render", selfTime: 42 });
  });

  it("updateSummary throws for a missing id", () => {
    expect(() => store.updateSummary("nonexistent", { a: 1 })).toThrow("No record found for id: nonexistent");
  });

  it("flushes manifest to disk", async () => {
    store.save({ id: "x", domain: "cpu", type: "profile", timestamp: 1, summary: { a: 1 } });
    await store.flushManifest();
    const manifest = JSON.parse(await readFile(join(tempDir, "manifest.json"), "utf-8"));
    expect(manifest).toHaveLength(1);
    expect(manifest[0].id).toBe("x");
  });
});

describe("QueryEngine", () => {
  let engine: QueryEngine;

  beforeEach(() => {
    engine = new QueryEngine();
  });

  it("registers and dispatches a query handler", async () => {
    engine.register("cpu", async (_path: string, filter: QueryFilter) => {
      return { filtered: true, filter };
    });
    const result = await engine.query("cpu", "/fake/path", { minSelfTime: 50 });
    expect(result).toEqual({ filtered: true, filter: { minSelfTime: 50 } });
  });

  it("throws for unregistered domain", async () => {
    await expect(engine.query("unknown", "/fake", {})).rejects.toThrow("No query handler registered for domain: unknown");
  });

  it("lists registered domains", () => {
    engine.register("cpu", async () => ({}));
    engine.register("memory", async () => ({}));
    expect(engine.registeredDomains()).toEqual(["cpu", "memory"]);
  });
});
