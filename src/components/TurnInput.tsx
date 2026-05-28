import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioCapture } from '../util/audioCapture';
import { TranscriptionSocket } from '../lemonade/transcriptionSocket';
import { getOmniComponent } from '../lemonade/models';
import { makeLogger } from '../util/logger';

const log = makeLogger('mic');

interface Props {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

export function TurnInput({ disabled, onSubmit }: Props): React.JSX.Element {
  const [value, setValue] = useState('');
  const [recording, setRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Streaming transcription state — same pattern as the Lemonade reference:
  // finals accumulate, interim deltas replace the latest interim block,
  // baseText is the textarea contents before recording started so we don't
  // overwrite anything the user already typed.
  const wsRef = useRef<TranscriptionSocket | null>(null);
  const wsToCloseRef = useRef<TranscriptionSocket | null>(null);
  const isRecordingRef = useRef(false);
  const finalsRef = useRef('');
  const baseTextRef = useRef('');

  // Auto-resize the textarea so it starts at 1 row and grows with content,
  // capped by CSS max-height (which will then show a scrollbar).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const handleAudioChunk = useCallback((base64: string) => {
    wsRef.current?.sendAudio(base64);
  }, []);

  const { startRecording, stopRecording, error: micError } =
    useAudioCapture(handleAudioChunk);

  useEffect(() => {
    if (micError) {
      log.error('audio capture error', micError);
      alert(`Microphone error: ${micError}`);
    }
  }, [micError]);

  // Tear down WS/audio on unmount.
  useEffect(() => {
    return () => {
      if (isRecordingRef.current) stopRecording();
      wsRef.current?.close();
      wsToCloseRef.current?.close();
    };
    // stopRecording is stable; we only need this on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeCommittedWs = useCallback(() => {
    if (wsToCloseRef.current) {
      wsToCloseRef.current.close();
      wsToCloseRef.current = null;
    }
  }, []);

  const handleTranscription = useCallback(
    (text: string, isFinal: boolean) => {
      // Drop interim deltas that arrive after stop.
      if (!isFinal && !isRecordingRef.current) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      let liveText: string;
      if (isFinal) {
        const next = finalsRef.current ? `${finalsRef.current} ${trimmed}` : trimmed;
        finalsRef.current = next;
        liveText = next;
      } else {
        liveText = finalsRef.current ? `${finalsRef.current} ${trimmed}` : trimmed;
      }

      const base = baseTextRef.current;
      const separator = base && !base.endsWith(' ') ? ' ' : '';
      setValue(base + separator + liveText);

      // After manual stop, once the server has flushed the final, tear down
      // the WS.
      if (isFinal && !isRecordingRef.current && wsToCloseRef.current) {
        closeCommittedWs();
      }
    },
    [closeCommittedWs],
  );

  async function startStreaming(): Promise<void> {
    const model = getOmniComponent('stt');
    log.info('startStreaming', {
      model,
      isSecureContext: window.isSecureContext,
      origin: window.location.origin,
      protocol: window.location.protocol,
    });
    baseTextRef.current = value;
    finalsRef.current = '';

    // Stage 1: open the transcription WebSocket.
    try {
      log.info('ws: connecting');
      wsRef.current = await TranscriptionSocket.connect(model, {
        onTranscription: handleTranscription,
        onConnected: () => log.info('ws: connected'),
        onDisconnected: () => log.info('ws: disconnected'),
        onError: (msg) => {
          log.error('ws: error', msg);
        },
      });
      log.info('ws: open');
    } catch (e) {
      const err = e as { name?: string; message?: string };
      log.error('ws: connect failed', { name: err?.name, message: err?.message });
      alert(
        `Could not connect transcription socket: ${err?.name ?? 'Error'} — ${
          err?.message ?? String(e)
        }`,
      );
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    // Give the server a moment to apply session.update before audio starts.
    await new Promise((r) => setTimeout(r, 500));

    // Stage 2: start capturing PCM from the microphone.
    try {
      log.info('audio: startRecording');
      await startRecording();
      log.info('audio: capturing');
      isRecordingRef.current = true;
      setRecording(true);
    } catch (e) {
      const err = e as { name?: string; message?: string };
      log.error('audio: startRecording failed', { name: err?.name, message: err?.message });
      alert(
        `Could not start audio capture: ${err?.name ?? 'Error'} — ${
          err?.message ?? String(e)
        }`,
      );
      wsRef.current?.close();
      wsRef.current = null;
    }
  }

  function stopStreaming(): void {
    stopRecording();
    isRecordingRef.current = false;
    // Commit any buffered audio so the server emits a final transcript for
    // the trailing speech; the socket gets closed once that final arrives.
    if (wsRef.current) {
      wsRef.current.commitAudio();
      wsToCloseRef.current = wsRef.current;
      wsRef.current = null;
    }
    setRecording(false);
  }

  /** Abort transcription immediately — used when the player submits while
   *  still talking. Closes the WS without waiting for a final, and resets
   *  the base/finals refs so any in-flight delta that arrives after this
   *  can't restore the textarea contents we just cleared. */
  function abortTranscription(): void {
    if (isRecordingRef.current) stopRecording();
    isRecordingRef.current = false;
    wsRef.current?.close();
    wsRef.current = null;
    wsToCloseRef.current?.close();
    wsToCloseRef.current = null;
    finalsRef.current = '';
    baseTextRef.current = '';
    setRecording(false);
  }

  function submit(): void {
    const text = value.trim();
    if (!text || disabled) return;
    // If the user is still talking when they hit submit, kill the mic and
    // the socket so no late transcript clobbers the now-empty textarea.
    if (isRecordingRef.current || wsRef.current || wsToCloseRef.current) {
      abortTranscription();
    }
    setValue('');
    onSubmit(text);
  }

  return (
    <div className="turn-input">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        placeholder={disabled ? 'The storyteller is writing…' : 'Your move…'}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        className="primary"
        disabled={disabled || !value.trim()}
        onClick={submit}
      >
        Take your turn
      </button>
      <button
        className={recording ? 'recording' : 'ghost'}
        disabled={disabled}
        onClick={recording ? stopStreaming : startStreaming}
      >
        {recording ? 'Stop ●' : 'Speak'}
      </button>
    </div>
  );
}
