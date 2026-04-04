import type { CDPSession, Page } from "playwright";
import type { DomainModule, ConsoleEntry } from "../types.js";

export class ConsoleDomain implements DomainModule {
  readonly name = "console";
  readonly cdpDomains = ["Runtime"];

  private entries: ConsoleEntry[] = [];
  private cdp: CDPSession | null = null;
  private onEntry: ((event: any) => void) | null = null;
  private onException: ((event: any) => void) | null = null;

  async attach(cdp: CDPSession, _page: Page): Promise<void> {
    this.cdp = cdp;
    await cdp.send("Runtime.enable");

    this.onEntry = (event: any) => {
      const args = event.args ?? [];
      const text = args.map((a: any) => a.value ?? a.description ?? "").join(" ");
      const level = this.mapType(event.type);
      this.entries.push({
        level,
        text,
        timestamp: event.timestamp ?? Date.now(),
        url: event.stackTrace?.callFrames?.[0]?.url,
        lineNumber: event.stackTrace?.callFrames?.[0]?.lineNumber,
        stackTrace: event.stackTrace
          ? event.stackTrace.callFrames
              .map((f: any) => `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
              .join("\n")
          : undefined,
      });
    };

    this.onException = (event: any) => {
      const detail = event.exceptionDetails;
      this.entries.push({
        level: "error",
        text: detail.text ?? detail.exception?.description ?? "Uncaught exception",
        timestamp: detail.timestamp ?? Date.now(),
        url: detail.url,
        lineNumber: detail.lineNumber,
        stackTrace: detail.stackTrace
          ? detail.stackTrace.callFrames
              .map((f: any) => `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
              .join("\n")
          : undefined,
      });
    };

    cdp.on("Runtime.consoleAPICalled", this.onEntry);
    cdp.on("Runtime.exceptionThrown", this.onException);
  }

  async detach(): Promise<void> {
    if (this.cdp) {
      this.cdp.off("Runtime.consoleAPICalled", this.onEntry!);
      this.cdp.off("Runtime.exceptionThrown", this.onException!);
      try { await this.cdp.send("Runtime.disable"); } catch {}
    }
    this.cdp = null;
    this.onEntry = null;
    this.onException = null;
  }

  async reset(): Promise<void> {
    this.entries = [];
  }

  getEntries(level?: string): ConsoleEntry[] {
    if (level) {
      return this.entries.filter((e) => e.level === level);
    }
    return [...this.entries];
  }

  private mapType(type: string): ConsoleEntry["level"] {
    switch (type) {
      case "log": return "log";
      case "info": return "info";
      case "warning": return "warn";
      case "error": return "error";
      case "debug": return "debug";
      default: return "log";
    }
  }
}
