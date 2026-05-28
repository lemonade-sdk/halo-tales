import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { setEndpoint, jsonFetch } from './client';
import {
  OMNI_MODELS,
  OmniModelTier,
  computeTotalVramGB,
  getOmniModel,
  pickTier,
  setOmniModel,
} from './models';
import {
  DownloadProgress,
  LemonadeEndpoint,
  LifecycleStage,
  LifecycleState,
  ProgressDetails,
} from './types';
import { makeLogger } from '../util/logger';

const log = makeLogger('lifecycle');

const DEFAULT_BASE = 'http://127.0.0.1:13305';

type Listener = (state: LifecycleState) => void;

interface ModelsResponse {
  data: Array<{ id: string; labels?: string[]; installed?: boolean; downloaded?: boolean; size?: number }>;
}

interface HealthResponse {
  all_models_loaded?: Array<{ model_name?: string }>;
}

interface PullProgressTracker {
  lastDownloaded?: number;
  lastAt?: number;
  rate?: number;
  windowBytes: number;
  windowStartedAt?: number;
  rateSamples: number[];
}

class LifecycleController {
  private state: LifecycleState = { stage: 'probing' };
  private listeners: Set<Listener> = new Set();
  private starting: Promise<void> | null = null;
  private modelSizes: Map<string, number> = new Map();

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
    log.info('stage ->', stage, message ?? '');
    this.update({ stage, message, progress: undefined, progressDetails: undefined });
  }

  async start(): Promise<void> {
    if (this.starting && this.state.stage !== 'error') return this.starting;
    // Fresh run: clear any cached endpoint/error from a prior attempt so
    // listeners see the new probing→ready trajectory cleanly.
    this.state = { stage: 'probing' };
    this.starting = this.run().catch((e) => {
      log.error('failed:', e);
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
            progressDetails: {
              downloaded: p.bytes,
              total: p.total || undefined,
              rate: p.bytes_per_second,
            },
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

      this.setStage('checking_models', 'Choosing the right omni model…');
      await this.pickOmniModelByMemory();
      await this.ensureModels();

      this.setStage('ready', 'Ready');
    } finally {
      if (unlisten) unlisten();
    }
  }

  /** Probe Lemonade's `/api/v1/system-info` for usable GPU VRAM and pick the
   *  appropriate omni model tier. Defaults to the lite tier if the response
   *  is missing or malformed — running a too-small model on a giant box is
   *  graceful; running a too-large model on a small box is not. */
  private async pickOmniModelByMemory(): Promise<void> {
    let tier: OmniModelTier = 'lite';
    let vramGB = 0;
    try {
      const info = await jsonFetchWithTimeout<Record<string, unknown>>(
        '/api/v1/system-info',
        8000,
      );
      vramGB = computeTotalVramGB(info);
      tier = pickTier(vramGB);
    } catch (e) {
      log.warn('could not read system-info; falling back to lite omni model:', e);
    }
    setOmniModel(tier);
    log.info('omni model tier =', tier, 'model =', OMNI_MODELS[tier], 'vramGB =', vramGB);
    this.update({
      omniTier: tier,
      omniModel: OMNI_MODELS[tier],
      vramGB: vramGB || undefined,
    });
  }

  private async ensureModels(): Promise<void> {
    const required = [getOmniModel()];
    const installed = await this.fetchInstalledModels();
    const missing = required.filter((id) => !installed.has(id));
    log.info('required omni model:', required[0], 'missing:', missing);
    for (const id of missing) {
      this.update({
        stage: 'pulling_model',
        pulling: id,
        message: `Downloading omni model ${id}…`,
        progress: undefined,
        progressDetails: undefined,
      });
      await this.pullModel(id);
    }
  }

  private async fetchInstalledModels(): Promise<Set<string>> {
    const ids = await this.fetchLoadedModels();
    try {
      const resp = await jsonFetchWithTimeout<ModelsResponse>('/api/v1/models?show_all=true', 8000);
      this.modelSizes = new Map();
      for (const m of resp.data ?? []) {
        if (typeof m.size === 'number' && Number.isFinite(m.size)) {
          this.modelSizes.set(m.id, Math.round(m.size * 1024 * 1024 * 1024));
        }
        // The catalog exposes installed=true only after a successful pull;
        // entries without the flag are "installable but not installed yet".
        if (m.installed || m.downloaded) ids.add(m.id);
      }
      return ids;
    } catch (e) {
      log.warn('could not list models, using loaded-model fallback:', e);
      return ids;
    }
  }

  private async fetchLoadedModels(): Promise<Set<string>> {
    try {
      const resp = await jsonFetchWithTimeout<HealthResponse>('/api/v1/health', 3000);
      const ids = new Set<string>();
      for (const model of resp.all_models_loaded ?? []) {
        if (model.model_name) ids.add(model.model_name);
      }
      return ids;
    } catch (e) {
      log.warn('could not read loaded models:', e);
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
    const declaredTotal = this.modelSizes.get(modelId);
    const tracker: PullProgressTracker = { windowBytes: 0, rateSamples: [] };
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
          const details = extractProgressDetails(obj, declaredTotal, tracker);
          const pct = progressPercent(obj, details);
          this.update({
            stage: 'pulling_model',
            pulling: modelId,
            progress: pct,
            progressDetails: details,
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
    progressDetailsEqual(a.progressDetails, b.progressDetails) &&
    a.pulling === b.pulling &&
    a.error === b.error &&
    a.endpoint === b.endpoint &&
    a.omniTier === b.omniTier &&
    a.omniModel === b.omniModel &&
    a.vramGB === b.vramGB
  );
}

export const lifecycle = new LifecycleController();

async function jsonFetchWithTimeout<T>(path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await jsonFetch<T>(path, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function progressPercent(obj: unknown, details: ProgressDetails): number | undefined {
  const record = asRecord(obj);
  const rawProgress = numberFrom(record, ['progress']);
  if (typeof rawProgress === 'number') {
    return Math.floor(rawProgress <= 1 ? rawProgress * 100 : rawProgress);
  }
  const rawPercent = numberFrom(record, ['percent', 'percentage']);
  if (typeof rawPercent === 'number') return Math.floor(rawPercent);
  if (typeof details.downloaded === 'number' && typeof details.total === 'number' && details.total > 0) {
    return Math.floor((details.downloaded / details.total) * 100);
  }
  return undefined;
}

function extractProgressDetails(
  obj: unknown,
  declaredTotal: number | undefined,
  tracker: PullProgressTracker,
): ProgressDetails {
  const record = asRecord(obj);
  const currentFileDownloaded = numberFrom(record, [
    'downloaded',
    'downloaded_bytes',
    'completed',
    'completed_bytes',
    'current',
    'current_bytes',
    'bytes',
    'bytes_downloaded',
  ]);
  const completedFiles = numberFrom(record, ['completed_files_bytes']);
  const downloaded = numberFrom(record, [
    'cumulative_bytes_downloaded',
    'overall_bytes_downloaded',
  ]) ?? (
    typeof completedFiles === 'number' && typeof currentFileDownloaded === 'number'
      ? completedFiles + currentFileDownloaded
      : currentFileDownloaded
  );
  const total = numberFrom(record, ['total_download_size']) ??
    declaredTotal ??
    numberFrom(record, [
      'total',
      'total_bytes',
      'size',
      'size_bytes',
      'bytes_total',
      'file_size',
      'file_size_bytes',
  ]);
  const serverRate = numberFrom(record, [
    'rate',
    'download_rate',
    'bytes_per_second',
    'speed',
    'speed_bytes_per_second',
  ]);
  const rate = serverRate ?? calculateRate(downloaded, tracker);
  return { downloaded, total, rate };
}

function numberFrom(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function progressDetailsEqual(a?: ProgressDetails, b?: ProgressDetails): boolean {
  return a?.downloaded === b?.downloaded && a?.total === b?.total && a?.rate === b?.rate;
}

function calculateRate(downloaded: number | undefined, tracker: PullProgressTracker): number | undefined {
  if (typeof downloaded !== 'number') return undefined;
  const now = Date.now();
  if (typeof tracker.lastDownloaded !== 'number' || typeof tracker.lastAt !== 'number') {
    tracker.lastDownloaded = downloaded;
    tracker.lastAt = now;
    tracker.windowStartedAt = now;
    tracker.windowBytes = 0;
    tracker.rate = undefined;
    return undefined;
  }

  const previousDownloaded = tracker.lastDownloaded;
  const elapsedSinceLast = (now - tracker.lastAt) / 1000;
  const deltaBytes = downloaded - previousDownloaded;
  tracker.lastDownloaded = downloaded;
  tracker.lastAt = now;

  if (previousDownloaded === 0 && downloaded > 0 && tracker.rateSamples.length === 0) {
    tracker.windowStartedAt = now;
    tracker.windowBytes = 0;
    return undefined;
  }

  if (elapsedSinceLast <= 0 || deltaBytes < 0) return tracker.rate;
  tracker.windowBytes += deltaBytes;

  const windowStartedAt = tracker.windowStartedAt ?? now;
  const windowSeconds = (now - windowStartedAt) / 1000;
  if (windowSeconds < 2) return tracker.rate;

  const sample = tracker.windowBytes / windowSeconds;
  tracker.rateSamples.push(sample);
  if (tracker.rateSamples.length > 5) {
    tracker.rateSamples.shift();
  }
  tracker.rate = tracker.rateSamples.reduce((sum, value) => sum + value, 0) / tracker.rateSamples.length;
  tracker.windowStartedAt = now;
  tracker.windowBytes = 0;
  return tracker.rate;
}
