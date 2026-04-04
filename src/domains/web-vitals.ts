import type { CDPSession, Page } from "playwright";
import type { DomainModule } from "../types.js";

export interface WebVitalsMetrics {
  lcp: number;
  cls: number;
  inp: number;
}

export class WebVitalsDomain implements DomainModule {
  readonly name = "web-vitals";
  readonly cdpDomains = ["Performance"];

  private page: Page | null = null;
  private cdp: CDPSession | null = null;

  async attach(cdp: CDPSession, page: Page): Promise<void> {
    this.cdp = cdp;
    this.page = page;
    await this.injectObservers();
  }

  async detach(): Promise<void> {
    this.cdp = null;
    this.page = null;
  }

  async reset(): Promise<void> {
    if (this.page) {
      try {
        await this.page.evaluate(() => {
          const w = window as any;
          w.__wpo_vitals = { lcp: 0, cls: 0, inp: Infinity };
        });
      } catch {
        // Page may not be ready
      }
    }
  }

  async getMetrics(): Promise<WebVitalsMetrics> {
    if (!this.page) return { lcp: 0, cls: 0, inp: 0 };
    try {
      const metrics = await this.page.evaluate(() => {
        const w = window as any;
        return w.__wpo_vitals ?? { lcp: 0, cls: 0, inp: Infinity };
      });
      return {
        lcp: Math.round(metrics.lcp * 100) / 100,
        cls: Math.round(metrics.cls * 10000) / 10000,
        inp: metrics.inp === Infinity ? 0 : Math.round(metrics.inp),
      };
    } catch {
      return { lcp: 0, cls: 0, inp: 0 };
    }
  }

  private async injectObservers(): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.evaluate(() => {
        const w = window as any;
        w.__wpo_vitals = { lcp: 0, cls: 0, inp: Infinity };
        if (w.__wpo_vitals_installed) return;
        w.__wpo_vitals_installed = true;

        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const last = entries[entries.length - 1];
            if (last) w.__wpo_vitals.lcp = last.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!(entry as any).hadRecentInput) {
                w.__wpo_vitals.cls += (entry as any).value;
              }
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const duration = (entry as any).duration ?? entry.duration;
              if (duration < w.__wpo_vitals.inp) {
                w.__wpo_vitals.inp = duration;
              }
            }
          }).observe({ type: "event", buffered: true, durationThreshold: 0 } as PerformanceObserverInit);
        } catch {}
      });
    } catch {
      // Page may not be ready
    }
  }
}
