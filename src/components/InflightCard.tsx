import React from 'react';
import { GenerationStep } from './GeneratingScreen';

interface Props {
  userText: string;
  steps: GenerationStep[];
}

/** Live placeholder card shown while the storyteller is generating a
 *  continuation. The player's words sit on top; the agent-loop step bullets
 *  fill the body. When the real scene saves, StoryView drops this and lets
 *  the merged user+scene TurnCard render in its place. */
export function InflightCard({ userText, steps }: Props): React.JSX.Element {
  return (
    <article className="turn-card role-scene turn-card-inflight">
      <div className="body">
        <div className="turn-card-meta">Storyteller · working…</div>
        <div className="turn-card-user-prefix">
          <span className="turn-card-user-label">You:</span> {userText}
        </div>
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
      </div>
    </article>
  );
}
