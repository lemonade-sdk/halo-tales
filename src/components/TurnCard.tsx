import React, { useEffect, useRef, useState } from 'react';
import { TimelineEntry } from '../story/types';
import { artifactUrl, repo } from '../story/repository';
import { EditableMarkdown } from './MarkdownView';

interface Props {
  storyId: string;
  entry: TimelineEntry;
  autoPlayAudio?: boolean;
  onEdit?: () => void;
}

export function TurnCard({ storyId, entry, autoPlayAudio, onEdit }: Props): React.JSX.Element {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (entry.image) {
        try {
          const url = await artifactUrl(storyId, entry.image);
          if (!cancelled) setImageUrl(url);
        } catch {}
      } else if (!entry.image) {
        setImageUrl(null);
      }
      if (entry.audio) {
        try {
          const url = await artifactUrl(storyId, entry.audio);
          if (!cancelled) setAudioUrl(url);
        } catch {}
      } else {
        setAudioUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [storyId, entry.image, entry.audio]);

  useEffect(() => {
    if (autoPlayAudio && audioRef.current && audioUrl) {
      audioRef.current.play().catch(() => {/* user gesture may be required */});
    }
  }, [autoPlayAudio, audioUrl]);

  async function save(markdown: string): Promise<void> {
    await repo.writeTimelineEntry(storyId, entry.seq, markdown);
    onEdit?.();
  }

  return (
    <article className={`turn-card role-${entry.role}`} data-seq={entry.seq}>
      {imageUrl && <img src={imageUrl} alt={`Turn ${entry.seq}`} />}
      <div className="body">
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>
          {entry.role === 'user' ? 'You' : 'Storyteller'} · turn {entry.seq}
        </div>
        <EditableMarkdown
          source={entry.markdown}
          onSave={save}
          placeholder="(empty turn — click to add notes)"
          rows={10}
        />
        {audioUrl && (
          <audio ref={audioRef} controls src={audioUrl} preload="auto" />
        )}
      </div>
    </article>
  );
}
