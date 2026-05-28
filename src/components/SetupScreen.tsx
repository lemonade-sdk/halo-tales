import React from 'react';
import { LifecycleStage, LifecycleState } from '../lemonade/types';
import { OMNI_MODEL_DISPLAY } from '../lemonade/models';

interface Props {
  state: LifecycleState;
  onRetry: () => void;
}

interface Step {
  id: string;
  label: string;
  stages: LifecycleStage[];
  done: (state: LifecycleState) => boolean;
}

function buildSteps(state: LifecycleState): Step[] {
  const tier = state.omniTier;
  const display = tier ? OMNI_MODEL_DISPLAY[tier] : null;
  const modelLabel = display
    ? `Loading ${display.name}`
    : 'Loading omni model';
  return [
    {
      id: 'probe',
      label: 'Locating Lemonade',
      stages: ['probing'],
      done: (s) => stageIndex(s.stage) > stageIndex('probing'),
    },
    {
      id: 'install',
      label: 'Installing Lemonade',
      stages: ['downloading_lemonade', 'starting_lemonade'],
      done: (s) => stageIndex(s.stage) > stageIndex('starting_lemonade'),
    },
    {
      id: 'check-models',
      label: 'Choosing the right omni model',
      stages: ['checking_models'],
      done: (s) => stageIndex(s.stage) > stageIndex('checking_models'),
    },
    {
      id: 'pull-model',
      label: modelLabel,
      stages: ['pulling_model'],
      done: (s) => s.stage === 'ready',
    },
  ];
}

function stageIndex(stage: LifecycleStage): number {
  const order: LifecycleStage[] = [
    'probing',
    'downloading_lemonade',
    'starting_lemonade',
    'checking_models',
    'pulling_model',
    'ready',
  ];
  return order.indexOf(stage);
}

export function SetupScreen({ state, onRetry }: Props): React.JSX.Element {
  const steps = buildSteps(state);
  const activeStepIdx = steps.findIndex((s) => !s.done(state));
  return (
    <div className="setup">
      <div className="setup-card">
        <h2>Setting up your storyteller</h2>
        <p>
          HaloTales runs entirely on your machine via Lemonade Omni Models.
          The first launch downloads everything needed — give it a few minutes.
        </p>
        <div className="checklist">
          {steps.map((step, idx) => {
            const done = step.done(state);
            const active = !done && idx === activeStepIdx;
            const progressMeta = state.progressDetails
              ? formatProgressMeta(state.progressDetails)
              : '';
            return (
              <div key={step.id} className="check-row">
                <span className={`check-icon ${done ? 'done' : active ? 'active' : ''}`} />
                <div style={{ flex: 1 }}>
                  <div>{step.label}</div>
                  {active && state.message && (
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{state.message}</div>
                  )}
                  {active && typeof state.progress === 'number' && (
                    <>
                      <div className="progress-bar">
                        <span style={{ width: `${state.progress}%` }} />
                      </div>
                      {progressMeta && <div className="progress-meta">{progressMeta}</div>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {state.stage === 'error' && (
          <>
            <div className="setup-error" style={{ marginTop: 16 }}>
              {state.error ?? 'Something went wrong while setting up Lemonade.'}
            </div>
            <button className="primary" style={{ marginTop: 12 }} onClick={onRetry}>
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function formatProgressMeta(details: NonNullable<LifecycleState['progressDetails']>): string {
  const parts: string[] = [];
  if (typeof details.downloaded === 'number' && typeof details.total === 'number') {
    parts.push(`${formatBytes(details.downloaded)} of ${formatBytes(details.total)}`);
  } else if (typeof details.downloaded === 'number') {
    parts.push(formatBytes(details.downloaded));
  } else if (typeof details.total === 'number') {
    parts.push(formatBytes(details.total));
  }
  if (typeof details.rate === 'number' && details.rate > 0) {
    parts.push(`${formatBytes(details.rate)}/s`);
  }
  return parts.join(' · ');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
