import type { CpuDomain } from "../domains/cpu.js";
import type { DataStore } from "../store/data-store.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";
import { randomUUID } from "node:crypto";

export function createProfilingTools(
  cpuDomain: CpuDomain,
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
  };
}
