import { firefox, webkit, type BrowserType } from "playwright";
import type { DataStore } from "../store/data-store.js";
import { randomUUID } from "node:crypto";

export interface CrossBrowserOptions {
  browsers: Array<"firefox" | "webkit">;
  viewport: { width: number; height: number };
  referenceScreenshot?: Buffer;
}

export interface DiffResult {
  mismatchPercent: number;
  diffPixels: number;
  diffImageId?: string;
}

export interface CrossBrowserResult {
  screenshots: { firefox?: Buffer; webkit?: Buffer };
  diffs?: { firefox?: DiffResult; webkit?: DiffResult };
}

export class CrossBrowserDomain {
  constructor(private readonly store: DataStore) {}

  async capture(url: string, options: CrossBrowserOptions): Promise<CrossBrowserResult> {
    const result: CrossBrowserResult = { screenshots: {} };
    const browserTypes: Record<string, BrowserType> = { firefox, webkit };

    const captures = options.browsers.map(async (browserName) => {
      const browserType = browserTypes[browserName];
      if (!browserType) throw new Error(`Unknown browser: ${browserName}`);

      const browser = await browserType.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport: options.viewport });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "load" });
        const screenshot = Buffer.from(await page.screenshot({ type: "png" }));
        const id = randomUUID();
        await this.store.saveArtifact(id, "cross-browser", browserName, screenshot, ".png");
        return { browserName, screenshot };
      } finally {
        await browser.close();
      }
    });

    const results = await Promise.all(captures);
    for (const { browserName, screenshot } of results) {
      (result.screenshots as Record<string, Buffer>)[browserName] = screenshot;
    }

    if (options.referenceScreenshot) {
      result.diffs = {};
      for (const { browserName, screenshot } of results) {
        const diff = await this.computeDiff(options.referenceScreenshot, screenshot);
        (result.diffs as Record<string, DiffResult>)[browserName] = diff;
      }
    }

    return result;
  }

  private async computeDiff(imgA: Buffer, imgB: Buffer): Promise<DiffResult> {
    const { PNG } = await import("pngjs");
    const pixelmatch = (await import("pixelmatch")).default;

    const pngA = PNG.sync.read(imgA);
    const pngB = PNG.sync.read(imgB);

    const width = Math.min(pngA.width, pngB.width);
    const height = Math.min(pngA.height, pngB.height);

    const dataA = this.cropToSize(pngA, width, height);
    const dataB = this.cropToSize(pngB, width, height);

    const diffPng = new PNG({ width, height });
    const diffPixels = pixelmatch(dataA, dataB, diffPng.data, width, height, { threshold: 0.1 });

    const totalPixels = width * height;
    const mismatchPercent = Math.round((diffPixels / totalPixels) * 10000) / 100;

    let diffImageId: string | undefined;
    if (diffPixels > 0) {
      diffImageId = randomUUID();
      const diffBuffer = PNG.sync.write(diffPng);
      await this.store.saveArtifact(diffImageId, "cross-browser", "diff", diffBuffer, ".png");
    }

    return { mismatchPercent, diffPixels, diffImageId };
  }

  private cropToSize(
    png: { data: Buffer; width: number; height: number },
    width: number,
    height: number,
  ): Buffer {
    if (png.width === width && png.height === height) return png.data;
    const cropped = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcOffset = y * png.width * 4;
      const dstOffset = y * width * 4;
      png.data.copy(cropped, dstOffset, srcOffset, srcOffset + width * 4);
    }
    return cropped;
  }
}
