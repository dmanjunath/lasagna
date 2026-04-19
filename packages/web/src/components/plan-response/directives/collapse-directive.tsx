import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../../../lib/utils.js';

interface CollapseDirectiveProps {
  title: string;
  content: string;
}

export function CollapseDirective({ title, content }: CollapseDirectiveProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="my-6 border border-border/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-surface/30 hover:bg-surface/50 transition-colors"
      >
        <span className="text-sm font-medium text-text">{title}</span>
        <ChevronDown
          className={cn('w-4 h-4 text-text-secondary transition-transform', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen && (
        <div className="p-4 border-t border-border/50">
          <div className="prose prose-sm prose-invert max-w-none prose-p:text-text-secondary">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
