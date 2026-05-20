import React, { useEffect, useRef } from 'react';
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
    // row-reverse: the newest card sits at the left of the DOM order;
    // we want the scroll position pinned to scrollLeft=0 so it stays visible.
    if (ref.current) ref.current.scrollLeft = 0;
  }, [entries.length]);

  // Render newest first so flex-direction: row-reverse displays them on the right edge.
  const sorted = [...entries].sort((a, b) => b.seq - a.seq);

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
