import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { setEndpoint, jsonFetch } from './client';
import { REQUIRED_MODELS } from './models';
import {
  DownloadProgress,
  LemonadeEndpoint,
  LifecycleStage,
  LifecycleState,
} from './types';

const DEFAULT_BASE = 'http://127.0.0.1:13305';

type Listener = (state: LifecycleState) => void;

interface ModelsResponse {
  data: Array<{ id: string; labels?: string[]; installed?: boolean }>;
}

class LifecycleController {
  private state: LifecycleState = { stage: 'probing' };
  private listeners: Set<Listener> = new Set();
  private starting: Promise<void> | null = null;

  getState(): LifecycleState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private update(patch: Partial<LifecycleState>): void {
    const next = { ...this.state, ...patch };
    if (statesEqual(this.state, next)) return;
    this.state = next;
    for (const l of this.listeners) {
      try {
        l(this.state);
      } catch (e) {
        console.error(e);
      }
    }
  }

  setStage(stage: LifecycleStage, message?: string): void {
    this.update({ stage, message, progress: undefined });
  }

  async start(): Promise<void> {
    if (this.starting && this.state.stage !== 'error') return this.starting;
    // Fresh run: clear any cached endpoint/error from a prior attempt so
    // listeners see the new probing→ready trajectory cleanly.
    this.state = { stage: 'probing' };
    this.starting = this.run().catch((e) => {
      console.error('[lifecycle] failed:', e);
      this.update({ stage: 'error', error: String(e?.message ?? e) });
    });
    return this.starting;
  }

  private async run(): Promise<void> {
    let unlisten: UnlistenFn | null = null;
    try {
      this.setStage('probing', 'Looking for a running Lemonade…');
      let endpoint = await invoke<LemonadeEndpoint | null>('probe_lemonade', {
        baseUrl: DEFAULT_BASE,
        apiKey: null,
      });

      if (!endpoint) {
        this.setStage('downloading_lemonade', 'Downloading a private copy of Lemonade…');
        unlisten = await listen<DownloadProgress>('lemonade://progress', (event) => {
          const p = event.payload;
          const pct = p.total > 0 ? Math.floor((p.bytes / p.total) * 100) : undefined;
          this.update({
            stage: 'downloading_lemonade',
            progress: pct,
            message: p.message,
          });
        });
        await invoke('ensure_embedded_lemonade');
        if (unlisten) {
          unlisten();
          unlisten = null;
        }

        this.setStage('starting_lemonade', 'Starting Lemonade…');
        endpoint = await invoke<LemonadeEndpoint>('start_embedded_lemonade');
      }

      setEndpoint(endpoint);
      this.update({ endpoint });

      this.setStage('checking_models', 'Checking required models…');
      await this.ensureModels();

      this.setStage('ready', 'Ready');
    } finally {
      if (unlisten) unlisten();
    }
  }

  private async ensureModels(): Promise<void> {
    const required = Object.values(REQUIRED_MODELS);
    const installed = await this.fetchInstalledModels();
    const missing = required.filter((id) => !installed.has(id));
    for (const id of missing) {
      this.update({
        stage: 'pulling_model',
        pulling: id,
        message: `Downloading model ${id}…`,
        progress: undefined,
      });
      await this.pullModel(id);
    }
  }

  private async fetchInstalledModels(): Promise<Set<string>> {
    try {
      const resp = await jsonFetch<ModelsResponse>('/api/v1/models?show_all=true');
      const ids = new Set<string>();
      for (const m of resp.data ?? []) {
        // The catalog exposes installed=true only after a successful pull;
        // entries without the flag are "installable but not installed yet".
        if (m.installed) ids.add(m.id);
      }
      return ids;
    } catch (e) {
      console.warn('[lifecycle] could not list models, assuming none installed:', e);
      return new Set();
    }
  }

  private async pullModel(modelId: string): Promise<void> {
    // POST /api/v1/pull with stream=true returns an SSE-ish event stream.
    const { getBaseUrl, getEndpoint } = await import('./client');
    const url = `${getBaseUrl()}/api/v1/pull`;
    const apiKey = getEndpoint()?.api_key;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model_name: modelId, stream: true }),
    });
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`pull ${modelId} failed: HTTP ${resp.status} ${text}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Parse simple JSONL or SSE-style frames.
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        try {
          const obj = JSON.parse(payload);
          const pct = typeof obj?.progress === 'number'
            ? Math.floor(obj.progress * 100)
            : typeof obj?.percent === 'number'
              ? Math.floor(obj.percent)
              : undefined;
          this.update({
            stage: 'pulling_model',
            pulling: modelId,
            progress: pct,
            message: obj?.message ?? `Downloading ${modelId}…`,
          });
        } catch {
          /* ignore non-JSON keepalive lines */
        }
      }
    }
  }
}

function statesEqual(a: LifecycleState, b: LifecycleState): boolean {
  return (
    a.stage === b.stage &&
    a.message === b.message &&
    a.progress === b.progress &&
    a.pulling === b.pulling &&
    a.error === b.error &&
    a.endpoint === b.endpoint
  );
}

export const lifecycle = new LifecycleController();
