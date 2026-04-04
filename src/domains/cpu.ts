import type { CDPSession, Page } from "playwright";
import type { DomainModule, CpuQueryFilter } from "../types.js";
import { randomUUID } from "node:crypto";

interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount: number;
  children?: number[];
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

export interface CpuProfilingResult {
  profile: CpuProfile;
  summary: {
    totalSamples: number;
    durationMs: number;
    topFunctions: Array<{
      functionName: string;
      url: string;
      lineNumber: number;
      selfTime: number;
      hitCount: number;
    }>;
  };
}

export class CpuDomain implements DomainModule {
  readonly name = "cpu";
  readonly cdpDomains = ["Profiler"];

  private cdp: CDPSession | null = null;
  private activeSessionId: string | null = null;

  async attach(cdp: CDPSession, _page: Page): Promise<void> {
    this.cdp = cdp;
    await cdp.send("Profiler.enable");
  }

  async detach(): Promise<void> {
    if (this.activeSessionId) {
      try {
        await this.cdp?.send("Profiler.stop");
      } catch {
        // Profiler may already be stopped or session closed
      }
      this.activeSessionId = null;
    }
    try {
      await this.cdp?.send("Profiler.disable");
    } catch {
      // Session may be closed
    }
    this.cdp = null;
  }

  async reset(): Promise<void> {
    if (this.activeSessionId) {
      try {
        await this.cdp?.send("Profiler.stop");
      } catch {
        // Profiler may already be stopped
      }
      this.activeSessionId = null;
    }
  }

  isActive(): boolean {
    return this.activeSessionId !== null;
  }

  async startProfiling(): Promise<string> {
    if (!this.cdp) throw new Error("CPU domain not attached");

    if (this.activeSessionId) {
      try {
        await this.cdp.send("Profiler.stop");
      } catch {
        // Previous session may already be stopped
      }
    }

    const sessionId = randomUUID();
    await this.cdp.send("Profiler.start");
    this.activeSessionId = sessionId;
    return sessionId;
  }

  async stopProfiling(sessionId: string): Promise<CpuProfilingResult> {
    if (!this.cdp) throw new Error("CPU domain not attached");
    if (this.activeSessionId !== sessionId) {
      throw new Error(`No active profiling session with ID: ${sessionId}`);
    }

    const { profile } = (await this.cdp.send("Profiler.stop")) as { profile: CpuProfile };
    this.activeSessionId = null;

    const summary = this.buildSummary(profile);
    return { profile, summary };
  }

  filterProfile(profile: CpuProfile, filter: CpuQueryFilter): CpuProfileNode[] {
    let nodes = profile.nodes.filter((n) => n.hitCount > 0);

    if (filter.functionName) {
      const pattern = filter.functionName.toLowerCase();
      nodes = nodes.filter((n) => n.callFrame.functionName.toLowerCase().includes(pattern));
    }
    if (filter.url) {
      const pattern = filter.url.toLowerCase();
      nodes = nodes.filter((n) => n.callFrame.url.toLowerCase().includes(pattern));
    }
    if (filter.minSelfTime !== undefined) {
      const totalSamples = profile.samples.length;
      const totalTime = profile.endTime - profile.startTime;
      nodes = nodes.filter((n) => {
        const selfTime = (n.hitCount / totalSamples) * totalTime;
        return selfTime >= filter.minSelfTime!;
      });
    }

    return nodes;
  }

  private buildSummary(profile: CpuProfile): CpuProfilingResult["summary"] {
    const totalSamples = profile.samples.length;
    const durationMs = Math.round((profile.endTime - profile.startTime) / 1000);
    const totalTime = profile.endTime - profile.startTime;

    const topFunctions = profile.nodes
      .filter((n) => n.hitCount > 0 && n.callFrame.functionName)
      .map((n) => ({
        functionName: n.callFrame.functionName,
        url: n.callFrame.url,
        lineNumber: n.callFrame.lineNumber,
        selfTime: Math.round(((n.hitCount / totalSamples) * totalTime) / 1000),
        hitCount: n.hitCount,
      }))
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, 10);

    return { totalSamples, durationMs, topFunctions };
  }
}
