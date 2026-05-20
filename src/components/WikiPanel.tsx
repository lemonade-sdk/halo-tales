import React, { useEffect, useState } from 'react';
import { CharacterEntry, TimelineEntry } from '../story/types';
import { repo } from '../story/repository';
import { storyApi } from '../agent/storyTools';
import { parseFrontmatter } from '../story/markdown';
import { EditableMarkdown } from './MarkdownView';

interface Props {
  storyId: string;
  timeline: TimelineEntry[];
  onTimelineChange: () => void;
  onClose: () => void;
}

type Tab = 'synopsis' | 'characters' | 'timeline';

export function WikiPanel({ storyId, timeline, onTimelineChange, onClose }: Props): React.JSX.Element {
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
    setCharacters(c);
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
    setCharacters(updated);
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
                return (
                  <div key={c.name} className="wiki-section">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h3 style={{ flex: 1 }}>{c.name}</h3>
                      <button className="ghost" onClick={() => removeCharacter(c.name)}>
                        Delete
                      </button>
                    </div>
                    {Object.keys(fm.traits).length > 0 && (
                      <div className="trait-row">
                        {Object.entries(fm.traits).map(([k, v]) => (
                          <span key={k} className="trait-chip">
                            <span className="trait-key">{k}</span>
                            <span className="trait-val">{v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <EditableMarkdown
                      source={c.content}
                      onSave={(next) => saveCharacter(c.name, next)}
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
