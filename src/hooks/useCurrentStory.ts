import { useCallback, useEffect, useState } from 'react';
import { repo } from '../story/repository';
import { StoryMeta, TimelineEntry } from '../story/types';

export interface CurrentStory {
  meta: StoryMeta | null;
  timeline: TimelineEntry[];
  liveSeq: number | undefined;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setMeta: (meta: StoryMeta) => void;
  appendEntries: (entries: TimelineEntry[], liveSeq?: number) => void;
}

/**
 * Load and track one story's meta + timeline. Centralizes the
 * "fetch on mount, refresh after edits, append after a turn" dance so
 * StoryView and WikiPanel agree on the same source of truth.
 */
export function useCurrentStory(storyId: string): CurrentStory {
  const [meta, setMeta] = useState<StoryMeta | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [liveSeq, setLiveSeq] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, t] = await Promise.all([repo.load(storyId), repo.listTimeline(storyId)]);
      setMeta(m);
      setTimeline(t);
      // Intentionally leave liveSeq untouched on refresh. liveSeq drives
      // audio auto-play, which we only want immediately after a fresh turn
      // (set by appendEntries), not when the user re-opens a story.
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const appendEntries = useCallback((entries: TimelineEntry[], next?: number) => {
    setTimeline((arr) => [...arr, ...entries]);
    if (next !== undefined) setLiveSeq(next);
  }, []);

  return {
    meta,
    timeline,
    liveSeq,
    loading,
    error,
    refresh,
    setMeta,
    appendEntries,
  };
}
