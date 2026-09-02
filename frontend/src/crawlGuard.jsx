import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const CrawlGuardContext = createContext({
  isActive: false,
  setActive: () => {},
  registerCancel: () => {},
  requestLeave: async () => true,
});

export function CrawlGuardProvider({ children }) {
  const [isActive, setActive] = useState(false);
  const cancelRef = useRef(null);

  const registerCancel = useCallback((fn) => {
    cancelRef.current = fn;
    return () => {
      if (cancelRef.current === fn) cancelRef.current = null;
    };
  }, []);

  const requestLeave = useCallback(async () => {
    if (!isActive) return true;
    const ok = window.confirm(
      'Your crawl progress will be lost. Leave this page and start over?',
    );
    if (!ok) return false;
    if (cancelRef.current) {
      try {
        await cancelRef.current();
      } catch {
        // Still allow leave even if cancel request fails (e.g. job already gone).
      }
    }
    setActive(false);
    return true;
  }, [isActive]);

  const value = useMemo(
    () => ({ isActive, setActive, registerCancel, requestLeave }),
    [isActive, registerCancel, requestLeave],
  );

  return <CrawlGuardContext.Provider value={value}>{children}</CrawlGuardContext.Provider>;
}

export function useCrawlGuard() {
  return useContext(CrawlGuardContext);
}
