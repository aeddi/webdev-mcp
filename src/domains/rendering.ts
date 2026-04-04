import type { CDPSession, Page } from "playwright";
import type { DomainModule, RenderingQueryFilter } from "../types.js";

export interface RenderingEntry {
  type: "layout-shift" | "long-task" | "paint" | "animation-frame";
  timestamp: number;
  duration?: number;
  value?: number;
  details?: Record<string, unknown>;
}

export class RenderingDomain implements DomainModule {
  readonly name = "rendering";
  readonly cdpDomains = ["Performance", "LayerTree"];

  private cdp: CDPSession | null = null;
  private page: Page | null = null;
  private entries: RenderingEntry[] = [];

  async attach(cdp: CDPSession, page: Page): Promise<void> {
    this.cdp = cdp;
    this.page = page;
    await cdp.send("Performance.enable");
    try { await cdp.send("LayerTree.enable"); } catch {
      // LayerTree may not be available
    }
    await this.injectObservers();
  }

  async detach(): Promise<void> {
    try { await this.cdp?.send("Performance.disable"); } catch {
      // Session may be closed
    }
    try { await this.cdp?.send("LayerTree.disable"); } catch {
      // May not have been enabled
    }
    this.cdp = null;
    this.page = null;
  }

  async reset(): Promise<void> {
    this.entries = [];
    if (this.page) {
      await this.injectObservers();
    }
  }

  getEntries(filter?: Partial<RenderingQueryFilter>): RenderingEntry[] {
    let results = [...this.entries];
    if (filter?.type) {
      results = results.filter((e) => e.type === filter.type);
    }
    if (filter?.minDuration !== undefined) {
      results = results.filter((e) => (e.duration ?? 0) >= filter.minDuration!);
    }
    return results;
  }

  getSummary(): Record<string, unknown> {
    return {
      totalEntries: this.entries.length,
      layoutShifts: this.entries.filter((e) => e.type === "layout-shift").length,
      longTasks: this.entries.filter((e) => e.type === "long-task").length,
      paints: this.entries.filter((e) => e.type === "paint").length,
      cumulativeLayoutShift: this.entries
        .filter((e) => e.type === "layout-shift")
        .reduce((sum, e) => sum + (e.value ?? 0), 0),
      longestTask: this.entries
        .filter((e) => e.type === "long-task")
        .reduce((max, e) => Math.max(max, e.duration ?? 0), 0),
    };
  }

  async collectEntries(): Promise<void> {
    if (!this.page) return;
    try {
      const collected = await this.page.evaluate(() => {
        const w = window as any;
        const entries = w.__wpo_rendering_entries ?? [];
        w.__wpo_rendering_entries = [];
        return entries;
      });
      this.entries.push(...collected);
    } catch {
      // Page may have navigated
    }
  }

  private async injectObservers(): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.evaluate(() => {
        const w = window as any;
        w.__wpo_rendering_entries = w.__wpo_rendering_entries ?? [];
        if (w.__wpo_observers_installed) return;
        w.__wpo_observers_installed = true;

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__wpo_rendering_entries.push({
                type: "layout-shift",
                timestamp: entry.startTime,
                value: (entry as any).value,
                details: { hadRecentInput: (entry as any).hadRecentInput },
              });
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__wpo_rendering_entries.push({
                type: "long-task",
                timestamp: entry.startTime,
                duration: entry.duration,
              });
            }
          }).observe({ type: "longtask", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__wpo_rendering_entries.push({
                type: "paint",
                timestamp: entry.startTime,
                details: { name: entry.name },
              });
            }
          }).observe({ type: "paint", buffered: true });
        } catch {}
      });
    } catch {
      // Page may not be ready
    }
  }
}
