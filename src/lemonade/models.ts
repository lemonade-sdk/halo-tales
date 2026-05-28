/**
 * Lemonade Omni Model selection.
 *
 * One omni model handles chat / image / TTS / STT — the same `model` name is
 * sent in every API request body and Lemonade's OmniRouter (the underlying
 * implementation behind "Lemonade Omni Models") routes it to the right
 * backend.
 *
 * Which model gets used depends on usable GPU VRAM (summed across AMD iGPU
 * and NVIDIA discrete cards reported by `/api/v1/system-info`):
 * - 64 GB and up   → `LMX-Omni-52B-Halo`
 * - anything less  → `LMX-Omni-5.5B-Lite`
 *
 * The lifecycle controller calls `setOmniModel(...)` once after probing
 * `/api/v1/system-info`; everything else reads the choice via
 * `getOmniModel()`.
 */

export const OMNI_MODELS = {
  large: 'LMX-Omni-52B-Halo',
  lite: 'LMX-Omni-5.5B-Lite',
} as const;

export type OmniModelTier = keyof typeof OMNI_MODELS;
export type OmniModelId = (typeof OMNI_MODELS)[OmniModelTier];

export type OmniRole = 'chat' | 'image' | 'tts' | 'stt';

/** Component model ids inside each omni collection.
 *
 *  Workaround: in current Lemonade builds, POSTing chat/completions /
 *  images/generations / audio/speech / audio/transcriptions with the
 *  collection name (e.g. "LMX-Omni-52B-Halo") fails with
 *  `Failed to load model: type must be string, but is null` because the
 *  collection.omni recipe has empty `checkpoint` fields. Until that's fixed
 *  server-side, route each endpoint to the component model directly. The
 *  collection name still drives tier selection and the user-visible label. */
export const OMNI_COMPONENTS: Record<OmniModelTier, Record<OmniRole, string>> = {
  large: {
    chat: 'Qwen3.6-35B-A3B-MTP-GGUF',
    image: 'Flux-2-Klein-9B-GGUF',
    tts: 'kokoro-v1',
    stt: 'Whisper-Large-v3-Turbo',
  },
  lite: {
    chat: 'Qwen3.5-4B-MTP-GGUF',
    image: 'SD-Turbo',
    tts: 'kokoro-v1',
    stt: 'Whisper-Tiny',
  },
};

/** Display info for the status bar / setup screen. */
export const OMNI_MODEL_DISPLAY: Record<OmniModelTier, { name: string; tagline: string }> = {
  large: {
    name: 'LMX Omni 52B Halo',
    tagline: 'Large omni model — runs on systems with ≥64 GB GPU VRAM.',
  },
  lite: {
    name: 'LMX Omni 5.5B Lite',
    tagline: 'Lite omni model — runs on smaller systems.',
  },
};

let currentTier: OmniModelTier | null = null;

export function setOmniModel(tier: OmniModelTier): void {
  currentTier = tier;
}

export function getOmniTier(): OmniModelTier | null {
  return currentTier;
}

/** Collection model id (the name used for the /load call and shown to the
 *  user). Inference endpoints want the component name instead — see
 *  `getOmniComponent`. */
export function getOmniModel(): OmniModelId {
  return currentTier ? OMNI_MODELS[currentTier] : OMNI_MODELS.lite;
}

/** Component model id to send in the request body for a specific endpoint
 *  (chat / image / tts / stt). Lemonade's inference endpoints don't resolve
 *  collection names; they want the concrete component. The collection name
 *  is still useful for `/api/v1/load` (which loads every component in one
 *  call) and for the user-facing label. */
export function getOmniComponent(role: OmniRole): string {
  const tier = currentTier ?? 'lite';
  return OMNI_COMPONENTS[tier][role];
}

/** Minimum GPU VRAM to run the large omni model. */
export const LARGE_MODEL_MIN_VRAM_GB = 64;

export function pickTier(vramGB: number): OmniModelTier {
  return vramGB >= LARGE_MODEL_MIN_VRAM_GB ? 'large' : 'lite';
}

/** Total usable GPU VRAM reported by `/api/v1/system-info`, summed across
 *  every available GPU.
 *
 *  Cross-platform shapes:
 *  - Windows/Linux NVIDIA discrete: `devices.nvidia_gpu` is an array of cards.
 *  - Linux AMD iGPU / dGPU:         `devices.amd_gpu`    is an array of cards.
 *  - macOS Apple Silicon / AMD:     `devices.metal`      is a SINGLE object
 *    (not an array). VRAM there is `recommendedMaxWorkingSetSize` from
 *    Metal — on unified memory, this is the working-set fraction of total
 *    system RAM (e.g. ~96 GB on a 128 GB M3 Max, ~12 GB on a 16 GB M2). The
 *    same `>= LARGE_MODEL_MIN_VRAM_GB` threshold still picks the right
 *    tier on Mac.
 */
function gpuVram(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const g = value as { available?: unknown; vram_gb?: unknown };
  if (!g.available || typeof g.vram_gb !== 'number') return 0;
  return g.vram_gb;
}

export function computeTotalVramGB(info: Record<string, unknown>): number {
  const devices = info.devices as Record<string, unknown> | undefined;
  if (!devices) return 0;
  let vram = 0;
  for (const key of ['amd_gpu', 'nvidia_gpu']) {
    const list = devices[key];
    if (Array.isArray(list)) {
      for (const gpu of list) vram += gpuVram(gpu);
    }
  }
  // macOS reports a single Metal device as an object, not an array.
  vram += gpuVram(devices['metal']);
  return vram;
}
