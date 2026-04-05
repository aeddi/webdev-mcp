import type { CDPSession, Page } from "playwright";
import type { DomainModule, MemoryQueryFilter, AllocationQueryFilter } from "../types.js";
import type { DataStore } from "../store/data-store.js";
import { randomUUID } from "node:crypto";

interface HeapSnapshotSummary {
  totalSize: number;
  nodeCount: number;
  topTypes: Array<{ type: string; count: number; size: number }>;
}

export interface SnapshotTypeBucket {
  type: string;
  count: number;
  size: number;
}

export interface HeapSnapshotResult {
  id: string;
  summary: HeapSnapshotSummary;
}

export interface SnapshotComparison {
  sizeDelta: number;
  added: SnapshotTypeBucket[];
  removed: SnapshotTypeBucket[];
  grown: Array<{ type: string; countDelta: number; sizeDelta: number }>;
}

export class MemoryDomain implements DomainModule {
  readonly name = "memory";
  readonly cdpDomains = ["HeapProfiler", "Runtime"];

  private cdp: CDPSession | null = null;
  private snapshots = new Map<string, Map<string, SnapshotTypeBucket>>();
  private activeSamplingSessions = new Set<string>();

  constructor(private readonly store: DataStore) {}

  async attach(cdp: CDPSession, _page: Page): Promise<void> {
    this.cdp = cdp;
    await cdp.send("HeapProfiler.enable");
  }

  async detach(): Promise<void> {
    try {
      await this.cdp?.send("HeapProfiler.disable");
    } catch {
      // Session may be closed
    }
    this.cdp = null;
  }

  async reset(): Promise<void> {
    this.snapshots.clear();
    this.activeSamplingSessions.clear();
  }

  async takeHeapSnapshot(): Promise<HeapSnapshotResult> {
    if (!this.cdp) throw new Error("Memory domain not attached");

    const id = randomUUID();
    const chunks: string[] = [];

    const onChunk = (params: { chunk: string }) => {
      chunks.push(params.chunk);
    };

    (this.cdp as any).on("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await this.cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false } as any);
    (this.cdp as any).off("HeapProfiler.addHeapSnapshotChunk", onChunk);

    const snapshotData = chunks.join("");
    await this.store.saveArtifact(id, "memory", "snapshot", snapshotData, ".heapsnapshot");

    const parsed = JSON.parse(snapshotData);
    const typeBuckets = this.parseSnapshotTypes(parsed);
    this.snapshots.set(id, typeBuckets);

    const totalSize = [...typeBuckets.values()].reduce((sum, b) => sum + b.size, 0);
    const nodeCount = [...typeBuckets.values()].reduce((sum, b) => sum + b.count, 0);
    const topTypes = [...typeBuckets.values()]
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);

    const summary: HeapSnapshotSummary = { totalSize, nodeCount, topTypes };
    this.store.updateSummary(id, summary as unknown as Record<string, unknown>);

    return { id, summary };
  }

  async compareSnapshots(idA: string, idB: string): Promise<SnapshotComparison> {
    const bucketsA = this.snapshots.get(idA);
    const bucketsB = this.snapshots.get(idB);

    if (!bucketsA) throw new Error(`Snapshot not found: ${idA}`);
    if (!bucketsB) throw new Error(`Snapshot not found: ${idB}`);

    const totalA = [...bucketsA.values()].reduce((s, b) => s + b.size, 0);
    const totalB = [...bucketsB.values()].reduce((s, b) => s + b.size, 0);

    const added: SnapshotTypeBucket[] = [];
    const removed: SnapshotTypeBucket[] = [];
    const grown: SnapshotComparison["grown"] = [];

    const allTypes = new Set([...bucketsA.keys(), ...bucketsB.keys()]);
    for (const type of allTypes) {
      const a = bucketsA.get(type);
      const b = bucketsB.get(type);

      if (!a && b) {
        added.push(b);
      } else if (a && !b) {
        removed.push(a);
      } else if (a && b) {
        const countDelta = b.count - a.count;
        const sizeDelta = b.size - a.size;
        if (sizeDelta > 0) {
          grown.push({ type, countDelta, sizeDelta });
        }
      }
    }

    added.sort((a, b) => b.size - a.size);
    grown.sort((a, b) => b.sizeDelta - a.sizeDelta);

    return { sizeDelta: totalB - totalA, added, removed, grown };
  }

