import { serverFetch } from '../lemonade/client';
import { REQUIRED_MODELS } from '../lemonade/models';
import { b64ToBytes, bytesToB64 } from '../util/base64';

export interface ImageGenResult {
  b64: string;
  mime: 'image/png';
}

export interface AudioResult {
  b64: string;
  mime: string;
}

// 2:1 widescreen so the rendered scene fits next to a readable prose column
// without dominating the card height.
const IMAGE_SIZE = '512x256';

export async function generateImage(prompt: string, signal?: AbortSignal): Promise<ImageGenResult> {
  const resp = await serverFetch('/api/v1/images/generations', {
    method: 'POST',
    body: {
      model: REQUIRED_MODELS.image,
      prompt,
      response_format: 'b64_json',
      n: 1,
      size: IMAGE_SIZE,
    },
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`generate_image failed: HTTP ${resp.status} ${text}`);
  }
  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('generate_image: no image returned');
  return { b64, mime: 'image/png' };
}

export async function editImage(
  prompt: string,
  sourcePngB64: string,
  signal?: AbortSignal,
): Promise<ImageGenResult> {
  const form = new FormData();
  form.append('model', REQUIRED_MODELS.image);
  form.append('prompt', prompt);
  form.append('response_format', 'b64_json');
  form.append('n', '1');
  form.append('size', IMAGE_SIZE);
  form.append(
    'image',
    new Blob([b64ToBytes(sourcePngB64)], { type: 'image/png' }),
    'source.png',
  );
  const resp = await serverFetch('/api/v1/images/edits', {
    method: 'POST',
    body: form,
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`edit_image failed: HTTP ${resp.status} ${text}`);
  }
  const data = await resp.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('edit_image: no image returned');
  return { b64, mime: 'image/png' };
}

export async function textToSpeech(
  input: string,
  voice: string = 'af_heart',
  signal?: AbortSignal,
): Promise<AudioResult> {
  const resp = await serverFetch('/api/v1/audio/speech', {
    method: 'POST',
    body: {
      model: REQUIRED_MODELS.tts,
      input,
      voice,
      response_format: 'mp3',
    },
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`text_to_speech failed: HTTP ${resp.status} ${text}`);
  }
  const buf = await resp.arrayBuffer();
  return { b64: bytesToB64(new Uint8Array(buf)), mime: 'audio/mpeg' };
}

export async function transcribeAudio(
  audioB64: string,
  mime: string,
  language?: string,
  signal?: AbortSignal,
): Promise<string> {
  const ext = mime.includes('wav') ? 'wav' : mime.includes('webm') ? 'webm' : 'mp3';
  const form = new FormData();
  form.append('file', new Blob([b64ToBytes(audioB64)], { type: mime }), `input.${ext}`);
  form.append('model', REQUIRED_MODELS.stt);
  if (language) form.append('language', language);
  const resp = await serverFetch('/api/v1/audio/transcriptions', {
    method: 'POST',
    body: form,
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`transcribe_audio failed: HTTP ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return data?.text ?? '';
}
