import React, { useEffect, useState } from 'react';
import { lifecycle } from './lemonade/lifecycle';
import { useLemonadeStatus } from './hooks/useLemonadeStatus';
import { SetupScreen } from './components/SetupScreen';
import { StartScreen } from './components/StartScreen';
import { GeneratingScreen, GenerationStep } from './components/GeneratingScreen';
import { StoryView } from './components/StoryView';
import { StatusBar } from './components/StatusBar';
import { createNewStory, NewStoryActivity } from './story/repository';
import { AgentActivity } from './agent/agentLoop';

type Screen =
  | { name: 'start' }
  | { name: 'generating'; prompt: string }
  | { name: 'story'; id: string };

export function App(): React.JSX.Element {
  const { state: lifecycleState, retry } = useLemonadeStatus();
  const [screen, setScreen] = useState<Screen>({ name: 'start' });
  const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>(() => initialGenerationSteps());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void lifecycle.start();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const ready = lifecycleState.stage === 'ready';

  function updateGenerationStep(
    id: string,
    patch: Partial<Omit<GenerationStep, 'id'>>,
  ): void {
    setGenerationSteps((steps) =>
      steps.map((step) => {
        if (step.id === id) return { ...step, ...patch };
        if (patch.status === 'active' && step.status === 'active') {
          return { ...step, status: 'done' };
        }
        return step;
      }),
    );
  }

  async function beginStory(prompt: string): Promise<void> {
    setGenerationSteps(initialGenerationSteps());
    setScreen({ name: 'generating', prompt });
    try {
      const { meta } = await createNewStory(prompt, {
        onActivity: (event) => handleGenerationActivity(event, updateGenerationStep),
      });
      setScreen({ name: 'story', id: meta.id });
    } catch (e) {
      updateGenerationStep('save', {
        status: 'error',
        detail: 'Story generation stopped before it could be saved.',
      });
      setToast(`Failed to start story: ${String(e)}`);
    }
  }

  function renderBody(): React.JSX.Element {
    if (!ready) return <SetupScreen state={lifecycleState} onRetry={retry} />;
    if (screen.name === 'start') {
      return (
        <StartScreen
          onOpen={(id) => setScreen({ name: 'story', id })}
          onBegin={(prompt) => void beginStory(prompt)}
          onError={setToast}
        />
      );
    }
    if (screen.name === 'generating') {
      return <GeneratingScreen prompt={screen.prompt} steps={generationSteps} />;
    }
    return (
      <StoryView
        storyId={screen.id}
        onBack={() => setScreen({ name: 'start' })}
        onError={setToast}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>HaloTales</h1>
        <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          Local-AI roleplaying · powered by Lemonade OmniRouter
        </span>
        <div className="spacer" />
        {!ready && (
          <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
            {lifecycleState.message ?? 'Starting Lemonade…'}
          </span>
        )}
      </header>

      <div className="app-body">{renderBody()}</div>

      <StatusBar state={lifecycleState} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function initialGenerationSteps(): GenerationStep[] {
  return [
    { id: 'story', label: 'Creating story journal', status: 'active' },
    { id: 'title', label: 'Naming the tale', status: 'pending' },
    { id: 'narration', label: 'Writing the opening scene', status: 'pending' },
    { id: 'image', label: 'Painting the cover scene', status: 'pending' },
    { id: 'audio', label: 'Rendering narration audio', status: 'pending' },
    { id: 'save', label: 'Saving the opening turn', status: 'pending' },
  ];
}

function handleGenerationActivity(
  activity: NewStoryActivity,
  update: (id: string, patch: Partial<Omit<GenerationStep, 'id'>>) => void,
): void {
  switch (activity.kind) {
    case 'story_created':
      update('story', { status: 'done' });
      break;
    case 'title_start':
      update('title', { status: 'active' });
      break;
    case 'title_done':
      update('title', { status: 'done', detail: activity.title });
      break;
    case 'saving':
      update('narration', { status: 'done' });
      update('save', { status: 'active' });
      break;
    case 'saved':
      update('save', { status: 'done' });
      break;
    case 'agent':
      handleAgentActivity(activity.event, update);
      break;
  }
}

function handleAgentActivity(
  event: AgentActivity,
  update: (id: string, patch: Partial<Omit<GenerationStep, 'id'>>) => void,
): void {
  switch (event.kind) {
    case 'thinking':
      update('narration', { status: 'active' });
      break;
    case 'tool_call':
      if (event.name === 'generate_image' || event.name === 'edit_image') {
        update('image', { status: 'active' });
      } else if (event.name === 'text_to_speech') {
        update('audio', { status: 'active' });
      }
      break;
    case 'image_done':
      update('image', { status: 'done' });
      break;
    case 'audio_done':
      update('audio', { status: 'done' });
      break;
    case 'final':
      update('narration', { status: 'done' });
      break;
  }
}
