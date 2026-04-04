import type { CDPSession, Page } from "playwright";
import type { DomainModule } from "../types.js";
import type { RenderingDomain } from "./rendering.js";

export interface InteractionArgs {
  action: "click" | "type" | "scroll" | "hover";
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
}

export interface InteractionResult {
  action: string;
  durationMs: number;
  impact: { layoutShifts: number; longTasks: number };
}

export interface ScreenshotArgs {
  selector?: string;
  fullPage?: boolean;
  label?: string;
}

export class InteractionDomain implements DomainModule {
  readonly name = "interaction";
  readonly cdpDomains = [];
  private page: Page | null = null;

  constructor(private readonly rendering: RenderingDomain) {}

  async attach(_cdp: CDPSession, page: Page): Promise<void> {
    this.page = page;
  }

  async detach(): Promise<void> {
    this.page = null;
  }

  async reset(): Promise<void> {}

  async perform(args: InteractionArgs): Promise<InteractionResult> {
    if (!this.page) throw new Error("Interaction domain not attached");

    await this.rendering.collectEntries();
    const beforeCount = this.rendering.getEntries().length;
    const start = performance.now();

    switch (args.action) {
      case "click":
        if (args.selector) await this.page.click(args.selector);
        else if (args.x !== undefined && args.y !== undefined) await this.page.mouse.click(args.x, args.y);
        break;
      case "type":
        if (args.selector && args.text) await this.page.fill(args.selector, args.text);
        else if (args.text) await this.page.keyboard.type(args.text);
        break;
      case "scroll":
        if (args.selector) await this.page.locator(args.selector).scrollIntoViewIfNeeded();
        else await this.page.mouse.wheel(args.x ?? 0, args.y ?? 0);
        break;
      case "hover":
        if (args.selector) await this.page.hover(args.selector);
        else if (args.x !== undefined && args.y !== undefined) await this.page.mouse.move(args.x, args.y);
        break;
    }

    const durationMs = Math.round(performance.now() - start);
    await new Promise((r) => setTimeout(r, 100));
    await this.rendering.collectEntries();
    const afterEntries = this.rendering.getEntries();
    const newEntries = afterEntries.slice(beforeCount);

    return {
      action: args.action,
      durationMs,
      impact: {
        layoutShifts: newEntries.filter((e) => e.type === "layout-shift").length,
        longTasks: newEntries.filter((e) => e.type === "long-task").length,
      },
    };
  }

  async screenshot(args: ScreenshotArgs): Promise<Buffer> {
    if (!this.page) throw new Error("Interaction domain not attached");
    if (args.selector) {
      return Buffer.from(await this.page.locator(args.selector).screenshot({ type: "png" }));
    }
    return Buffer.from(await this.page.screenshot({ type: "png", fullPage: args.fullPage ?? false }));
  }
}
