import React, { useEffect, useRef, useState } from 'react';
import { makeLogger } from '../util/logger';

const log = makeLogger('audio');

interface Props {
  src: string;
  /** Play automatically once the audio is ready. */
  autoPlay?: boolean;
  onError?: (event: React.SyntheticEvent<HTMLAudioElement>) => void;
  onLoadedData?: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Minimal audio player to replace `<audio controls>`.
 *
 *  Tauri 2 on Linux uses WebKitGTK, whose native HTML5 media-controls
 *  stylesheet renders each control button with an orange underline when the
 *  window is in client-side-decorations mode (i.e. `decorations: false`).
 *  Those underlines live inside the audio element's shadow DOM and can't be
 *  styled from document CSS — so we drive a plain `<audio>` programmatically
 *  and render our own controls instead. */
export function AudioPlayer({
  src,
  autoPlay,
  onError,
  onLoadedData,
}: Props): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  // Auto-play on src change. The browser may refuse without a user gesture;
  // we swallow the rejection so the UI just sits paused if so.
  useEffect(() => {
    if (!autoPlay || !audioRef.current) return;
    audioRef.current.play().catch(() => {
      /* user gesture may be required */
    });
  }, [autoPlay, src]);

  function toggle(): void {
    const el = audioRef.current;
    log.info('toggle clicked', {
      elPresent: !!el,
      paused: el?.paused,
      readyState: el?.readyState,
      currentSrc: el?.currentSrc?.slice(0, 64),
    });
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => log.info('play resolved'))
        .catch((e) => log.error('play rejected', String(e)));
    } else {
      el.pause();
    }
  }

  function onScrubChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const next = parseFloat(e.target.value);
    setCurrentTime(next);
    setSeeking(true);
  }

  function onScrubCommit(e: React.ChangeEvent<HTMLInputElement>): void {
    const next = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = next;
    setSeeking(false);
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="audio-player">
      <button
        type="button"
        className="audio-player-toggle"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={toggle}
      >
        {playing ? (
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <rect x="2" y="1" width="3.5" height="12" fill="currentColor" />
            <rect x="8.5" y="1" width="3.5" height="12" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <polygon points="3,1 12,7 3,13" fill="currentColor" />
          </svg>
        )}
      </button>
      <span className="audio-player-time">{formatTime(currentTime)}</span>
      <div className="audio-player-scrub-wrap">
        <div className="audio-player-scrub-fill" style={{ width: `${pct}%` }} />
        <input
          type="range"
          className="audio-player-scrub"
          min={0}
          max={duration || 0}
          step={0.01}
          value={currentTime}
          onChange={onScrubChange}
          onMouseUp={onScrubCommit as unknown as React.MouseEventHandler<HTMLInputElement>}
          onTouchEnd={onScrubCommit as unknown as React.TouchEventHandler<HTMLInputElement>}
          onKeyUp={onScrubCommit as unknown as React.KeyboardEventHandler<HTMLInputElement>}
        />
      </div>
      <span className="audio-player-time">{formatTime(duration)}</span>
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration((e.currentTarget as HTMLAudioElement).duration)}
        onLoadedData={onLoadedData}
        onTimeUpdate={(e) => {
          // Don't fight the user while they're dragging the scrub bar.
          if (seeking) return;
          setCurrentTime((e.currentTarget as HTMLAudioElement).currentTime);
        }}
        onError={onError}
      />
    </div>
  );
}
