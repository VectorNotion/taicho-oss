'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

// Spring presets for different feels
const springs = {
  snappy: { type: 'spring', stiffness: 400, damping: 30 } as const,
  bouncy: { type: 'spring', stiffness: 300, damping: 20 } as const,
  gentle: { type: 'spring', stiffness: 200, damping: 25 } as const,
};

interface AnimatedToolProps {
  children: ReactNode;
  delay?: number;
}

// Slide in from left with spring physics
export function AnimatedTool({ children, delay = 0 }: AnimatedToolProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        ...springs.snappy,
        delay,
      }}
    >
      {children}
    </motion.div>
  );
}

// Staggered list with slide-in from left
interface AnimatedListProps {
  children: ReactNode[];
  baseDelay?: number;
  staggerDelay?: number;
}

export function AnimatedList({ children, baseDelay = 0.08, staggerDelay = 0.06 }: AnimatedListProps) {
  return (
    <div className="space-y-2">
      {children.map((child, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            ...springs.snappy,
            delay: baseDelay + index * staggerDelay,
          }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  );
}

// Progress animation - slide in from left
export function AnimatedProgress({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -16, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={springs.snappy}
    >
      {children}
    </motion.div>
  );
}

// Icon pop-in animation (for success states)
export function AnimatedIcon({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={springs.bouncy}
    >
      {children}
    </motion.div>
  );
}
