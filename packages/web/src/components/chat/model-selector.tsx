import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { useChatStore, getPreferredModelLevel, setPreferredModelLevel, type ModelLevel } from '../../lib/chat-store';

const LEVELS: { value: ModelLevel; label: string; model: string }[] = [
  { value: 'fast', label: 'Fast', model: 'Gemini Flash' },
  { value: 'medium', label: 'Medium', model: 'Claude Sonnet' },
  { value: 'quality', label: 'Quality', model: 'Kimi K2' },
  { value: 'frontier', label: 'Frontier', model: 'Claude Opus' },
];

interface ModelSelectorProps {
  threadLocalId?: string;
  onRestart?: (level: ModelLevel) => void;
}

export function ModelSelector({ threadLocalId, onRestart }: ModelSelectorProps) {
  const { threads, activeThreadIndex, setThreads } = useChatStore();

  const activeThread = activeThreadIndex !== null ? threads[activeThreadIndex] : null;
  const isThread = !!threadLocalId && !!activeThread;

  // The thread's current level and the level it was originally created with
  const currentLevel = isThread
    ? (activeThread.modelLevel ?? getPreferredModelLevel())
    : getPreferredModelLevel();
  const originalLevel = isThread
    ? (activeThread.originalModelLevel ?? currentLevel)
    : currentLevel;

  // Track selected level locally (for list view; thread view reads from thread)
  const [selectedLevel, setSelectedLevel] = useState<ModelLevel>(getPreferredModelLevel);
  const displayLevel = isThread ? currentLevel : selectedLevel;
  const hasChanged = isThread && currentLevel !== originalLevel;

  const current = LEVELS.find(l => l.value === displayLevel) ?? LEVELS[1];

  const handleChange = (level: ModelLevel) => {
    setSelectedLevel(level);
    setPreferredModelLevel(level);

    if (isThread && threadLocalId) {
      // Update thread's model level so follow-up messages use it immediately
      setThreads(prev => prev.map(t =>
        t.thread.id === threadLocalId ? { ...t, modelLevel: level } : t
      ));
    }
  };

  const handleRestart = () => {
    if (!hasChanged || !onRestart) return;
    onRestart(displayLevel);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 w-full">
        {LEVELS.map(l => (
          <button
            type="button"
            key={l.value}
            onClick={() => handleChange(l.value)}
            className={`flex-1 flex flex-col items-center px-2 py-1 rounded transition-colors ${
              displayLevel === l.value
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-text-muted hover:text-text-secondary border border-transparent'
            }`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider leading-none">
              {l.label}
            </span>
            <span className="text-[9px] leading-none mt-0.5 opacity-70">
              {l.model}
            </span>
          </button>
        ))}
      </div>
      {hasChanged && onRestart && (
        <button
          type="button"
          onClick={handleRestart}
          className="flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg bg-accent/10 text-accent text-[11px] font-medium hover:bg-accent/20 transition-colors"
        >
          <RotateCw className="w-3 h-3" />
          Restart chat with {current.label}
        </button>
      )}
    </div>
  );
}
