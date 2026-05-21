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

  useEffect(() => {
    if (story.error) onError(story.error);
  }, [story.error, onError]);


  async function onSubmit(text: string): Promise<void> {
    if (!story.meta) return;
    setBusy(true);
    setStatusMsg('Storyteller thinking…');
    try {
      const lastImage = lastImageFilename(story.timeline);
      const result = await advanceStory(storyId, text, lastImage);
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
            <div style={{ color: 'var(--fg-dim)', fontSize: 13 }}>
              <span className="spinner" />
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
          timeline={story.timeline}
          onTimelineChange={story.refresh}
          onClose={() => setWikiOpen(false)}
        />
      )}
    </>
  );
}

function lastImageFilename(timeline: readonly { image: string | null }[]): string | undefined {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].image) return timeline[i].image ?? undefined;
  }
  return undefined;
}
