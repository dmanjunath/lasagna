import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './sidebar';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  onNewPlan?: () => void;
}

export function MobileNav({ isOpen, onClose, onNewPlan }: MobileNavProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-y-0 left-0 z-50 md:hidden"
          >
            <Sidebar
              onNewPlan={() => {
                onNewPlan?.();
                onClose();
              }}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className="md:hidden fixed top-4 left-4 z-30 w-10 h-10 rounded-xl bg-surface-solid border border-border flex items-center justify-center"
    >
      <span className="text-lg">☰</span>
    </motion.button>
  );
}
