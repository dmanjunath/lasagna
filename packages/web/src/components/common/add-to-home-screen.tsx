import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface AddToHomeScreenProps {
  onClose: () => void;
}

export function AddToHomeScreen({ onClose }: AddToHomeScreenProps) {
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);
    
    // Check if already in standalone mode
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
  }, []);

  if (isStandalone) return null; // Don't show if already installed

  return (
    <div className="a2hs-prompt md:hidden">
      <button
        onClick={onClose}
        className="absolute top-3 right-3 text-white/60 hover:text-white transition-colors"
        aria-label="Close"
      >
        <X size={18} />
      </button>
      
      <h3>Install LasagnaFi</h3>
      <p>
        Add LasagnaFi to your home screen for the best experience!
      </p>
      
      {isIOS ? (
        <div className="text-sm opacity-90 mb-4">
          <p className="mb-2">To add to home screen:</p>
          <ol className="text-left opacity-80 space-y-1">
            <li>1. Tap the share button <span className="inline-block">⎋</span></li>
            <li>2. Scroll down and tap "Add to Home Screen"</li>
            <li>3. Tap "Add" in the top right</li>
          </ol>
        </div>
      ) : (
        <div className="flex gap-2">
          <button id="install-button" style={{ display: 'none' }}>
            Install Now
          </button>
          <button 
            onClick={() => {
              // Trigger the beforeinstallprompt event if available
              const event = new Event('beforeinstallprompt');
              window.dispatchEvent(event);
            }}
          >
            Try Install
          </button>
          <button 
            className="secondary"
            onClick={onClose}
          >
            Maybe Later
          </button>
        </div>
      )}
    </div>
  );
}

// Hook to manage add to home screen prompt
export function useAddToHomeScreen() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [hasSeenPrompt, setHasSeenPrompt] = useState(false);

  useEffect(() => {
    // Check if user has already seen the prompt
    const seen = localStorage.getItem('a2hs-seen');
    setHasSeenPrompt(!!seen);

    // Show prompt after a delay if not seen before
    if (!seen) {
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 3000); // Show after 3 seconds

      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    setShowPrompt(false);
    localStorage.setItem('a2hs-seen', 'true');
    setHasSeenPrompt(true);
  };

  const handleRemindLater = () => {
    setShowPrompt(false);
    // Don't mark as seen, show again later
    const timer = setTimeout(() => {
      setShowPrompt(true);
    }, 30000); // Remind after 30 seconds

    return () => clearTimeout(timer);
  };

  return {
    showPrompt,
    hasSeenPrompt,
    handleClose,
    handleRemindLater
  };
}