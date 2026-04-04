import type { CDPSession, Page } from "playwright";
import type { DomainModule, NetworkRequest, NetworkQueryFilter } from "../types.js";

export class NetworkDomain implements DomainModule {
  readonly name = "network";
  readonly cdpDomains = ["Network"];

  private requests = new Map<string, NetworkRequest>();
  private cdp: CDPSession | null = null;
  private handlers: Array<{ event: string; handler: (e: any) => void }> = [];

  async attach(cdp: CDPSession, _page: Page): Promise<void> {
    this.cdp = cdp;
    await cdp.send("Network.enable");

    this.listen(cdp, "Network.requestWillBeSent", (event) => {
      this.requests.set(event.requestId, {
        requestId: event.requestId,
        url: event.request.url,
        method: event.request.method,
        resourceType: event.type,
        startTime: event.timestamp * 1000,
        cached: false,
        initiator: event.initiator?.type,
        renderBlocking: event.request.isLinkPreload ? "non-blocking" : undefined,
      });
    });

    this.listen(cdp, "Network.responseReceived", (event) => {
      const req = this.requests.get(event.requestId);
      if (req) {
        req.status = event.response.status;
        req.mimeType = event.response.mimeType;
        req.cached = event.response.fromDiskCache || event.response.fromServiceWorker || false;
        if (event.response.timing) {
          req.timing = {
            dnsStart: event.response.timing.dnsStart,
            dnsEnd: event.response.timing.dnsEnd,
            connectStart: event.response.timing.connectStart,
            connectEnd: event.response.timing.connectEnd,
            sslStart: event.response.timing.sslStart,
            sslEnd: event.response.timing.sslEnd,
            sendStart: event.response.timing.sendStart,
            sendEnd: event.response.timing.sendEnd,
            receiveHeadersEnd: event.response.timing.receiveHeadersEnd,
          };
        }
      }
    });

    this.listen(cdp, "Network.loadingFinished", (event) => {
      const req = this.requests.get(event.requestId);
      if (req) {
        req.endTime = event.timestamp * 1000;
        req.encodedDataLength = event.encodedDataLength;
      }
    });

    this.listen(cdp, "Network.loadingFailed", (event) => {
      const req = this.requests.get(event.requestId);
      if (req) {
        req.endTime = event.timestamp * 1000;
        req.status = 0;
      }
    });

    this.listen(cdp, "Network.requestServedFromCache", (event) => {
      const req = this.requests.get(event.requestId);
      if (req) {
        req.cached = true;
      }
    });
  }

  async detach(): Promise<void> {
    if (this.cdp) {
      for (const { event, handler } of this.handlers) {
        this.cdp.off(event, handler);
      }
      try { await this.cdp.send("Network.disable"); } catch {}
    }
    this.handlers = [];
    this.cdp = null;
  }

  async reset(): Promise<void> {
    this.requests.clear();
  }

  getRequests(filter?: Partial<NetworkQueryFilter>): NetworkRequest[] {
    let results = [...this.requests.values()];
    if (filter?.resourceType) {
      results = results.filter((r) => r.resourceType === filter.resourceType);
    }
    if (filter?.minSize !== undefined) {
      results = results.filter((r) => (r.encodedDataLength ?? 0) >= filter.minSize!);
    }
    if (filter?.blocking !== undefined) {
      results = results.filter((r) =>
        filter.blocking ? r.renderBlocking !== "non-blocking" : r.renderBlocking === "non-blocking",
      );
    }
    if (filter?.domain) {
      results = results.filter((r) => {
        try { return new URL(r.url).hostname.includes(filter.domain!); } catch { return false; }
      });
    }
    return results;
  }

  getSummary(): Record<string, unknown> {
    const requests = [...this.requests.values()];
    const totalSize = requests.reduce((sum, r) => sum + (r.encodedDataLength ?? 0), 0);
    const byType: Record<string, number> = {};
    for (const req of requests) {
      byType[req.resourceType] = (byType[req.resourceType] ?? 0) + 1;
    }
    return {
      totalRequests: requests.length,
      totalSize,
      byType,
      cached: requests.filter((r) => r.cached).length,
      failed: requests.filter((r) => r.status === 0 || (r.status && r.status >= 400)).length,
    };
  }

  private listen(cdp: CDPSession, event: string, handler: (e: any) => void): void {
    cdp.on(event, handler);
    this.handlers.push({ event, handler });
  }
}
