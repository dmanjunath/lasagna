import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import { getAllCategories } from '../../lib/route-categories';
import type { ChatThread } from '../../lib/types';

interface HistoryTabProps {
  onSelectThread: (threadId: string) => void;
}

export function HistoryTab({ onSelectThread }: HistoryTabProps) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categories = getAllCategories();

  useEffect(() => {
    api.getThreads().then(({ threads }) => setThreads(threads));
  }, []);

  const filtered = threads.filter(t => {
    const matchesSearch = !search || (t.title || '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !activeCategory || (t.tags || []).includes(activeCategory);
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-canvas-sunken border border-line rounded-ui-md focus-within:border-brand focus-within:ring-4 focus-within:ring-brand-soft transition-[border-color,box-shadow]">
          <Search className="w-4 h-4 text-content-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads..."
            className="flex-1 bg-transparent text-sm text-content placeholder:text-content-muted focus:outline-none"
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            !activeCategory ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))]' : 'bg-panel border border-line-strong text-content-secondary hover:bg-canvas-sunken'
          }`}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              activeCategory === cat ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))]' : 'bg-panel border border-line-strong text-content-secondary hover:bg-canvas-sunken'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-4 space-y-2">
        {filtered.length === 0 ? (
          <p className="text-center text-content-muted text-sm py-8">No threads found</p>
        ) : (
          filtered.map(thread => (
            <button
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className="w-full text-left bg-panel border border-line rounded-ui-md p-3 hover:bg-canvas-sunken transition-colors"
              data-testid="history-thread"
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-sm font-medium text-content line-clamp-2">
                  {thread.title || 'Untitled thread'}
                </span>
                <span className="text-[10px] text-content-muted whitespace-nowrap ml-2">
                  {new Date(thread.createdAt).toLocaleDateString()}
                </span>
              </div>
              {thread.tags && thread.tags.length > 0 && (
                <div className="flex gap-1 mt-1.5">
                  {thread.tags.map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))] text-[10px] rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
