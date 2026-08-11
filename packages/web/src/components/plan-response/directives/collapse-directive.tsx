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
    <div className="my-6 border border-line rounded-ui-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-canvas-sunken hover:bg-canvas-sunken/70 transition-colors min-h-touch"
      >
        <span className="text-[14px] font-bold text-content">{title}</span>
        <ChevronDown
          className={cn('w-4 h-4 text-content-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen && (
        <div className="p-4 border-t border-line">
          <div className="max-w-none text-sm [&_p]:text-content-secondary [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:text-content [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:text-content-secondary [&_li]:mb-1 [&_li>p]:my-0 marker:text-content-faint">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
