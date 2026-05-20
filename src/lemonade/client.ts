import { LemonadeEndpoint } from './types';

let currentEndpoint: LemonadeEndpoint | null = null;

export function setEndpoint(endpoint: LemonadeEndpoint | null): void {
  currentEndpoint = endpoint;
}

export function getEndpoint(): LemonadeEndpoint | null {
  return currentEndpoint;
}

export function getBaseUrl(): string {
  if (!currentEndpoint) {
    throw new Error('Lemonade endpoint not configured yet');
  }
  return currentEndpoint.base_url.replace(/\/+$/, '');
}

function buildHeaders(init?: HeadersInit, contentType?: string): Headers {
  const headers = new Headers(init);
  if (contentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', contentType);
  }
  if (currentEndpoint?.api_key && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${currentEndpoint.api_key}`);
  }
  return headers;
}

export interface FetchOptions {
  method?: string;
  body?: BodyInit | Record<string, unknown>;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export async function serverFetch(
  path: string,
  opts: FetchOptions = {},
): Promise<Response> {
  const base = getBaseUrl();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  let body = opts.body;
  let contentType: string | undefined;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)
      && !(body instanceof ArrayBuffer) && !(body instanceof URLSearchParams)) {
    body = JSON.stringify(body);
    contentType = 'application/json';
  }
  const headers = buildHeaders(opts.headers, contentType);
  return fetch(url, { method: opts.method || (body ? 'POST' : 'GET'), body: body as BodyInit, headers, signal: opts.signal });
}

export async function jsonFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const resp = await serverFetch(path, opts);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} from ${path}: ${text}`);
  }
  return (await resp.json()) as T;
}
