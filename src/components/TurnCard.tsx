import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TimelineEntry } from '../story/types';
import { repo } from '../story/repository';
import { EditableMarkdown } from './MarkdownView';
import { makeLogger } from '../util/logger';

const log = makeLogger('turn');

function mimeForFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  return 'application/octet-stream';
}

async function dataUrlFor(storyId: string, relative: string): Promise<string> {
  const b64 = await invoke<string>('read_artifact_b64', { storyId, relative });
  return `data:${mimeForFilename(relative)};base64,${b64}`;
}

interface Props {
  storyId: string;
  entry: TimelineEntry;
  /** 1-indexed round number for display (opening = 1, first continuation = 2,
   *  …). Falls back to entry.seq if not provided. */
  turnNumber?: number;
  /** Player's move that triggered this scene, rendered as a prefix above
   *  the storyteller prose. Undefined for the opening turn. */
  userPrefix?: string;
  autoPlayAudio?: boolean;
  onEdit?: () => void;
}

export function TurnCard({ storyId, entry, turnNumber, userPrefix, autoPlayAudio, onEdit }: Props): React.JSX.Element {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    log.info('TurnCard mount/update', {
      seq: entry.seq,
      role: entry.role,
      image: entry.image,
      audio: entry.audio,
      markdownChars: entry.markdown.length,
    });
    (async () => {
      if (entry.image) {
        try {
          const url = await dataUrlFor(storyId, entry.image);
          log.info('image data url loaded', { seq: entry.seq, chars: url.length });
          if (!cancelled) setImageUrl(url);
        } catch (e) {
          log.error('image data url load failed', { seq: entry.seq, image: entry.image }, e);
        }
      } else {
        setImageUrl(null);
      }
      if (entry.audio) {
        try {
          const url = await dataUrlFor(storyId, entry.audio);
          log.info('audio data url loaded', { seq: entry.seq, chars: url.length });
          if (!cancelled) setAudioUrl(url);
        } catch (e) {
          log.error('audio data url load failed', { seq: entry.seq, audio: entry.audio }, e);
        }
      } else {
        setAudioUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [storyId, entry.image, entry.audio, entry.seq, entry.role, entry.markdown.length]);

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
      {imageUrl && (
        <img
          src={imageUrl}
          alt={`Turn ${entry.seq}`}
          onError={(e) => {
            const src = (e.currentTarget as HTMLImageElement).src;
            log.error('img onError', { seq: entry.seq, srcPrefix: src.slice(0, 64) });
          }}
          onLoad={() => log.info('img onLoad', { seq: entry.seq })}
        />
      )}
      <div className="body">
        <div className="turn-card-meta">
          {entry.role === 'user' ? 'You' : 'Storyteller'} · turn {turnNumber ?? entry.seq}
        </div>
        {userPrefix && (
          <div className="turn-card-user-prefix">
            <span className="turn-card-user-label">You:</span> {userPrefix}
          </div>
        )}
        <div className="turn-card-prose">
          <EditableMarkdown
            source={entry.markdown}
            onSave={save}
            placeholder="(empty turn — click to add notes)"
            rows={10}
          />
        </div>
        {audioUrl && (
          <audio
            ref={audioRef}
            controls
            src={audioUrl}
            preload="auto"
            onError={(e) => {
              const el = e.currentTarget as HTMLAudioElement;
              log.error('audio onError', {
                seq: entry.seq,
                code: el.error?.code,
                message: el.error?.message,
                networkState: el.networkState,
                readyState: el.readyState,
                srcPrefix: el.src.slice(0, 64),
              });
            }}
            onLoadedData={() => log.info('audio onLoadedData', { seq: entry.seq })}
          />
        )}
      </div>
    </article>
  );
}
