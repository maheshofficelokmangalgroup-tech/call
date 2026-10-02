"use client";

import { animate, useInView, useMotionValue, useReducedMotion } from "motion/react";
import * as React from "react";

/** A number that counts up to its value (and from the old value to a new one when the data refreshes). */
export function NumberTicker({
  value,
  format = (n: number) => Math.round(n).toLocaleString("en-IN"),
  duration = 1.1,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const motionValue = useMotionValue(0);
  const formatRef = React.useRef(format);
  React.useEffect(() => {
    formatRef.current = format;
  });

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.textContent = formatRef.current(value);
      return;
    }
    if (!inView && motionValue.get() === 0) {
      node.textContent = formatRef.current(0);
      return;
    }
    const controls = animate(motionValue, value, {
      duration: motionValue.get() === 0 ? duration : 0.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        node.textContent = formatRef.current(latest);
      },
    });
    return () => controls.stop();
  }, [value, inView, reduce, duration, motionValue]);

  return (
    <span ref={ref} className={className} aria-label={format(value)}>
      {format(reduce ? value : 0)}
    </span>
  );
}
