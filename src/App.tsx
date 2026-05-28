import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { lifecycle } from './lemonade/lifecycle';
import { useLemonadeStatus } from './hooks/useLemonadeStatus';
import { SetupScreen } from './components/SetupScreen';
import { StartScreen } from './components/StartScreen';
import { GeneratingScreen, GenerationStep } from './components/GeneratingScreen';
import { StoryView } from './components/StoryView';
import { StatusBar } from './components/StatusBar';
import { createNewStory, NewStoryActivity } from './story/repository';
import { AgentActivity } from './agent/agentLoop';

const appWindow = getCurrentWindow();

type ResizeDir =
  | 'North'
  | 'NorthEast'
  | 'East'
  | 'SouthEast'
  | 'South'
  | 'SouthWest'
  | 'West'
  | 'NorthWest';

function ResizeHandles(): React.JSX.Element {
  const start = (dir: ResizeDir) => (e: React.MouseEvent) => {
    // Only the primary mouse button should initiate resize, otherwise
    // right-clicks on the edge get swallowed.
    if (e.button !== 0) return;
    void appWindow.startResizeDragging(dir);
  };
  return (
    <>
      <div className="resize-edge resize-n" onMouseDown={start('North')} />
      <div className="resize-edge resize-s" onMouseDown={start('South')} />
      <div className="resize-edge resize-e" onMouseDown={start('East')} />
      <div className="resize-edge resize-w" onMouseDown={start('West')} />
      <div className="resize-edge resize-ne" onMouseDown={start('NorthEast')} />
      <div className="resize-edge resize-nw" onMouseDown={start('NorthWest')} />
      <div className="resize-edge resize-se" onMouseDown={start('SouthEast')} />
      <div className="resize-edge resize-sw" onMouseDown={start('SouthWest')} />
    </>
  );
}

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
      const detail = e instanceof Error ? e.message : String(e);
      setToast(`Failed to start story: ${detail}`);
      setScreen({ name: 'start' });
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
      return (
        <GeneratingScreen
          prompt={screen.prompt}
          steps={generationSteps}
          onCancel={() => setScreen({ name: 'start' })}
        />
      );
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
      <ResizeHandles />
      <header className="app-header" data-tauri-drag-region>
        <h1 data-tauri-drag-region>HaloTales</h1>
        <span
          data-tauri-drag-region
          style={{ color: 'var(--fg-muted)', fontSize: 13 }}
        >
          Local-AI roleplaying · powered by Lemonade OmniRouter
        </span>
        <div className="spacer" data-tauri-drag-region />
        {!ready && (
          <span
            data-tauri-drag-region
            style={{ color: 'var(--fg-muted)', fontSize: 13 }}
          >
            {lifecycleState.message ?? 'Starting Lemonade…'}
          </span>
        )}
        <div className="window-controls">
          <button
            className="window-control"
            aria-label="Minimize"
            onClick={() => void appWindow.minimize()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4" width="10" height="2" fill="currentColor" /></svg>
          </button>
          <button
            className="window-control"
            aria-label="Maximize"
            onClick={() => void appWindow.toggleMaximize()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
          <button
            className="window-control window-control-close"
            aria-label="Close"
            onClick={() => void appWindow.close()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" />
              <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
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
    { id: 'planning', label: 'Planning the scene', status: 'pending' },
    { id: 'image', label: 'Painting the cover scene', status: 'pending' },
    { id: 'audio', label: 'Rendering narration audio', status: 'pending' },
    { id: 'composing', label: 'Writing the displayed prose', status: 'pending' },
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
      update('composing', { status: 'done' });
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
      // Fired once at the start of the turn — the model is planning what
      // tools to call before doing anything else.
      update('planning', { status: 'active' });
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
    case 'composing':
      // Iter 2 is starting: tools are all done, model is now writing the
      // 60–120-word displayed prose. This is a distinct (and visibly slow)
      // step; users were left staring at "all done" while it ran.
      update('composing', { status: 'active' });
      break;
    case 'final':
      update('composing', { status: 'done' });
      break;
  }
}
