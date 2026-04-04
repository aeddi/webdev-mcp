import type { CDPSession, Page } from "playwright";
import type { DomainModule } from "../types.js";

export interface DomStats {
  nodeCount: number;
  maxDepth: number;
  tagDistribution: Record<string, number>;
  detachedNodes: number;
}

export class DomDomain implements DomainModule {
  readonly name = "dom";
  readonly cdpDomains = ["DOM"];
  private cdp: CDPSession | null = null;
  private page: Page | null = null;

  async attach(cdp: CDPSession, page: Page): Promise<void> {
    this.cdp = cdp;
    this.page = page;
  }

  async detach(): Promise<void> {
    this.cdp = null;
    this.page = null;
  }

  async reset(): Promise<void> {
    // No state to reset — on-demand reads
  }

  async getStats(): Promise<DomStats> {
    if (!this.page) throw new Error("DOM domain not attached");

    const stats = await this.page.evaluate(() => {
      let nodeCount = 0;
      let maxDepth = 0;
      const tagDistribution: Record<string, number> = {};

      function walk(node: Node, depth: number): void {
        nodeCount++;
        if (depth > maxDepth) maxDepth = depth;
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = (node as Element).tagName;
          tagDistribution[tag] = (tagDistribution[tag] ?? 0) + 1;
        }
        for (const child of node.childNodes) {
          walk(child, depth + 1);
        }
      }

      walk(document.documentElement, 0);
      return { nodeCount, maxDepth, tagDistribution };
    });

    return { ...stats, detachedNodes: 0 };
    // NOTE: Accurate detached node counting via CDP queryObjects is unreliable
    // and slow. Return 0 for now — the agent can detect detached nodes via
    // heap snapshot comparison instead, which is more accurate.
  }
}
