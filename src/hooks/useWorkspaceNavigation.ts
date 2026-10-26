import { useEffect, useRef, useState } from 'react';

export type WorkspacePage = 'calendar' | 'reports' | 'templates';
const hashes: Record<WorkspacePage, string> = { calendar: '#/kalender', reports: '#/zeitkonto', templates: '#/vorlagen' };
const pageForHash = () => (Object.entries(hashes).find(([, hash]) => hash === window.location.hash)?.[0] ?? 'calendar') as WorkspacePage;
const indexKey = 'imOverdueNavigationIndex';

/** Tiny, local-only navigation. A refused Back restores the actual history entry. */
export function useWorkspaceNavigation(canLeave: () => boolean, onLeave: () => void) {
  const [page, setPage] = useState<WorkspacePage>(pageForHash);
  const current = useRef(page);
  const index = useRef<number>(typeof history.state?.[indexKey] === 'number' ? history.state[indexKey] : 0);
  const restoring = useRef(false);
  const guard = useRef(canLeave);
  const leave = useRef(onLeave);
  guard.current = canLeave;
  leave.current = onLeave;
  useEffect(() => {
    history.replaceState({ ...history.state, [indexKey]: index.current }, '', hashes[current.current]);
    const changed = () => {
      const next = pageForHash();
      const nextIndex: unknown = history.state?.[indexKey];
      if (restoring.current) {
        if (window.location.hash === hashes[current.current] && nextIndex === index.current) restoring.current = false;
        return;
      }
      // Direct hash changes create a new physical entry without our state.
      // Mark it before checking the guard so a refusal can return to the
      // original entry instead of leaving two positions with the same index.
      const destinationIndex = typeof nextIndex === 'number' ? nextIndex : index.current + 1;
      if (typeof nextIndex !== 'number') {
        history.replaceState({ ...history.state, [indexKey]: destinationIndex }, '', window.location.href);
      }
      if (next === current.current) {
        // A history jump can reach a different entry of the same page.
        index.current = destinationIndex;
        history.replaceState({ ...history.state, [indexKey]: index.current }, '', hashes[next]);
        return;
      }
      if (!guard.current()) {
        if (destinationIndex !== index.current) {
          restoring.current = true;
          history.go(index.current - destinationIndex);
        } else {
          history.replaceState({ ...history.state, [indexKey]: index.current }, '', hashes[current.current]);
        }
        return;
      }
      leave.current();
      current.current = next;
      index.current = destinationIndex;
      history.replaceState({ ...history.state, [indexKey]: index.current }, '', hashes[next]);
      setPage(next);
    };
    window.addEventListener('popstate', changed);
    window.addEventListener('hashchange', changed);
    return () => { window.removeEventListener('popstate', changed); window.removeEventListener('hashchange', changed); };
  }, []);
  function navigatePage(next: WorkspacePage): boolean {
    if (next === current.current) return true;
    if (restoring.current || !guard.current()) return false;
    leave.current();
    index.current++;
    history.pushState({ ...history.state, [indexKey]: index.current }, '', hashes[next]);
    current.current = next;
    setPage(next);
    return true;
  }
  return { page, navigatePage };
}
