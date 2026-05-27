import React, { useEffect, useMemo, useRef } from 'react';
import { TimelineEntry } from '../story/types';
import { TurnCard } from './TurnCard';
import { InflightCard } from './InflightCard';
import { GenerationStep } from './GeneratingScreen';

interface Round {
  /** Player's input turn that opened this round, if any. */
  user?: TimelineEntry;
  /** Storyteller scene that responds to the player's input (or the opening). */
  scene: TimelineEntry;
}

export interface InflightRound {
  userText: string;
  steps: GenerationStep[];
}

interface Props {
  storyId: string;
  entries: TimelineEntry[];
  /** seq of the most recent turn — used to auto-play audio just for that one. */
  liveSeq?: number;
  onEdit?: () => void;
  /** A storyteller turn currently being generated for a player input that has
   *  not yet landed on disk. Rendered as a live placeholder card. */
  inflight?: InflightRound | null;
}

/** Pair adjacent (user, scene) entries into rounds. The opening scene has no
 *  user prefix. Orphan user entries (no scene yet) are skipped — they're the
 *  in-flight case and handled by the inflight card. */
function groupRounds(entries: TimelineEntry[]): Round[] {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const rounds: Round[] = [];
  let i = 0;
  while (i < sorted.length) {
    const e = sorted[i];
    if (e.role === 'user' && sorted[i + 1]?.role === 'scene') {
      rounds.push({ user: e, scene: sorted[i + 1] });
      i += 2;
    } else if (e.role === 'scene') {
      rounds.push({ scene: e });
      i += 1;
    } else {
      i += 1;
    }
  }
  return rounds;
}

export function Timeline({
  storyId,
  entries,
  liveSeq,
  onEdit,
  inflight,
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // flex-direction: row-reverse means the newest card is first in DOM
    // order; pin scrollLeft=0 so it stays visible after each new turn.
    if (ref.current) ref.current.scrollLeft = 0;
  }, [entries.length, !!inflight]);

  const rounds = useMemo(() => groupRounds(entries), [entries]);
  // Number rounds in story order (opening = 1) so the user-visible label
  // matches the number of cards, not the underlying timeline seq (which
  // counts user inputs separately).
  const numberedRounds = useMemo(
    () => rounds.map((round, idx) => ({ round, turnNumber: idx + 1 })),
    [rounds],
  );
  const sortedRounds = useMemo(
    () => [...numberedRounds].sort((a, b) => b.round.scene.seq - a.round.scene.seq),
    [numberedRounds],
  );

  return (
    <div className="timeline" ref={ref}>
      {inflight && <InflightCard userText={inflight.userText} steps={inflight.steps} />}
      {sortedRounds.map(({ round, turnNumber }) => (
        <TurnCard
          key={round.scene.seq}
          storyId={storyId}
          entry={round.scene}
          turnNumber={turnNumber}
          userPrefix={round.user?.markdown}
          autoPlayAudio={liveSeq === round.scene.seq}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
