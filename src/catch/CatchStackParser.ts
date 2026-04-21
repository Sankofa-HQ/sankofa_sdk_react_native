import type { StackFrame, StackTrace } from './CatchTypes';

/**
 * Stack parser tuned for React Native's two JS engines:
 *
 *   - Hermes — frames look like: "    at functionName (address.js:line:col)"
 *              (close to V8 but with "address.js" for anonymous bundles).
 *   - JSC    — frames look like: "functionName@address.js:line:col"
 *              (Safari-style).
 *
 * Node server SDKs hit this same parser via the V8 branch. Fallback:
 * unrecognised lines are skipped so a malformed stack never blocks
 * the event from reaching the server.
 *
 * Output is **oldest-first** (the origin of the throw is LAST),
 * matching the wire contract.
 */

const V8_MATCHER = /^\s*at (?:(.+?)\s+\()?((?:file|https?|metro|webpack|address|blob):[^\s)]+|[^:\s]+)(?::(\d+))?(?::(\d+))?\)?$/;
const SAFARI_MATCHER = /^\s*(?:(.+?)@)?((?:file|https?|metro|webpack|address|blob):[^\s]+|[^@\s]+):(\d+)(?::(\d+))?$/;

const ANONYMOUS_FUNCTIONS = new Set(['', '<anonymous>', 'anonymous', 'global code']);

export function parseStack(stack: string | undefined | null): StackTrace | undefined {
  if (!stack || typeof stack !== 'string') return undefined;

  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let frame: StackFrame | undefined;
    const v8 = V8_MATCHER.exec(line);
    if (v8) frame = toFrame(v8[1], v8[2], v8[3], v8[4]);
    else {
      const sf = SAFARI_MATCHER.exec(line);
      if (sf) frame = toFrame(sf[1], sf[2], sf[3], sf[4]);
    }
    if (frame) frames.push(frame);
  }
  if (frames.length === 0) return undefined;
  frames.reverse();
  markInAppHeuristically(frames);
  return { frames };
}

function toFrame(
  func: string | undefined,
  file: string | undefined,
  lineno: string | undefined,
  colno: string | undefined,
): StackFrame {
  const frame: StackFrame = { platform: 'javascript' };
  if (func && !ANONYMOUS_FUNCTIONS.has(func)) frame.function = func;
  if (file) {
    frame.filename = stripQuery(file);
    frame.abs_path = file;
  }
  if (lineno) {
    const n = Number(lineno);
    if (Number.isFinite(n) && n > 0) frame.lineno = n;
  }
  if (colno) {
    const n = Number(colno);
    if (Number.isFinite(n) && n > 0) frame.colno = n;
  }
  return frame;
}

function stripQuery(p: string): string {
  const q = p.indexOf('?');
  return q < 0 ? p : p.slice(0, q);
}

function markInAppHeuristically(frames: StackFrame[]): void {
  for (const f of frames) {
    if (f.in_app !== undefined) continue;
    const file = f.filename ?? f.abs_path ?? '';
    if (!file) {
      f.in_app = false;
      continue;
    }
    if (
      file.includes('/node_modules/') ||
      file.includes('react-native/Libraries/') ||
      file.startsWith('metro-') ||
      file.startsWith('webpack-internal:') ||
      file.endsWith('.min.js')
    ) {
      f.in_app = false;
    } else {
      f.in_app = true;
    }
  }
}

// ── Error → Exception mapping ──────────────────────────────────────

export function errorToException(
  err: unknown,
  mechanism?: { type: string; handled: boolean; description?: string },
): {
  type: string;
  value: string;
  stacktrace?: StackTrace;
  mechanism?: { type: string; handled: boolean; description?: string };
  chained?: ReturnType<typeof errorToException>[];
} {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; stack?: string; cause?: unknown; errors?: unknown[] };
    const out: ReturnType<typeof errorToException> = {
      type: e.name ?? (err as { constructor?: { name?: string } }).constructor?.name ?? 'Error',
      value: String(e.message ?? ''),
      stacktrace: parseStack(e.stack),
      mechanism,
    };
    if (Array.isArray(e.errors) && e.errors.length > 0) {
      out.chained = e.errors.slice(0, 5).map((x) => errorToException(x));
    }
    if (e.cause !== undefined && e.cause !== null && !out.chained) {
      out.chained = [errorToException(e.cause)];
    }
    return out;
  }
  return {
    type: 'Error',
    value: stringifyNonError(err),
    mechanism,
  };
}

function stringifyNonError(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
