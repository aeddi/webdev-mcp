import type { CDPSession, Page } from "playwright";
import type { DomainModule, MemoryQueryFilter } from "../types.js";
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
