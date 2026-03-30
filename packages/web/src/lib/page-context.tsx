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
  chatOpen: boolean;
  openChat: (initialMessage?: string) => void;
  closeChat: () => void;
  pendingMessage: string | null;
  clearPendingMessage: () => void;
}

const PageContext = createContext<PageContextState | null>(null);

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [currentPage, setCurrentPage] = useState<PageContextData | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const setPageContext = useCallback((context: PageContextData) => {
    setCurrentPage(context);
  }, []);

  const clearPageContext = useCallback(() => {
    setCurrentPage(null);
  }, []);

  const openChat = useCallback((initialMessage?: string) => {
    if (initialMessage) {
      setPendingMessage(initialMessage);
    }
    setChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
  }, []);

  const clearPendingMessage = useCallback(() => {
    setPendingMessage(null);
  }, []);

  return (
    <PageContext.Provider
      value={{
        currentPage,
        setPageContext,
        clearPageContext,
        chatOpen,
        openChat,
        closeChat,
        pendingMessage,
        clearPendingMessage,
      }}
    >
      {children}
    </PageContext.Provider>
  );
}

export function usePageContext() {
  const ctx = useContext(PageContext);
  if (!ctx) {
    throw new Error('usePageContext must be used within PageContextProvider');
  }
  return ctx;
}
