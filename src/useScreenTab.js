import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { nextTabSearch, tabFromSearch } from './appNavigation';

export function useScreenTab(allowedTabs, defaultTab) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromSearch(searchParams, allowedTabs, defaultTab);

  const setTab = useCallback((next) => {
    if (next === tab) return;
    setSearchParams((prev) => {
      const qs = nextTabSearch(prev, next, defaultTab);
      return new URLSearchParams(qs);
    }, { replace: false });
  }, [defaultTab, setSearchParams, tab]);

  return [tab, setTab];
}
