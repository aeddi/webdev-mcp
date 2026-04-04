import type { CDPSession, Page } from "playwright";
import type { DomainModule, CoverageQueryFilter } from "../types.js";
import type { DataStore } from "../store/data-store.js";
import { randomUUID } from "node:crypto";

export interface CoverageEntry {
  url: string;
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
  unusedPercent: number;
}

export interface CoverageResult {
  id: string;
  type: "js" | "css";
  entries: CoverageEntry[];
  summary: { totalBytes: number; usedBytes: number; overallUsedPercent: number };
}

export class CoverageDomain implements DomainModule {
  readonly name = "coverage";
  readonly cdpDomains = ["Profiler", "CSS"];
  private cdp: CDPSession | null = null;
  private page: Page | null = null;
  private jsActive = false;
  private cssActive = false;

  constructor(private readonly store: DataStore) {}

  async attach(cdp: CDPSession, page: Page): Promise<void> {
    this.cdp = cdp;
    this.page = page;
  }

  async detach(): Promise<void> {
    if (this.jsActive) {
      try { await this.cdp?.send("Profiler.stopPreciseCoverage"); } catch {}
      try { await this.cdp?.send("Profiler.disable"); } catch {}
    }
    if (this.cssActive) {
      try { await (this.cdp as any)?.send("CSS.stopRuleUsageTracking"); } catch {}
    }
    this.jsActive = false;
    this.cssActive = false;
    this.cdp = null;
    this.page = null;
  }

  async reset(): Promise<void> {
    if (this.jsActive) {
      try { await this.cdp?.send("Profiler.stopPreciseCoverage"); } catch {}
      try { await this.cdp?.send("Profiler.disable"); } catch {}
      this.jsActive = false;
    }
    if (this.cssActive) {
      try { await (this.cdp as any)?.send("CSS.stopRuleUsageTracking"); } catch {}
      this.cssActive = false;
    }
  }

  async startJsCoverage(): Promise<void> {
    if (!this.cdp) throw new Error("Coverage domain not attached");
    await this.cdp.send("Profiler.enable");
    await this.cdp.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true } as any);
    this.jsActive = true;
  }

  async stopJsCoverage(): Promise<CoverageResult> {
    if (!this.cdp) throw new Error("Coverage domain not attached");
    const { result } = (await this.cdp.send("Profiler.takePreciseCoverage")) as { result: any[] };
    await this.cdp.send("Profiler.stopPreciseCoverage");
    await this.cdp.send("Profiler.disable");
    this.jsActive = false;
    const entries = this.processJsCoverage(result);
    return this.saveCoverageResult("js", entries);
  }

  async startCssCoverage(): Promise<void> {
    if (!this.cdp) throw new Error("Coverage domain not attached");
    // CSS domain requires DOM agent to be enabled first
    await this.cdp.send("DOM.enable");
    await (this.cdp as any).send("CSS.enable");
    await (this.cdp as any).send("CSS.startRuleUsageTracking");
    this.cssActive = true;
  }

  async stopCssCoverage(): Promise<CoverageResult> {
    if (!this.cdp) throw new Error("Coverage domain not attached");
    const { ruleUsage } = (await (this.cdp as any).send("CSS.stopRuleUsageTracking")) as { ruleUsage: any[] };
    this.cssActive = false;
    const entries = this.processCssCoverage(ruleUsage);
    return this.saveCoverageResult("css", entries);
  }

  filterEntries(entries: CoverageEntry[], filter: CoverageQueryFilter): CoverageEntry[] {
    let results = [...entries];
    if (filter.url) {
      const pattern = filter.url.toLowerCase();
      results = results.filter((e) => e.url.toLowerCase().includes(pattern));
    }
    if (filter.minUnusedPercent !== undefined) {
      results = results.filter((e) => e.unusedPercent >= filter.minUnusedPercent!);
    }
    return results;
  }

  private processJsCoverage(scripts: any[]): CoverageEntry[] {
    return scripts
      .filter((s) => s.url && !s.url.startsWith("extensions://"))
      .map((script) => {
        const totalBytes = script.functions.reduce((sum: number, fn: any) => {
          return sum + fn.ranges.reduce((s: number, r: any) => s + (r.endOffset - r.startOffset), 0);
        }, 0);
        const usedBytes = script.functions.reduce((sum: number, fn: any) => {
          return sum + fn.ranges
            .filter((r: any) => r.count > 0)
            .reduce((s: number, r: any) => s + (r.endOffset - r.startOffset), 0);
        }, 0);
        const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;
        return {
          url: script.url,
          totalBytes,
          usedBytes,
          usedPercent,
          unusedPercent: Math.round((100 - usedPercent) * 100) / 100,
        };
      });
  }

  private processCssCoverage(rules: any[]): CoverageEntry[] {
    const sheets = new Map<string, { total: number; used: number }>();
    for (const rule of rules) {
      const key = rule.styleSheetId || "inline";
      const existing = sheets.get(key) ?? { total: 0, used: 0 };
      const size = rule.endOffset - rule.startOffset;
      existing.total += size;
      if (rule.used) existing.used += size;
      sheets.set(key, existing);
    }
    return [...sheets.entries()].map(([url, { total, used }]) => {
      const usedPercent = total > 0 ? Math.round((used / total) * 10000) / 100 : 0;
      return {
        url,
        totalBytes: total,
        usedBytes: used,
        usedPercent,
        unusedPercent: Math.round((100 - usedPercent) * 100) / 100,
      };
    });
  }

  private async saveCoverageResult(type: "js" | "css", entries: CoverageEntry[]): Promise<CoverageResult> {
    const totalBytes = entries.reduce((s, e) => s + e.totalBytes, 0);
    const usedBytes = entries.reduce((s, e) => s + e.usedBytes, 0);
    const overallUsedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;
    const summary = { totalBytes, usedBytes, overallUsedPercent };
    const id = randomUUID();
    await this.store.saveArtifact(id, "coverage", type, JSON.stringify({ entries, summary }), ".json");
    this.store.updateSummary(id, summary as unknown as Record<string, unknown>);
    return { id, type, entries, summary };
  }
}