  async startAllocationSampling(): Promise<string> {
    if (!this.cdp) throw new Error("Memory domain not attached");
    const id = randomUUID();
    await this.cdp.send("HeapProfiler.startSampling" as any);
    this.activeSamplingSessions.add(id);
    return id;
  }

  async stopAllocationSampling(id: string): Promise<{ profile: any; summary: { totalSize: number; sampleCount: number } }> {
    if (!this.cdp) throw new Error("Memory domain not attached");
    if (!this.activeSamplingSessions.has(id)) throw new Error(`No active sampling session: ${id}`);

    const result = await this.cdp.send("HeapProfiler.stopSampling" as any) as any;
    this.activeSamplingSessions.delete(id);

    const profile = result.profile;
    const samples = this.flattenSamples(profile.head);
    const totalSize = samples.reduce((sum: number, s: any) => sum + s.selfSize, 0);

    return {
      profile,
      summary: { totalSize, sampleCount: samples.length },
    };
  }

  private flattenSamples(node: any): any[] {
    const results: any[] = [];
    if (node.selfSize > 0) results.push(node);
    for (const child of node.children ?? []) {
      results.push(...this.flattenSamples(child));
    }
    return results;
  }

  filterAllocationProfile(
    profile: any,
    filter: AllocationQueryFilter,
  ): Array<{ functionName: string; url: string; lineNumber: number; selfSize: number }> {
    const samples = this.flattenSamples(profile.head);
    let results = samples.map((s: any) => ({
      functionName: s.callFrame?.functionName || "(anonymous)",
      url: s.callFrame?.url || "",
      lineNumber: s.callFrame?.lineNumber ?? -1,
      selfSize: s.selfSize,
    }));

    if (filter.functionName) {
      const pattern = filter.functionName.toLowerCase();
      results = results.filter((r) => r.functionName.toLowerCase().includes(pattern));
    }
    if (filter.url) {
      const pattern = filter.url.toLowerCase();
      results = results.filter((r) => r.url.toLowerCase().includes(pattern));
    }
    if (filter.minSelfSize !== undefined) {
      results = results.filter((r) => r.selfSize >= filter.minSelfSize!);
    }

    return results.sort((a, b) => b.selfSize - a.selfSize);
  }

  filterSnapshot(buckets: Map<string, SnapshotTypeBucket>, filter: MemoryQueryFilter): SnapshotTypeBucket[] {
    let results = [...buckets.values()];
    if (filter.objectType) {
      const pattern = filter.objectType.toLowerCase();
      results = results.filter((b) => b.type.toLowerCase().includes(pattern));
    }
    if (filter.minRetainedSize !== undefined) {
      results = results.filter((b) => b.size >= filter.minRetainedSize!);
    }
    return results.sort((a, b) => b.size - a.size);
  }

  getSnapshotBuckets(id: string): Map<string, SnapshotTypeBucket> | undefined {
    return this.snapshots.get(id);
  }

  private parseSnapshotTypes(snapshot: any): Map<string, SnapshotTypeBucket> {
    const buckets = new Map<string, SnapshotTypeBucket>();
    const nodes = snapshot.nodes;
    const strings = snapshot.strings;

    if (!nodes || !strings) return buckets;

    const nodeFieldCount = snapshot.snapshot?.meta?.node_fields?.length ?? 7;
    const nameOffset = 1;
    const selfSizeOffset = 3;

    for (let i = 0; i < nodes.length; i += nodeFieldCount) {
      const nameIdx = nodes[i + nameOffset];
      const selfSize = nodes[i + selfSizeOffset];
      const name = strings[nameIdx] || "(anonymous)";

      const existing = buckets.get(name);
      if (existing) {
        existing.count++;
        existing.size += selfSize;
      } else {
        buckets.set(name, { type: name, count: 1, size: selfSize });
      }
    }

    return buckets;
  }
}
