import { useEffect, useState } from 'react';
import { lifecycle } from '../lemonade/lifecycle';
import { LifecycleState } from '../lemonade/types';

/**
 * Subscribe to the Lemonade lifecycle state machine. The lifecycle is a
 * singleton owned by `lemonade/lifecycle.ts`; this hook is the React-side
 * adapter that re-renders whenever the stage / progress / endpoint changes.
 *
 * Returns the current state plus a `retry()` helper that re-runs the
 * machine from scratch — useful for the Setup screen's error path.
 */
export function useLemonadeStatus(): { state: LifecycleState; retry: () => void } {
  const [state, setState] = useState<LifecycleState>(lifecycle.getState());

  useEffect(() => {
    return lifecycle.subscribe(setState);
  }, []);

  return {
    state,
    retry: () => {
      void lifecycle.start();
    },
  };
}
