import { motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

const pageVariants: Variants = {
  enter: {
    opacity: 0,
    x: 60,
  },
  center: {
    opacity: 1,
    x: 0,
  },
  exit: {
    opacity: 0,
    x: -60,
  },
};

const pageTransition = {
  type: 'tween' as const,
  ease: [0.32, 0.72, 0, 1],
  duration: 0.28,
};

interface AnimatedScreenProps {
  children: ReactNode;
  /** Unique key for AnimatePresence to track mount/unmount */
  key?: string;
  /** Unique key for AnimatePresence to track mount/unmount */
  screenKey: string;
  /** Optional custom class names */
  className?: string;
}

export default function AnimatedScreen({ children, screenKey, className }: AnimatedScreenProps) {
  return (
    <motion.div
      key={screenKey}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={pageTransition}
      className={className}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}
