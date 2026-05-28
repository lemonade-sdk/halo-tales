import { useCallback, useRef, useState } from 'react';

/** Capture microphone audio and emit base64-encoded PCM16 16 kHz mono chunks
 *  suitable for OpenAI Realtime-API style transcription endpoints. Ported
 *  from the Lemonade reference app (`useAudioCapture.ts`). */
export function useAudioCapture(
  onAudioChunk: (base64: string) => void,
  onAudioLevel?: (level: number) => void,
) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Use the system's native sample rate; downsample to 16 kHz in JS so the
      // ScriptProcessorNode buffer math stays simple.
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const nativeRate = audioContext.sampleRate;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        const targetRate = 16000;
        const ratio = nativeRate / targetRate;
        const outputLength = Math.floor(inputData.length / ratio);
        const int16 = new Int16Array(outputLength);
        let sumSquares = 0;

        for (let i = 0; i < outputLength; i++) {
          const srcIdx = i * ratio;
          const srcIdxFloor = Math.floor(srcIdx);
          const srcIdxCeil = Math.min(srcIdxFloor + 1, inputData.length - 1);
          const frac = srcIdx - srcIdxFloor;
          const sample =
            inputData[srcIdxFloor] * (1 - frac) + inputData[srcIdxCeil] * frac;
          sumSquares += sample * sample;
          const s = Math.max(-1, Math.min(1, sample));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        if (onAudioLevel) {
          const rms = Math.sqrt(sumSquares / outputLength);
          const db = rms > 0 ? 20 * Math.log10(rms) : -60;
          const clamped = Math.max(-60, Math.min(-6, db));
          onAudioLevel((clamped - -60) / (-6 - -60));
        }

        onAudioChunk(arrayBufferToBase64(int16.buffer));
      };

      // ScriptProcessorNode requires connection to destination; mute via
      // a zero-gain node so the mic doesn't echo through the speakers.
      source.connect(processor);
      const mute = audioContext.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(audioContext.destination);

      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(msg);
    }
  }, [onAudioChunk, onAudioLevel]);

  const stopRecording = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  return { isRecording, startRecording, stopRecording, error };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
