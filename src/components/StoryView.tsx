import React, { useEffect, useState } from 'react';
import { advanceStory } from '../story/repository';
import { AgentActivity } from '../agent/agentLoop';
import { useCurrentStory } from '../hooks/useCurrentStory';
import { Timeline, InflightRound } from './Timeline';
import { GenerationStep } from './GeneratingScreen';
import { TurnInput } from './TurnInput';
import { WikiPanel } from './WikiPanel';

function initialContinuationSteps(): GenerationStep[] {
  return [
    { id: 'planning', label: 'Planning the response', status: 'active' },
    { id: 'image', label: 'Painting the scene', status: 'pending' },
    { id: 'audio', label: 'Recording narration', status: 'pending' },
    { id: 'composing', label: 'Writing the displayed prose', status: 'pending' },
    { id: 'save', label: 'Saving the turn', status: 'pending' },
  ];
}

function applyAgentActivity(steps: GenerationStep[], event: AgentActivity): GenerationStep[] {
  const update = (id: string, patch: Partial<Omit<GenerationStep, 'id'>>): GenerationStep[] =>
    steps.map((step) => {
      if (step.id === id) return { ...step, ...patch };
      if (patch.status === 'active' && step.status === 'active') {
        return { ...step, status: 'done' };
      }
      return step;
    });
  switch (event.kind) {
    case 'thinking':
      return update('planning', { status: 'active' });
    case 'tool_call':
      if (event.name === 'generate_image' || event.name === 'edit_image') {
        return update('image', { status: 'active' });
      }
      if (event.name === 'text_to_speech') {
        return update('audio', { status: 'active' });
      }
      return steps;
    case 'image_done':
      return update('image', { status: 'done' });
    case 'audio_done':
      return update('audio', { status: 'done' });
    case 'composing':
      return update('composing', { status: 'active' });
    case 'final':
      return update('composing', { status: 'done' });
  }
}

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
  const [inflight, setInflight] = useState<InflightRound | null>(null);

  useEffect(() => {
    if (story.error) onError(story.error);
  }, [story.error, onError]);


  async function onSubmit(text: string): Promise<void> {
    if (!story.meta) return;
    setBusy(true);
    setStatusMsg('Storyteller thinking…');
    setInflight({ userText: text, steps: initialContinuationSteps() });
    try {
      const lastImage = lastImageFilename(story.timeline);
      const result = await advanceStory(storyId, text, lastImage, {
        onAgentActivity: (event) =>
          setInflight((current) =>
            current ? { ...current, steps: applyAgentActivity(current.steps, event) } : current,
          ),
      });
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
      setInflight(null);
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

        {story.timeline.length === 0 && !inflight ? (
          <div className="center-feedback">No turns yet.</div>
        ) : (
          <Timeline
            storyId={storyId}
            entries={story.timeline}
            liveSeq={story.liveSeq}
            onEdit={story.refresh}
            inflight={inflight}
          />
        )}

        <TurnInput disabled={busy || story.meta.status === 'ended'} onSubmit={onSubmit} />
      </div>

      {wikiOpen && (
        <WikiPanel
          storyId={storyId}
          meta={story.meta}
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
