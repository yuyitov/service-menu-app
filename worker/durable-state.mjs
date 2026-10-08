/** Strongly consistent state for the serialized HMU coordinator.
 * Legacy KV is read-only fallback during a controlled cutover. Every new write
 * lives in Durable Object storage. Tombstones prevent expired/deleted records
 * from being resurrected from the legacy namespace. Never deploy gradually.
 */
export class DurableStateStore {
  constructor(storage, legacy, now = () => Date.now()) {
    this.storage = storage;
    this.legacy = legacy;
    this.now = now;
  }
  async get(key, options = {}) {
    const item = await this.storage.get(`state:${key}`);
    let value;
    if (item !== undefined) {
      if (item.deleted) return null;
      if (item.expiresAt && item.expiresAt <= this.now()) {
        await this.storage.put(`state:${key}`, { deleted: true });
        return null;
      }
      value = item.value;
    } else {
      // Do not cache legacy reads: KV remains responsible for their original
      // expiry until the first authorized write migrates this exact record.
      value = await this.legacy.get(key);
    }
    if (value == null) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value, options = {}) {
    return this.putMany([{ key, value, options }]);
  }
  async putMany(entries) {
    const records = {};
    for (const { key, value, options = {} } of entries) {
      const expiresAt = options.expirationTtl ? this.now() + options.expirationTtl * 1000 : null;
      records[`state:${key}`] = { value: String(value), expiresAt };
      if (expiresAt) records[`expires:${String(expiresAt).padStart(16, '0')}:${key}`] = { key, expiresAt };
    }
    // A multi-key put is one atomic, isolated Durable Object storage operation.
    const expiries = entries.filter(e => e.options?.expirationTtl).map(e => this.now() + e.options.expirationTtl * 1000);
    if (expiries.length) {
      const next = Math.min(...expiries);
      const alarm = await this.storage.getAlarm();
      if (alarm == null || next < alarm) await this.storage.setAlarm(next);
    }
    await this.storage.put(records);
  }
  async cleanupExpired() {
    const now = this.now();
    const due = await this.storage.list({ prefix: 'expires:', end: `expires:${String(now).padStart(16, '0')}:\uffff`, limit: 64 });
    for (const [index, { key, expiresAt }] of due) {
      const item = await this.storage.get(`state:${key}`);
      if (item?.expiresAt === expiresAt && expiresAt <= now) {
        // Rate-limit keys contain a minute slot and can never be reused.
        if (/^[a-z0-9]+_rl:/.test(key)) await this.storage.delete(`state:${key}`);
        else await this.storage.put(`state:${key}`, { deleted: true });
      }
      await this.storage.delete(index);
    }
    const next = await this.storage.list({ prefix: 'expires:', limit: 1 });
    if (next.size) await this.storage.setAlarm(Math.max(now + 1000, [...next.values()][0].expiresAt));
    else await this.storage.deleteAlarm();
  }
  async delete(key) {
    await this.storage.put(`state:${key}`, { deleted: true });
  }
}

/** Serializes whole requests, including provider awaits. DO input gates alone
 * do not serialize arbitrary fetch() calls; a KV read/write is never a lock.
 */
export class RequestQueue {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

/** Buffer a bounded request before it enters the product-wide state queue. */
export async function boundedRequest(request, { maxBytes = 1048576, timeoutMs = 15000 } = {}) {
  if (!request.body) return request;
  const reader = request.body.getReader();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error('request_body_timeout')); }, timeoutMs);
  });
  try {
    const bytes = await Promise.race([(async () => {
      const chunks = []; let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) { void reader.cancel().catch(() => {}); throw new Error('request_body_too_large'); }
        chunks.push(value);
      }
      const all = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
      return all;
    })(), timeout]);
    return new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
