import React, { useEffect, useState } from 'react';
import { lifecycle } from './lemonade/lifecycle';
import { useLemonadeStatus } from './hooks/useLemonadeStatus';
import { SetupScreen } from './components/SetupScreen';
import { StartScreen } from './components/StartScreen';
import { StoryView } from './components/StoryView';
import { StatusBar } from './components/StatusBar';

type Screen =
  | { name: 'start' }
  | { name: 'story'; id: string };

export function App(): React.JSX.Element {
  const { state: lifecycleState, retry } = useLemonadeStatus();
  const [screen, setScreen] = useState<Screen>({ name: 'start' });
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

      <div className="app-body">
        {!ready ? (
          <SetupScreen state={lifecycleState} onRetry={retry} />
        ) : screen.name === 'start' ? (
          <StartScreen
            onOpen={(id) => setScreen({ name: 'story', id })}
            onError={(msg) => setToast(msg)}
          />
        ) : (
          <StoryView
            storyId={screen.id}
            onBack={() => setScreen({ name: 'start' })}
            onError={(msg) => setToast(msg)}
          />
        )}
      </div>

      <StatusBar state={lifecycleState} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
