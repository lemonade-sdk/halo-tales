import React, { useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '../agent/omniRouterTools';
import { blobToB64 } from '../util/base64';

interface Props {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

export function TurnInput({ disabled, onSubmit }: Props): React.JSX.Element {
  const [value, setValue] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  // Auto-resize the textarea so it starts at 1 row and grows with content,
  // capped by CSS max-height (which will then show a scrollbar).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  async function startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorder.current = rec;
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, { type: mime || 'audio/webm' });
        await sendForTranscription(blob);
      };
      rec.start();
      setRecording(true);
    } catch (e) {
      console.error(e);
      alert('Could not access the microphone.');
    }
  }

  function stopRecording(): void {
    mediaRecorder.current?.stop();
    mediaRecorder.current = null;
  }

  async function sendForTranscription(blob: Blob): Promise<void> {
    setTranscribing(true);
    try {
      const b64 = await blobToB64(blob);
      const text = await transcribeAudio(b64, blob.type || 'audio/webm');
      setValue((v) => (v ? v + ' ' + text : text));
    } catch (e) {
      console.error(e);
      alert(`Transcription failed: ${String(e)}`);
    } finally {
      setTranscribing(false);
    }
  }

  function submit(): void {
    const text = value.trim();
    if (!text || disabled) return;
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
        disabled={disabled || transcribing}
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
        disabled={disabled || transcribing || !value.trim()}
        onClick={submit}
      >
        Take your turn
      </button>
      <button
        className={recording ? 'recording' : 'ghost'}
        disabled={disabled || transcribing}
        onClick={recording ? stopRecording : startRecording}
      >
        {recording ? 'Stop ●' : transcribing ? 'Transcribing…' : 'Speak'}
      </button>
    </div>
  );
}
