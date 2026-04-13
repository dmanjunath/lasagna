import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface PageContextData {
  pageId: string;
  pageTitle: string;
  description?: string;
  data?: Record<string, unknown>;
}

interface PageContextState {
  currentPage: PageContextData | null;
  setPageContext: (context: PageContextData) => void;
  clearPageContext: () => void;
}

const PageContext = createContext<PageContextState | null>(null);

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [currentPage, setCurrentPage] = useState<PageContextData | null>(null);

  const setPageContext = useCallback((context: PageContextData) => {
    setCurrentPage(context);
  }, []);

  const clearPageContext = useCallback(() => {
    setCurrentPage(null);
  }, []);

  return (
    <PageContext.Provider value={{ currentPage, setPageContext, clearPageContext }}>
      {children}
    </PageContext.Provider>
  );
}

export function usePageContext() {
  const ctx = useContext(PageContext);
  if (!ctx) throw new Error('usePageContext must be used within PageContextProvider');
  return ctx;
}
