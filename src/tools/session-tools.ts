import type { SessionManager } from "../session/manager.js";
import type { DataStore } from "../store/data-store.js";
import type { BrowserConfig, ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";
import type { AuthConfig } from "../session/manager.js";

export function createSessionTools(session: SessionManager, store: DataStore) {
  return {
    async configureBrowser(args: BrowserConfig): Promise<ToolResult> {
      try {
        session.configure(args);
        return toolSuccess({ configured: args });
      } catch (err) {
        return toolError("session", "Failed to configure browser", String(err));
      }
    },

    async navigate(args: { url: string }): Promise<ToolResult> {
      try {
        const result = await session.navigate(args.url);
        return toolSuccess({
          url: result.url,
          status: result.status,
          loadTimeMs: result.loadTimeMs,
        });
      } catch (err) {
        return toolError("navigation", `Failed to navigate to ${args.url}`, String(err));
      }
    },

    async reload(): Promise<ToolResult> {
      try {
        const result = await session.reload();
        return toolSuccess({
          url: result.url,
          status: result.status,
          loadTimeMs: result.loadTimeMs,
        });
      } catch (err) {
        return toolError("session", "Failed to reload page", String(err));
      }
    },

    async setAuth(args: AuthConfig): Promise<ToolResult> {
      try {
        await session.setAuth(args);
        return toolSuccess({ applied: true });
      } catch (err) {
        return toolError("session", "Failed to set auth", String(err));
      }
    },

    async closeSession(): Promise<ToolResult> {
      try {
        await store.flushManifest();
        await session.close();
        return toolSuccess({ closed: true });
      } catch (err) {
        return toolError("session", "Failed to close session", String(err));
      }
    },
  };
}
