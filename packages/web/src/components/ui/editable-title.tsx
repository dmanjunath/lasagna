import * as React from 'react';
import { Check, Pencil, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface EditableTitleProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  className?: string;
}

export const EditableTitle = React.forwardRef<
  HTMLDivElement,
  EditableTitleProps
>(({ value, onSave, className }, ref) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(value);
  const [isHovered, setIsHovered] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update editValue when value prop changes
  React.useEffect(() => {
    if (!isEditing) {
      setEditValue(value);
    }
  }, [value, isEditing]);

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Auto-focus and select text when entering edit mode
  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleSave = async () => {
    // Don't save if value hasn't changed or is empty
    const trimmedValue = editValue.trim();
    if (!trimmedValue || trimmedValue === value) {
      setIsEditing(false);
      setEditValue(value);
      return;
    }

    setIsSaving(true);

    try {
      await onSave(trimmedValue);
      setIsEditing(false);
      setShowSuccess(true);

      // Hide success checkmark after 1 second
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setShowSuccess(false);
        timeoutRef.current = null;
      }, 1000);
    } catch (error: unknown) {
      // Rollback on error
      setEditValue(value);
      setIsEditing(false);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to save title:', errorMessage);
      // You might want to show an error toast here
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleBlur = () => {
    if (!isSaving) {
      handleSave();
    }
  };

  if (isEditing) {
    return (
      <div ref={ref} className={cn('relative', className)}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={isSaving}
          className={cn(
            'w-full px-3 py-1 rounded-lg',
            'bg-bg-elevated border-2 border-accent/50',
            'text-text text-lg font-medium',
            'focus:outline-none focus:ring-2 focus:ring-accent/20',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-all duration-200'
          )}
        />
        {isSaving && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-accent animate-spin" />
        )}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        'group relative inline-flex items-center gap-2 cursor-pointer',
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleStartEdit}
    >
      <span className={cn("text-text", className)}>
        {value}
      </span>

      {showSuccess ? (
        <Check className="h-4 w-4 text-success animate-scale-in" />
      ) : (
        <Pencil
          className={cn(
            'h-4 w-4 text-text-muted transition-opacity duration-200',
            isHovered ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
    </div>
  );
});

EditableTitle.displayName = 'EditableTitle';
