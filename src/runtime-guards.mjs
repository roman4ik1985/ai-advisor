export class BackpressureError extends Error {
  constructor(code = 'AI_QUEUE_FULL', message = 'The assistant is busy. Please try again shortly.') {
    super(message);
    this.name = 'BackpressureError';
    this.code = code;
  }
}

export class ConcurrencyLimiter {
  #active = 0;
  #closed = false;
  #queue = [];

  constructor({ maxConcurrent, maxQueue }) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
  }

  get active() {
    return this.#active;
  }

  get queued() {
    return this.#queue.length;
  }

  async run(task) {
    const release = await this.#acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    const queued = this.#queue.splice(0);
    for (const waiter of queued) {
      waiter.reject(new BackpressureError('SERVER_SHUTTING_DOWN', 'The server is shutting down.'));
    }
  }

  #acquire() {
    if (this.#closed) {
      return Promise.reject(new BackpressureError('SERVER_SHUTTING_DOWN', 'The server is shutting down.'));
    }
    if (this.#active < this.maxConcurrent) {
      this.#active += 1;
      return Promise.resolve(this.#releaseOnce());
    }
    if (this.#queue.length >= this.maxQueue) {
      return Promise.reject(new BackpressureError());
    }
    return new Promise((resolve, reject) => this.#queue.push({ resolve, reject }));
  }

  #releaseOnce() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#queue.shift();
      if (next) {
        next.resolve(this.#releaseOnce());
        return;
      }
      this.#active -= 1;
    };
  }
}

export class FixedWindowRateLimiter {
  #buckets = new Map();

  constructor({ limit, windowMs = 60_000, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  get size() {
    return this.#buckets.size;
  }

  consume(clientId) {
    const now = this.now();
    let bucket = this.#buckets.get(clientId);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.#buckets.set(clientId, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  cleanup() {
    const now = this.now();
    for (const [clientId, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(clientId);
    }
  }

  clear() {
    this.#buckets.clear();
  }
}
