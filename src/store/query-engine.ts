import type { QueryFilter, QueryHandler } from "../types.js";

export class QueryEngine {
  private handlers = new Map<string, QueryHandler>();

  register(domain: string, handler: QueryHandler): void {
    this.handlers.set(domain, handler);
  }

  async query(
    domain: string,
    artifactPath: string,
    filter: QueryFilter,
  ): Promise<Record<string, unknown>> {
    const handler = this.handlers.get(domain);
    if (!handler) {
      throw new Error(`No query handler registered for domain: ${domain}`);
    }
    return handler(artifactPath, filter);
  }

  registeredDomains(): string[] {
    return [...this.handlers.keys()];
  }
}
