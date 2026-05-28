import React from 'react';
import { LifecycleState } from '../lemonade/types';

interface Props {
  state: LifecycleState;
}

const SOURCE_LABEL: Record<string, string> = {
  system: 'System Lemonade',
  embedded: 'Embedded Lemonade',
};

export function StatusBar({ state }: Props): React.JSX.Element {
  let label: string;
  let dotClass: string;
  if (state.stage === 'ready' && state.endpoint) {
    label = SOURCE_LABEL[state.endpoint.source] ?? 'Lemonade ready';
    dotClass = 'dot ok';
  } else if (state.stage === 'error') {
    label = state.error ?? 'Lemonade unavailable';
    dotClass = 'dot bad';
  } else {
    label = state.message ?? 'Starting Lemonade…';
    dotClass = 'dot pending';
  }

  const url = state.endpoint?.base_url;

  return (
    <footer className="status-bar">
      <span className={dotClass} />
      <span className="status-bar-label">{label}</span>
      {state.omniModel && (
        <span
          className="status-bar-model"
          title={`Omni model in use${state.vramGB ? ` · detected ${state.vramGB.toFixed(0)} GB GPU VRAM` : ''}`}
        >
          {state.omniModel}
        </span>
      )}
      {url && (
        <span className="status-bar-url" title="Lemonade base URL">
          {url}
        </span>
      )}
      <span className="status-bar-spacer" />
      <span className="status-bar-version">HaloTales</span>
    </footer>
  );
}
