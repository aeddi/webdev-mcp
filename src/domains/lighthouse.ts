import type { DataStore } from "../store/data-store.js";
import { randomUUID } from "node:crypto";

export interface LighthouseOptions {
  categories?: string[];
  formFactor?: "mobile" | "desktop";
}

export interface LighthouseResult {
  id: string;
  summary: {
    scores: Record<string, number>;
    opportunities: Array<{ title: string; description: string; savings?: number }>;
    diagnostics: Array<{ title: string; description: string; displayValue?: string }>;
  };
}

export class LighthouseDomain {
  constructor(private readonly store: DataStore) {}

  async run(url: string, options: LighthouseOptions): Promise<LighthouseResult> {
    const chromeLauncher = await import("chrome-launcher");
    const chrome = await chromeLauncher.launch({
      chromeFlags: ["--headless", "--disable-gpu", "--no-sandbox"],
    });

    try {
      // @ts-ignore — lighthouse types may not be available
      const lighthouse = (await import("lighthouse")).default;

      const lhOptions: Record<string, unknown> = {
        port: chrome.port,
        logLevel: "silent" as const,
        output: "json" as const,
        formFactor: options.formFactor ?? "desktop",
      };

      if (options.formFactor !== "mobile") {
        lhOptions.screenEmulation = { disabled: true };
        lhOptions.throttling = {
          rttMs: 0,
          throughputKbps: 0,
          cpuSlowdownMultiplier: 1,
        };
      }

      if (options.categories) {
        lhOptions.onlyCategories = options.categories;
      }

      const result = await lighthouse(url, lhOptions);
      if (!result?.lhr) throw new Error("Lighthouse returned no result");

      const { lhr } = result;
      const id = randomUUID();

      const reportJson = typeof result.report === "string" ? result.report : JSON.stringify(lhr);
      await this.store.saveArtifact(id, "lighthouse", "report", reportJson, ".json");

      const scores: Record<string, number> = {};
      for (const [catId, cat] of Object.entries(lhr.categories ?? {})) {
        scores[catId] = (cat as any).score ?? 0;
      }

      const opportunities = Object.values(lhr.audits ?? {})
        .filter((a: any) => a.details?.type === "opportunity" && a.score !== null && a.score < 1)
        .map((a: any) => ({
          title: a.title,
          description: a.description,
          savings: a.numericValue,
        }))
        .sort((a: any, b: any) => (b.savings ?? 0) - (a.savings ?? 0))
        .slice(0, 10);

      const diagnostics = Object.values(lhr.audits ?? {})
        .filter(
          (a: any) =>
            a.details?.type === "diagnostic" ||
            (a.details?.type === "table" && a.score !== null && a.score < 1),
        )
        .map((a: any) => ({
          title: a.title,
          description: a.description,
          displayValue: a.displayValue,
        }))
        .slice(0, 10);

      const summary = { scores, opportunities, diagnostics };
      this.store.updateSummary(id, summary as unknown as Record<string, unknown>);

      return { id, summary };
    } finally {
      await chrome.kill();
    }
  }
}
