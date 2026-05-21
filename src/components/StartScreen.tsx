import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { repo } from '../story/repository';
import { StoryMeta } from '../story/types';
import { warmStoryteller } from '../lemonade/warmup';
import { makeLogger } from '../util/logger';

const log = makeLogger('start');

async function thumbnailDataUrl(storyId: string, relative: string): Promise<string> {
  const b64 = await invoke<string>('read_artifact_b64', { storyId, relative });
  return `data:image/png;base64,${b64}`;
}

interface Props {
  onOpen: (id: string) => void;
  onBegin: (prompt: string) => void;
  onError: (msg: string) => void;
}

interface CardData extends StoryMeta {
  cover?: string;
}

const DEFAULT_SEED = 'A weather-worn detective walks into a rain-soaked Tokyo alley...';

export function StartScreen({ onOpen, onBegin, onError }: Props): React.JSX.Element {
  const [stories, setStories] = useState<CardData[]>([]);
  const [seed, setSeed] = useState('');
  const [warmup, setWarmup] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWarmup('loading');
    warmStoryteller()
      .then(() => {
        if (!cancelled) setWarmup('ready');
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[start] storyteller warmup failed:', e);
          setWarmup('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    try {
      const list = await repo.list();
      const enriched: CardData[] = await Promise.all(
        list.map(async (s) => {
          if (s.thumbnail) {
            try {
              const url = await thumbnailDataUrl(s.id, s.thumbnail);
              return { ...s, cover: url };
            } catch (e) {
              log.warn('thumbnail load failed', { id: s.id, thumbnail: s.thumbnail }, e);
            }
          }
          return s;
        }),
      );
      setStories(enriched);
    } catch (e) {
      onError(String(e));
    }
  }

  async function onCreate() {
    const prompt = seed.trim() || DEFAULT_SEED;
    setSeed('');
    onBegin(prompt);
  }

  async function onDeleteStory(
    event: React.MouseEvent<HTMLButtonElement>,
    story: CardData,
  ): Promise<void> {
    event.stopPropagation();
    const ok = await confirm(`Delete "${story.title}"? This cannot be undone.`, {
      title: 'Delete story',
      kind: 'warning',
    });
    if (!ok) return;
    try {
      await repo.remove(story.id);
      setStories((current) => current.filter((s) => s.id !== story.id));
    } catch (e) {
      onError(`Failed to delete story: ${String(e)}`);
    }
  }

  return (
    <div className="start">
      <h2>Begin a new tale</h2>
      <p className="lede">
        Describe a world, a character, or a situation. The storyteller will weave it into a scene
        you can step into.
      </p>
      <div className="new-story-prompt">
        <textarea
          value={seed}
          placeholder={DEFAULT_SEED}
          onChange={(e) => setSeed(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onCreate();
            }
          }}
        />
        <button className="primary" onClick={onCreate}>
          Begin
        </button>
      </div>
      <div className="warmup-status">
        {warmup === 'loading' && <span className="dot-loader">Loading storyteller</span>}
        {warmup === 'ready' && 'Storyteller ready'}
        {warmup === 'error' && 'Storyteller will load when the tale begins'}
      </div>
      <h2>Continue a tale</h2>
      <p className="lede">Your saved stories live in <code>~/.cache/halo-tales</code>.</p>
      <div className="story-grid">
        {stories.length === 0 && (
          <p style={{ color: 'var(--fg-muted)' }}>No stories yet. Start one above.</p>
        )}
        {stories.map((s) => (
          <div key={s.id} className="story-card" onClick={() => onOpen(s.id)}>
            <button
              className="story-delete"
              aria-label={`Delete ${s.title}`}
              title="Delete story"
              onClick={(e) => void onDeleteStory(e, s)}
            >
              ×
            </button>
            <div
              className="cover"
              style={s.cover ? { backgroundImage: `url("${s.cover}")` } : undefined}
            />
            <div className="body">
              <h3>{s.title}</h3>
              <div className="meta">
                {s.status === 'ended' ? `Ended — ${s.outcome ?? 'complete'}` : 'In progress'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
