import { serverFetch } from './client';
import { getOmniModel } from './models';

const STORYTELLER_CTX_SIZE = 8192;

let storytellerWarmup: Promise<void> | null = null;

export function warmStoryteller(): Promise<void> {
  if (!storytellerWarmup) {
    storytellerWarmup = loadModel(getOmniModel()).catch((error) => {
      storytellerWarmup = null;
      throw error;
    });
  }
  return storytellerWarmup;
}

async function loadModel(modelName: string): Promise<void> {
  const resp = await serverFetch('/api/v1/load', {
    method: 'POST',
    body: {
      model_name: modelName,
      ctx_size: STORYTELLER_CTX_SIZE,
    },
  });
  if (resp.ok) return;

  const text = await resp.text().catch(() => '');
  if (resp.status !== 400 && resp.status !== 422) {
    throw new Error(`load ${modelName} failed: HTTP ${resp.status} ${text}`);
  }

  console.warn('[warmup] ctx_size load option rejected; retrying without it:', text);
  const fallback = await serverFetch('/api/v1/load', {
    method: 'POST',
    body: { model_name: modelName },
  });
  if (!fallback.ok) {
    const fallbackText = await fallback.text().catch(() => '');
    throw new Error(`load ${modelName} failed: HTTP ${fallback.status} ${fallbackText}`);
  }
}
