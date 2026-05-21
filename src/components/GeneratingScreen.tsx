import React from 'react';

export interface GenerationStep {
  id: string;
  label: string;
  detail?: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

interface Props {
  prompt: string;
  steps: GenerationStep[];
  onCancel?: () => void;
}

export function GeneratingScreen({ prompt, steps, onCancel }: Props): React.JSX.Element {
  return (
    <div className="generating">
      <div className="generating-panel">
        <h2>Creating your tale</h2>
        <p className="lede">{prompt}</p>
        <ul className="generation-list">
          {steps
            .filter((step) => step.status !== 'pending')
            .map((step) => (
              <li key={step.id} className={`generation-item ${step.status}`}>
                <span className="generation-dot" />
                <div>
                  <div>{step.label}</div>
                  {step.detail && <div className="generation-detail">{step.detail}</div>}
                </div>
              </li>
            ))}
        </ul>
        {onCancel && (
          <div style={{ marginTop: 24, textAlign: 'right' }}>
            <button type="button" onClick={onCancel}>
              Back to start
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
