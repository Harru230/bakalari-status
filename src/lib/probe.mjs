export const DEFAULT_TARGET_URL = 'https://bakalari.oegp.cz/login';
export const DEFAULT_TIMEOUT_MS = 12_000;

const TIMEOUT_CODES = new Set([
  23, // DOMException.TIMEOUT_ERR
  20, // DOMException.ABORT_ERR
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function isTimeoutError(err, seen = new Set()) {
  if (!err || typeof err !== 'object' || seen.has(err)) {
    return false;
  }
  seen.add(err);
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return true;
  }
  if (TIMEOUT_CODES.has(err.code)) {
    return true;
  }
  if (err.cause && isTimeoutError(err.cause, seen)) {
    return true;
  }
  if (Array.isArray(err.errors) && err.errors.some((item) => isTimeoutError(item, seen))) {
    return true;
  }
  return false;
}

function getIsoTimestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('now() must return a valid Date');
  }
  return date.toISOString();
}

export async function checkLoginEndpoint(url = DEFAULT_TARGET_URL, options = {}) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new TypeError('url must be a non-empty string');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }

  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    now = () => new Date(),
  } = options;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }

  const startedAt = performance.now();

  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'cache-control': 'no-cache',
        'user-agent': 'bakalari-status-probe/1.0',
      },
    });

    try {
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const httpStatus =
        Number.isInteger(res?.status) && res.status >= 100 && res.status <= 599
          ? res.status
          : null;
      // Only HTTP 200 on the login page itself counts as online (201/204/3xx are offline).
      const ok = httpStatus === 200;

      return {
        timestamp: getIsoTimestamp(now),
        status: ok ? 'online' : 'offline',
        ok,
        httpStatus,
        latencyMs,
        reason: ok ? 'ok' : 'non_200',
      };
    } finally {
      await res?.body?.cancel?.().catch(() => {});
    }
  } catch (err) {
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    // Map errors strictly to sanitized enum reasons so IPs, CNAMEs, and paths never leak.
    const reason = isTimeoutError(err) ? 'timeout' : 'network_error';

    return {
      timestamp: getIsoTimestamp(now),
      status: 'offline',
      ok: false,
      httpStatus: null,
      latencyMs,
      reason,
    };
  }
}
