// In-memory sliding-window rate limiter. The web role runs in one process (chapter 9), so
// per-process counters are enough; account lockout lives in the database instead.

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the next attempt is allowed (0 when allowed). */
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();

  readonly limit: number;
  readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  hit(key: string, now = Date.now()): RateLimitResult {
    const since = now - this.windowMs;
    const hits = (this.#hits.get(key) ?? []).filter((t) => t > since);
    if (hits.length >= this.limit) {
      this.#hits.set(key, hits);
      return { allowed: false, retryAfterMs: hits[0]! + this.windowMs - now };
    }
    hits.push(now);
    this.#hits.set(key, hits);
    if (this.#hits.size > 10_000) this.#sweep(since);
    return { allowed: true, retryAfterMs: 0 };
  }

  #sweep(since: number): void {
    for (const [key, hits] of this.#hits) {
      if (hits.every((t) => t <= since)) this.#hits.delete(key);
    }
  }
}
