/**
 * The exact model ids HaloTales depends on, verified against
 * `src/cpp/resources/server_models.json` in the lemonade-sdk repo.
 * If a future Lemonade release renames any of these, update them here.
 */
export const REQUIRED_MODELS = {
  chat: 'Qwen3.6-35B-A3B-MTP-GGUF',
  image: 'Flux-2-Klein-4B',
  tts: 'kokoro-v1',
  stt: 'Whisper-Large-v3-Turbo',
} as const;

export type ModelRole = keyof typeof REQUIRED_MODELS;

export const MODEL_DISPLAY: Record<ModelRole, { name: string; description: string }> = {
  chat: {
    name: 'Storyteller',
    description: 'Qwen 3.6 35B — drives narration, dialogue, and tool decisions.',
  },
  image: {
    name: 'Illustrator',
    description: 'Flux-2 Klein 4B — paints scenes in your story.',
  },
  tts: {
    name: 'Voice actor',
    description: 'Kokoro v1 — speaks your story aloud.',
  },
  stt: {
    name: 'Listener',
    description: 'Whisper Large v3 Turbo — transcribes your spoken turns.',
  },
};
