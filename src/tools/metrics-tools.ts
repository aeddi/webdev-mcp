import type { ConsoleDomain } from "../domains/console.js";
import type { NetworkDomain } from "../domains/network.js";
import type { ToolResult, ConsoleEntry } from "../types.js";
import { toolSuccess, toolError } from "../types.js";

export function createMetricsTools(
  consoleDomain: ConsoleDomain,
  networkDomain: NetworkDomain,
) {
  return {
    async getConsoleLog(args: { level?: ConsoleEntry["level"] }): Promise<ToolResult> {
      try {
        const entries = consoleDomain.getEntries(args.level);
        return toolSuccess({
          entries,
          count: entries.length,
        });
      } catch (err) {
        return toolError("internal", "Failed to get console log", String(err));
      }
    },

    async getNetworkLog(args: { resourceType?: string; minSize?: number; blocking?: boolean; domain?: string }): Promise<ToolResult> {
      try {
        const requests = networkDomain.getRequests(args);
        const summary = networkDomain.getSummary();
        return toolSuccess({
          requests,
          summary,
        });
      } catch (err) {
        return toolError("internal", "Failed to get network log", String(err));
      }
    },
  };
}
