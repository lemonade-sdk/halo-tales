import { invoke } from '@tauri-apps/api/core';

type Level = 'debug' | 'info' | 'warn' | 'error';

function send(level: Level, scope: string, parts: unknown[]): void {
  const message = parts
    .map((p) => {
      if (p instanceof Error) return p.stack ?? p.message;
      if (typeof p === 'string') return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(' ');
  // Mirror to devtools so the in-browser console still works.
  const c = console as unknown as Record<Level, (...a: unknown[]) => void>;
  (c[level] ?? console.log).call(console, `[${scope}]`, ...parts);
  // Best-effort bridge to the Rust-side log file. If invoke isn't ready yet
  // (very early bootstrap, or running outside Tauri), swallow the error so we
  // never break the renderer just because logging is unavailable.
  invoke('log_event', { level, scope, message }).catch(() => {
    /* ignore */
  });
}

export function makeLogger(scope: string) {
  return {
    debug: (...a: unknown[]) => send('debug', scope, a),
    info: (...a: unknown[]) => send('info', scope, a),
    warn: (...a: unknown[]) => send('warn', scope, a),
    error: (...a: unknown[]) => send('error', scope, a),
  };
}

export const log = makeLogger('app');

/** Wire up window-level error capture so uncaught exceptions and rejected
 *  promises land in the unified log file too. Idempotent. */
let installed = false;
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    send('error', 'window', [
      `uncaught error: ${e.message}`,
      e.filename ? `(${e.filename}:${e.lineno}:${e.colno})` : '',
      e.error,
    ]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    send('error', 'window', ['unhandled rejection:', e.reason]);
  });
}
