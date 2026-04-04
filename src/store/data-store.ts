import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileRecord } from "../types.js";

export class DataStore {
  private records = new Map<string, ProfileRecord>();
  private initialized = false;

  constructor(private readonly outputDir: string) {}

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.outputDir, { recursive: true });
    this.initialized = true;
  }

  save(record: ProfileRecord): void {
    this.records.set(record.id, record);
  }

  get(id: string): ProfileRecord | undefined {
    return this.records.get(id);
  }

  listByDomain(domain: string): ProfileRecord[] {
    return [...this.records.values()].filter((r) => r.domain === domain);
  }

  listAll(): ProfileRecord[] {
    return [...this.records.values()];
  }

  async saveArtifact(
    id: string,
    domain: string,
    type: string,
    data: string | Buffer,
    ext: string,
  ): Promise<ProfileRecord> {
    await this.ensureDir();
    const filename = `${domain}-${id}-${Date.now()}${ext}`;
    const artifactPath = join(this.outputDir, filename);
    await writeFile(artifactPath, data);

    const record: ProfileRecord = {
      id,
      domain,
      type,
      timestamp: Date.now(),
      summary: {},
      artifactPath,
    };
    this.records.set(id, record);
    return record;
  }

  updateSummary(id: string, summary: Record<string, unknown>): void {
    const record = this.records.get(id);
    if (record) {
      record.summary = summary;
    }
  }

  async flushManifest(): Promise<void> {
    await this.ensureDir();
    const manifest = [...this.records.values()];
    await writeFile(join(this.outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }

  async readArtifact(id: string): Promise<string> {
    const record = this.records.get(id);
    if (!record?.artifactPath) {
      throw new Error(`No artifact found for record: ${id}`);
    }
    return readFile(record.artifactPath, "utf-8");
  }
}
