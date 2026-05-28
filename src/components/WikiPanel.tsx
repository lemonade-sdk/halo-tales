import React, { useEffect, useState } from 'react';
import { CharacterEntry, StoryMeta, TimelineEntry } from '../story/types';
import { repo } from '../story/repository';
import { storyApi } from '../agent/storyTools';
import { parseFrontmatter, serializeFrontmatter } from '../story/markdown';
import { EditableMarkdown } from './MarkdownView';

interface Props {
  storyId: string;
  meta: StoryMeta;
  timeline: TimelineEntry[];
  onTimelineChange: () => void;
  onClose: () => void;
}

type Tab = 'synopsis' | 'characters' | 'timeline';

function sortCharacters(list: CharacterEntry[]): CharacterEntry[] {
  // Sort by the human-readable name (frontmatter `name`) if present,
  // otherwise the filename stem.
  const displayName = (entry: CharacterEntry): string =>
    parseFrontmatter(entry.content).traits.name?.trim() || entry.name;
  return [...list].sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

export function WikiPanel({ storyId, meta, timeline, onTimelineChange, onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('synopsis');
  const [synopsis, setSynopsis] = useState('');
  const [characters, setCharacters] = useState<CharacterEntry[]>([]);
  const [newCharName, setNewCharName] = useState('');

  useEffect(() => {
    void loadWikiOnly();
  }, [storyId]);

  // Only synopsis + characters are wiki-private. Timeline is owned by the
  // parent's useCurrentStory hook, so changes to it propagate automatically.
  async function loadWikiOnly(): Promise<void> {
    const [s, c] = await Promise.all([
      storyApi.readStorySummary(storyId),
      storyApi.listCharacters(storyId),
    ]);
    setSynopsis(s);
    setCharacters(sortCharacters(c));
  }

  async function saveSynopsis(next: string): Promise<void> {
    await storyApi.writeStorySummary(storyId, next);
    setSynopsis(next);
  }

  async function saveCharacter(name: string, content: string): Promise<void> {
    await storyApi.upsertCharacter(storyId, name, content);
    setCharacters((arr) => arr.map((c) => (c.name === name ? { ...c, content } : c)));
  }

  async function removeCharacter(name: string): Promise<void> {
    if (!confirm(`Delete character "${name}"?`)) return;
    await storyApi.deleteCharacter(storyId, name);
    setCharacters((arr) => arr.filter((c) => c.name !== name));
  }

  async function addCharacter(): Promise<void> {
    const name = newCharName.trim();
    if (!name) return;
    await storyApi.upsertCharacter(storyId, name, `# ${name}\n\n`);
    setNewCharName('');
    const updated = await storyApi.listCharacters(storyId);
    setCharacters(sortCharacters(updated));
  }

  async function saveTimeline(seq: number, markdown: string): Promise<void> {
    await repo.writeTimelineEntry(storyId, seq, markdown);
    onTimelineChange();
  }

  async function deleteTimelineEntry(seq: number): Promise<void> {
    if (!confirm(`Delete timeline entry ${seq}?`)) return;
    await repo.deleteTimelineEntry(storyId, seq);
    onTimelineChange();
  }

  return (
    <div className="wiki-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="wiki-panel" onClick={(e) => e.stopPropagation()}>
        <div className="wiki-tabs">
          <button
            className={tab === 'synopsis' ? 'active' : ''}
            onClick={() => setTab('synopsis')}
          >
            Synopsis
          </button>
          <button
            className={tab === 'characters' ? 'active' : ''}
            onClick={() => setTab('characters')}
          >
            Characters ({characters.length})
          </button>
          <button
            className={tab === 'timeline' ? 'active' : ''}
            onClick={() => setTab('timeline')}
          >
            Timeline ({timeline.length})
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}>Close</button>
        </div>

        <div className="wiki-content">
          {tab === 'synopsis' && (
            <div className="wiki-section">
              <h3>Running synopsis (story.md)</h3>
              <EditableMarkdown
                source={synopsis}
                onSave={saveSynopsis}
                placeholder="(empty — click to write a synopsis)"
                rows={16}
              />
            </div>
          )}
          {tab === 'characters' && (
            <>
              <div className="wiki-section">
                <h3>Add a character</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={newCharName}
                    placeholder="Character name"
                    onChange={(e) => setNewCharName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCharacter()}
                  />
                  <button onClick={addCharacter} disabled={!newCharName.trim()}>
                    Add
                  </button>
                </div>
              </div>
              {characters.map((c) => {
                const fm = parseFrontmatter(c.content);
                // `traits.name` is the human-readable display name (e.g.
                // "Kenji Sato"); `c.name` is the sanitized filename stem
                // ("KenjiSato"). Hide `name` from the pill row since it's
                // shown as the title.
                const displayName = fm.traits.name?.trim() || c.name;
                const pillTraits = Object.entries(fm.traits).filter(
                  ([k]) => k !== 'name',
                );
                return (
                  <div key={c.name} className="wiki-section">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h3 style={{ flex: 1 }}>{displayName}</h3>
                      <button className="ghost" onClick={() => removeCharacter(c.name)}>
                        Delete
                      </button>
                    </div>
                    {pillTraits.length > 0 && (
                      <div className="trait-row">
                        {pillTraits.map(([k, v]) => (
                          <span key={k} className="trait-chip">
                            <span className="trait-key">{k}</span>
                            <span className="trait-val">{v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <EditableMarkdown
                      source={fm.body}
                      onSave={(nextBody) =>
                        saveCharacter(
                          c.name,
                          serializeFrontmatter({ traits: fm.traits, body: nextBody }),
                        )
                      }
                      placeholder="(empty bio — click to edit)"
                      rows={10}
                    />
                  </div>
                );
              })}
              {characters.length === 0 && (
                <p style={{ color: 'var(--fg-muted)' }}>No characters yet.</p>
              )}
            </>
          )}
          {tab === 'timeline' && (
            <>
              <div className="wiki-section">
                <h3>Prompt</h3>
                <div className="wiki-prompt">{meta.seed_prompt}</div>
              </div>
              {timeline.map((t) => (
                <div key={t.seq} className="wiki-section">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ flex: 1 }}>
                      Turn {t.seq} — {t.role}
                    </h3>
                    <button className="ghost" onClick={() => deleteTimelineEntry(t.seq)}>
                      Delete
                    </button>
                  </div>
                  <EditableMarkdown
                    source={t.markdown}
                    onSave={(next) => saveTimeline(t.seq, next)}
                    rows={8}
                  />
                </div>
              ))}
              {timeline.length === 0 && (
                <p style={{ color: 'var(--fg-muted)' }}>No turns yet.</p>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
