import React, { useEffect, useState } from 'react';
import { advanceStory } from '../story/repository';
import { useCurrentStory } from '../hooks/useCurrentStory';
import { Timeline } from './Timeline';
import { TurnInput } from './TurnInput';
import { WikiPanel } from './WikiPanel';

interface Props {
  storyId: string;
  onBack: () => void;
  onError: (msg: string) => void;
}

export function StoryView({ storyId, onBack, onError }: Props): React.JSX.Element {
  const story = useCurrentStory(storyId);
  const [busy, setBusy] = useState(false);
  const [wikiOpen, setWikiOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Surface any load-failure from the hook to the App-level toast
  useEffect(() => {
    if (story.error) onError(story.error);
  }, [story.error, onError]);

  async function onSubmit(text: string): Promise<void> {
    if (!story.meta) return;
    setBusy(true);
    setStatusMsg('Storyteller thinking…');
    try {
      const result = await advanceStory(storyId, text);
      story.appendEntries([result.user, result.scene], result.scene.seq);
      if (result.output.ended) {
        story.setMeta({
          ...story.meta,
          status: 'ended',
          outcome: result.output.outcome ?? 'complete',
        });
      }
    } catch (e) {
      onError(`Turn failed: ${String(e)}`);
    } finally {
      setBusy(false);
      setStatusMsg(null);
    }
  }

  if (story.loading || !story.meta) {
    return <div className="center-feedback">Loading…</div>;
  }

  return (
    <>
      <div className="story">
        <div className="story-toolbar">
          <button className="ghost" onClick={onBack}>← Library</button>
          <div className="title">{story.meta.title}</div>
          <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
            {story.meta.status === 'ended'
              ? `Ended — ${story.meta.outcome ?? 'complete'}`
              : 'In progress'}
          </div>
          <div className="spacer" />
          {statusMsg && (
            <div style={{ color: 'var(--fg-dim)', fontSize: 13 }} className="dot-loader">
              {statusMsg}
            </div>
          )}
          <button onClick={() => setWikiOpen(true)}>Wiki</button>
        </div>

        {story.timeline.length === 0 ? (
          <div className="center-feedback">No turns yet.</div>
        ) : (
          <Timeline
            storyId={storyId}
            entries={story.timeline}
            liveSeq={story.liveSeq}
            onEdit={story.refresh}
          />
        )}

        <TurnInput disabled={busy || story.meta.status === 'ended'} onSubmit={onSubmit} />
      </div>

      {wikiOpen && (
        <WikiPanel
          storyId={storyId}
          onClose={() => {
            setWikiOpen(false);
            void story.refresh();
          }}
        />
      )}
    </>
  );
}
