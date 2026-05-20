import React, { useEffect, useState } from 'react';
import { repo, artifactUrl, createNewStory } from '../story/repository';
import { StoryMeta } from '../story/types';

interface Props {
  onOpen: (id: string) => void;
  onError: (msg: string) => void;
}

interface CardData extends StoryMeta {
  cover?: string;
}

export function StartScreen({ onOpen, onError }: Props): React.JSX.Element {
  const [stories, setStories] = useState<CardData[]>([]);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const list = await repo.list();
      const enriched: CardData[] = await Promise.all(
        list.map(async (s) => {
          if (s.thumbnail) {
            try {
              const url = await artifactUrl(s.id, s.thumbnail);
              return { ...s, cover: url };
            } catch { /* ignore */ }
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
    if (!seed.trim()) return;
    setBusy(true);
    try {
      const { meta } = await createNewStory(seed.trim());
      setSeed('');
      onOpen(meta.id);
    } catch (e) {
      onError(`Failed to start story: ${String(e)}`);
    } finally {
      setBusy(false);
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
          placeholder="A weather-worn detective walks into a rain-soaked Tokyo alley…"
          onChange={(e) => setSeed(e.target.value)}
          disabled={busy}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onCreate();
            }
          }}
        />
        <button className="primary" onClick={onCreate} disabled={busy || !seed.trim()}>
          {busy ? <span className="dot-loader">Spinning up the story</span> : 'Begin'}
        </button>
      </div>
      <h2>Continue a tale</h2>
      <p className="lede">Your saved stories live in <code>~/.cache/halo-tales</code>.</p>
      <div className="story-grid">
        {stories.length === 0 && (
          <p style={{ color: 'var(--fg-muted)' }}>No stories yet. Start one above.</p>
        )}
        {stories.map((s) => (
          <div key={s.id} className="story-card" onClick={() => onOpen(s.id)}>
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
