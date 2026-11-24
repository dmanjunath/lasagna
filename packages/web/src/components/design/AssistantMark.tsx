import { Sparkles } from 'lucide-react';
import { useActiveTheme } from '../uikit/design';
import { Mascot } from './Mascot';

/**
 * The assistant's mark: the design's character where its brand art is the
 * mascot (Noodle, as native Chat shows it), else the sparkle in its tint tile.
 * The tile keeps its size and place either way.
 */
export function AssistantMark({ tileClassName, iconClassName }: { tileClassName: string; iconClassName: string }) {
  const theme = useActiveTheme();
  if (theme?.skin.brandArt === 'mascot' && theme.mascot) {
    return (
      <div className={tileClassName} style={{ background: 'transparent' }}>
        <Mascot theme={theme} className="block h-full w-full text-content" />
      </div>
    );
  }
  return (
    <div className={tileClassName}>
      <Sparkles className={iconClassName} />
    </div>
  );
}
