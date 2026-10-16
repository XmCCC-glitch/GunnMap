import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAfter?: number) { super(message); }
}

export function configuredInteger(name: string, fallback: number, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

export function assertRenderRequest(req: IncomingMessage, publicOrigin?: string): void {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Send map requests as application/json');
  }
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'Map requests must come from this site');
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    // Reverse proxies must supply a configured public origin. Forwarded headers
    // are deliberately ignored: arbitrary clients can forge them.
    const expected = publicOrigin ?? `${'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    if (origin !== expected) throw new HttpError(403, 'Map requests must come from this site');
  }
}

export function normalizePublicOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = new URL(value);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('PUBLIC_ORIGIN must be an http(s) origin without a path or credentials');
  }
  return parsed.origin;
}

export function setSecurityHeaders(res: ServerResponse, hsts: boolean): void {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'",
    "worker-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

/** A bounded fixed-window limiter. Full tables reject new clients instead of
 * evicting active clients, so rotating addresses cannot reset their counters. */
export class RenderRateLimiter {
  private readonly clients = new Map<string, { expires: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxClients: number) {}
  consume(client: string, now = Date.now()): void {
    for (const [key, value] of this.clients) {
      if (value.expires > now) break;
      this.clients.delete(key);
    }
    const current = this.clients.get(client);
    if (current) {
      if (current.count >= this.limit) throw new HttpError(429, 'Too many map requests. Please try again shortly.', Math.max(1, Math.ceil((current.expires - now) / 1000)));
      current.count++;
    } else {
      if (this.clients.size >= this.maxClients) throw new HttpError(503, 'Map generation is busy. Please try again shortly.', Math.max(1, Math.ceil(this.windowMs / 1000)));
      this.clients.set(client, { expires: now + this.windowMs, count: 1 });
    }
  }
}

type WaitingJob = { start: () => void; timer: NodeJS.Timeout; signal?: AbortSignal; abort: () => void };
export class RenderQueue {
  private active = 0;
  private readonly waiting: WaitingJob[] = [];
  constructor(private readonly concurrency: number, private readonly capacity: number, private readonly timeoutMs: number) {}
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new HttpError(503, 'Map request was cancelled'));
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        Promise.resolve().then(task).then(resolve, reject).finally(() => {
          this.active--;
          const next = this.waiting.shift();
          if (next) {
            clearTimeout(next.timer);
            next.signal?.removeEventListener('abort', next.abort);
            next.start();
          }
        });
      };
      if (this.active < this.concurrency) return start();
      if (this.waiting.length >= this.capacity) return reject(new HttpError(503, 'Map generation is busy. Please try again shortly.', 5));
      const remove = (error: Error) => {
        const index = this.waiting.indexOf(job);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        clearTimeout(job.timer);
        signal?.removeEventListener('abort', job.abort);
        reject(error);
      };
      const job: WaitingJob = {
        start, signal,
        abort: () => remove(new HttpError(503, 'Map request was cancelled')),
        timer: setTimeout(() => remove(new HttpError(503, 'Map generation is busy. Please try again shortly.', 5)), this.timeoutMs),
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      this.waiting.push(job);
    });
  }
}
