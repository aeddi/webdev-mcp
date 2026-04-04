import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from "playwright";
import type { DomainModule, BrowserConfig } from "../types.js";

export interface NavigationResult {
  url: string;
  status: number;
  loadTimeMs: number;
}

export interface AuthConfig {
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
  }>;
  headers?: Record<string, string>;
  localStorage?: Record<string, string>;
}

export class SessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private modules: DomainModule[] = [];
  private config: BrowserConfig = {};
  private currentUrl: string | null = null;
  private hasNavigated = false;

  configure(config: BrowserConfig): void {
    this.config = { ...this.config, ...config };
  }

  registerModule(module: DomainModule): void {
    this.modules.push(module);
    if (this.cdpSession && this.page) {
      module.attach(this.cdpSession, this.page);
    }
  }

  isActive(): boolean {
    return this.browser !== null && this.page !== null;
  }

  getPage(): Page | null {
    return this.page;
  }

  getCDPSession(): CDPSession | null {
    return this.cdpSession;
  }

  getCurrentUrl(): string | null {
    return this.currentUrl;
  }

  getConfig(): BrowserConfig {
    return { ...this.config };
  }

  async navigate(url: string): Promise<NavigationResult> {
    if (!this.browser) {
      await this.launch();
    }

    if (this.hasNavigated) {
      for (const mod of this.modules) {
        await mod.reset();
      }
    }

    const start = performance.now();
    const response = await this.page!.goto(url, { waitUntil: "load" });
    const loadTimeMs = Math.round(performance.now() - start);

    this.currentUrl = url;
    this.hasNavigated = true;

    return {
      url,
      status: response?.status() ?? 0,
      loadTimeMs,
    };
  }

  async reload(): Promise<NavigationResult> {
    if (!this.page) {
      throw new Error("No active page to reload");
    }

    for (const mod of this.modules) {
      await mod.reset();
    }

    const start = performance.now();
    const response = await this.page.reload({ waitUntil: "load" });
    const loadTimeMs = Math.round(performance.now() - start);

    return {
      url: this.currentUrl ?? this.page.url(),
      status: response?.status() ?? 0,
      loadTimeMs,
    };
  }

  async setAuth(auth: AuthConfig): Promise<void> {
    if (!this.context) {
      throw new Error("No active browser context");
    }

    if (auth.cookies) {
      await this.context.addCookies(auth.cookies);
    }

    if (auth.headers) {
      await this.context.setExtraHTTPHeaders(auth.headers);
    }

    if (auth.localStorage && this.page) {
      for (const [key, value] of Object.entries(auth.localStorage)) {
        await this.page.evaluate(
          ([k, v]) => localStorage.setItem(k, v),
          [key, value],
        );
      }
    }
  }

  async close(): Promise<void> {
    for (const mod of this.modules) {
      await mod.detach();
    }

    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
    }
    if (this.page) {
      this.page = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.currentUrl = null;
    this.hasNavigated = false;
  }

  private async launch(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });

    const contextOptions: Record<string, unknown> = {};
    if (this.config.viewport) {
      contextOptions.viewport = this.config.viewport;
    }
    if (this.config.deviceScaleFactor) {
      contextOptions.deviceScaleFactor = this.config.deviceScaleFactor;
    }
    if (this.config.userAgent) {
      contextOptions.userAgent = this.config.userAgent;
    }
    if (this.config.locale) {
      contextOptions.locale = this.config.locale;
    }
    if (this.config.isMobile !== undefined) {
      contextOptions.isMobile = this.config.isMobile;
    }
    if (this.config.extraHTTPHeaders) {
      contextOptions.extraHTTPHeaders = this.config.extraHTTPHeaders;
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    this.cdpSession = await this.context.newCDPSession(this.page);

    for (const mod of this.modules) {
      await mod.attach(this.cdpSession, this.page);
    }
  }
}
