import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';

export async function fetchUSDA(url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(25_000),
        headers: { 'User-Agent': 'US-Crop-Atlas/1.0' },
      });
      if (!res.ok) throw new Error(`USDA returned HTTP ${res.status}`);
      return res;
    } catch (error) {
      last = error;
      if (i < attempts - 1)
        await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  throw last;
}

export async function fetchJSON(url) {
  const data = await (await fetchUSDA(url)).json();
  if (data.error) throw new Error(data.error.message ?? 'USDA service error');
  return data;
}

// Content-keyed, bounded disk cache. Errors are never written; partial writes are atomic.
export class DiskCache {
  constructor(dir, { ttl = 7 * 86400_000, maxBytes = 1024 ** 3 } = {}) {
    this.dir = dir;
    this.ttl = ttl;
    this.maxBytes = maxBytes;
    this.pending = new Map();
    this.lastPrune = 0;
  }
  async get(key, loader) {
    const id = createHash('sha256').update(key).digest('hex');
    if (this.pending.has(id)) return this.pending.get(id);
    const task = this.load(id, loader).finally(() => this.pending.delete(id));
    this.pending.set(id, task);
    return task;
  }
  async load(id, loader) {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, id);
    try {
      const cached = JSON.parse(await readFile(path, 'utf8'));
      if (Date.now() - Date.parse(cached.fetchedAt) < this.ttl)
        return { ...cached, cache: 'hit' };
    } catch {
      /* missing or invalid entry is refetched */
    }
    const value = { ...(await loader()), fetchedAt: new Date().toISOString() };
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value));
    await rename(temp, path);
    if (Date.now() - this.lastPrune > 60_000) {
      this.lastPrune = Date.now();
      await this.prune();
    }
    return { ...value, cache: 'miss' };
  }
  async prune() {
    const files = await readdir(this.dir);
    const entries = (
      await Promise.all(
        files
          .filter((name) => /^[a-f0-9]{64}$/.test(name))
          .map(async (name) => {
            const path = join(this.dir, name);
            const info = await stat(path).catch(() => null);
            return info ? { path, size: info.size, time: info.mtimeMs } : null;
          }),
      )
    )
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (total <= this.maxBytes && Date.now() - entry.time <= this.ttl) break;
      await unlink(entry.path).catch(() => {});
      total -= entry.size;
    }
  }
}
