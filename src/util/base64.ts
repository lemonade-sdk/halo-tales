/**
 * Browser-safe base64 helpers. We can't use `Buffer` (Node-only) and the
 * shiny `Uint8Array.fromBase64` proposal isn't widely shipped yet, so we
 * stay on `atob` / `btoa` with the chunked-string trick to avoid blowing
 * the call stack on large buffers.
 */

export function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * The explicit `Uint8Array<ArrayBuffer>` return type matters: a function that
 * just returned `Uint8Array` would type as `Uint8Array<ArrayBufferLike>` and
 * Blob's BlobPart constructor argument rejects that under strict DOM types.
 */
export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function blobToB64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return bytesToB64(new Uint8Array(buf));
}
