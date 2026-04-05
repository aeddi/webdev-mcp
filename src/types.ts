import type { CDPSession, Page } from "playwright";

// ---- Domain Module Interface

export interface DomainModule {
  readonly name: string;
  readonly cdpDomains: string[];
  attach(cdp: CDPSession, page: Page): Promise<void>;
  detach(): Promise<void>;
  reset(): Promise<void>;
}

// ---- Profile Records

export interface ProfileRecord {
  id: string;
  domain: string;
  type: string;
  timestamp: number;
  summary: Record<string, unknown>;
  artifactPath?: string;
}

// ---- Error Types

export type ErrorCategory =
  | "session"
  | "navigation"
  | "cdp"
  | "profiling"
  | "query"
  | "internal";

export interface ToolError {
  category: ErrorCategory;
  message: string;
  details?: unknown;
}

// ---- Tool Responses

export interface ToolSuccess {
  success: true;
  [key: string]: unknown;
}

export interface ToolFailure {
  success: false;
  error: ToolError;
}

export type ToolResult = ToolSuccess | ToolFailure;

export function toolSuccess(data: Record<string, unknown>): ToolSuccess {
  return { success: true, ...data };
}

export function toolError(
  category: ErrorCategory,
  message: string,
  details?: unknown,
): ToolFailure {
  return { success: false, error: { category, message, details } };
}

// ---- Query Filters

export interface CpuQueryFilter {
  minSelfTime?: number;
  functionName?: string;
  url?: string;
}

export interface MemoryQueryFilter {
  objectType?: string;
  minRetainedSize?: number;
}

export interface AllocationQueryFilter {
  functionName?: string;
  url?: string;
  minSelfSize?: number;
}

export interface NetworkQueryFilter {
  resourceType?: string;
  minSize?: number;
  blocking?: boolean;
  domain?: string;
}

export interface RenderingQueryFilter {
  minDuration?: number;
  type?: "layout-shift" | "long-task" | "paint";
  selector?: string;
}

export interface CoverageQueryFilter {
  url?: string;
  minUnusedPercent?: number;
}

export type QueryFilter =
  | CpuQueryFilter
  | MemoryQueryFilter
  | AllocationQueryFilter
  | NetworkQueryFilter
  | RenderingQueryFilter
  | CoverageQueryFilter;

export type QueryHandler = (
  artifactPath: string,
  filter: QueryFilter,
) => Promise<Record<string, unknown>>;

// ---- Browser Config

export interface BrowserConfig {
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
  locale?: string;
  extraHTTPHeaders?: Record<string, string>;
  isMobile?: boolean;
}

// ---- Network Request Record

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  resourceType: string;
  startTime: number;
  endTime?: number;
  status?: number;
  mimeType?: string;
  transferSize?: number;
  encodedDataLength?: number;
  timing?: {
    dnsStart: number;
    dnsEnd: number;
    connectStart: number;
    connectEnd: number;
    sslStart: number;
    sslEnd: number;
    sendStart: number;
    sendEnd: number;
    receiveHeadersEnd: number;
  };
  cached: boolean;
  initiator?: string;
  renderBlocking?: string;
}

// ---- Console Entry

export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  stackTrace?: string;
}
