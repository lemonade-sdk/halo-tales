import React, { useEffect, useMemo, useRef } from 'react';
import { TimelineEntry } from '../story/types';
import { TurnCard } from './TurnCard';

interface Props {
  storyId: string;
  entries: TimelineEntry[];
  /** seq of the most recent turn — used to auto-play audio just for that one. */
  liveSeq?: number;
  onEdit?: () => void;
}

export function Timeline({ storyId, entries, liveSeq, onEdit }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // flex-direction: row-reverse means the newest card is first in DOM
    // order; pin scrollLeft=0 so it stays visible after each new turn.
    if (ref.current) ref.current.scrollLeft = 0;
  }, [entries.length]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.seq - a.seq),
    [entries],
  );

  return (
    <div className="timeline" ref={ref}>
      {sorted.map((entry) => (
        <TurnCard
          key={entry.seq}
          storyId={storyId}
          entry={entry}
          autoPlayAudio={liveSeq === entry.seq}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
