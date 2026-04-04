import type { DataStore } from "../store/data-store.js";
import type { QueryEngine } from "../store/query-engine.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";

export function createAnalysisTools(store: DataStore, queryEngine: QueryEngine) {
  return {
    async queryProfile(args: { id: string; filter?: Record<string, unknown> }): Promise<ToolResult> {
      const record = store.get(args.id);
      if (!record) {
        return toolError("query", `No profile found with ID: ${args.id}`);
      }
      if (!record.artifactPath) {
        return toolError("query", `Profile ${args.id} has no artifact data`);
      }

      try {
        const result = await queryEngine.query(record.domain, record.artifactPath, args.filter ?? {});
        return toolSuccess({ domain: record.domain, type: record.type, result });
      } catch (err) {
        const registered = queryEngine.registeredDomains();
        if (!registered.includes(record.domain)) {
          return toolError("query", `No query handler for domain: ${record.domain}. Registered: ${registered.join(", ")}`);
        }
        return toolError("query", `Query failed for ${record.domain} profile`, String(err));
      }
    },
  };
}
