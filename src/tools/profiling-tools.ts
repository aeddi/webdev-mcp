import type { CpuDomain } from "../domains/cpu.js";
import type { MemoryDomain } from "../domains/memory.js";
import type { DataStore } from "../store/data-store.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";
import { randomUUID } from "node:crypto";

export function createProfilingTools(
  cpuDomain: CpuDomain,
  memoryDomain: MemoryDomain,
  store: DataStore,
) {
  const activeSessions = new Map<string, { domain: string; sessionId: string }>();

  return {
    async startProfiling(args: { domain: string }): Promise<ToolResult> {
      try {
        let sessionId: string;
        switch (args.domain) {
          case "cpu":
            sessionId = await cpuDomain.startProfiling();
            break;
          default:
            return toolError(
              "profiling",
              `Unknown profiling domain: ${args.domain}. Valid domains: cpu, memory_allocation, rendering`,
            );
        }

        const id = randomUUID();
        activeSessions.set(id, { domain: args.domain, sessionId });
        return toolSuccess({ id, domain: args.domain, started: true });
      } catch (err) {
        return toolError("profiling", `Failed to start ${args.domain} profiling`, String(err));
      }
    },

    async stopProfiling(args: { id: string }): Promise<ToolResult> {
      const session = activeSessions.get(args.id);
      if (!session) {
        return toolError("profiling", `No active profiling session with ID: ${args.id}`);
      }

      try {
        let summary: Record<string, unknown> = {};
        const profileId = args.id;

        switch (session.domain) {
          case "cpu": {
            const result = await cpuDomain.stopProfiling(session.sessionId);
            await store.saveArtifact(
              profileId, "cpu", "profile",
              JSON.stringify(result.profile), ".cpuprofile",
            );
            store.updateSummary(profileId, result.summary);
            summary = result.summary;
            break;
          }
          default:
            return toolError("profiling", `Unknown domain: ${session.domain}`);
        }

        activeSessions.delete(args.id);
        return toolSuccess({ profileId, domain: session.domain, summary });
      } catch (err) {
        return toolError("profiling", `Failed to stop profiling`, String(err));
      }
    },

    async takeHeapSnapshot(): Promise<ToolResult> {
      try {
        const result = await memoryDomain.takeHeapSnapshot();
        return toolSuccess({
          snapshotId: result.id,
          summary: result.summary,
        });
      } catch (err) {
        return toolError("profiling", "Failed to take heap snapshot", String(err));
      }
    },

    async compareSnapshots(args: { snapshotA: string; snapshotB: string }): Promise<ToolResult> {
      try {
        const diff = await memoryDomain.compareSnapshots(args.snapshotA, args.snapshotB);
        return toolSuccess({
          sizeDelta: diff.sizeDelta,
          added: diff.added.slice(0, 20),
          removed: diff.removed.slice(0, 20),
          grown: diff.grown.slice(0, 20),
        });
      } catch (err) {
        return toolError("profiling", "Failed to compare snapshots", String(err));
      }
    },
  };
}
