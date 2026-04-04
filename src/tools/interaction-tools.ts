import type { InteractionDomain } from "../domains/interaction.js";
import type { DataStore } from "../store/data-store.js";
import type { ToolResult } from "../types.js";
import { toolSuccess, toolError } from "../types.js";
import { randomUUID } from "node:crypto";

export function createInteractionTools(interaction: InteractionDomain, store: DataStore) {
  return {
    async simulateInteraction(args: {
      action: "click" | "type" | "scroll" | "hover";
      selector?: string;
      text?: string;
      x?: number;
      y?: number;
    }): Promise<ToolResult> {
      try {
        const result = await interaction.perform(args);
        return toolSuccess(result as unknown as Record<string, unknown>);
      } catch (err) {
        return toolError("internal", `Failed to simulate ${args.action}`, String(err));
      }
    },

    async screenshot(args: {
      selector?: string;
      fullPage?: boolean;
      label?: string;
    }): Promise<{ content: Array<{ type: "image"; data: string; mimeType: string } | { type: "text"; text: string }>; isError?: boolean }> {
      try {
        const buffer = await interaction.screenshot(args);
        const id = randomUUID();
        await store.saveArtifact(id, "screenshot", "image", buffer, ".png");
        return {
          content: [{
            type: "image",
            data: buffer.toString("base64"),
            mimeType: "image/png",
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify(toolError("internal", "Screenshot failed", String(err))) }],
          isError: true,
        };
      }
    },
  };
}
