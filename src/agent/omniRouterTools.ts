import { serverFetch } from '../lemonade/client';
import { REQUIRED_MODELS } from '../lemonade/models';

export interface ImageGenResult {
  b64: string;
  mime: 'image/png';
}

export interface AudioResult {
  b64: string;
  mime: string;
}

const IMAGE_SIZE = '1024x1024';

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
  const bin = atob(sourcePngB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  form.append('image', new Blob([bytes], { type: 'image/png' }), 'source.png');
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
  const u8 = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return { b64: btoa(binary), mime: 'audio/mpeg' };
}

export async function transcribeAudio(
  audioB64: string,
  mime: string,
  language?: string,
  signal?: AbortSignal,
): Promise<string> {
  const bin = atob(audioB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes('wav') ? 'wav' : mime.includes('webm') ? 'webm' : 'mp3';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `input.${ext}`);
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
