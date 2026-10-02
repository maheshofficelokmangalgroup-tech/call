import * as React from "react";

import { cn, hueOf, initials } from "@/lib/utils";

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
  xl: "size-20 text-2xl",
} as const;

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string | null | undefined;
  size?: keyof typeof SIZES;
}

/** Initials on a gradient that is the same for the same person everywhere (colour is derived from the name). */
export function Avatar({ name, size = "md", className, style, ...props }: AvatarProps) {
  const hue = hueOf(name);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-[inset_0_-6px_12px_rgb(0_0_0/0.12)]", SIZES[size], className)}
      style={{ backgroundImage: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 38) % 360} 66% 40%))`, ...style }}
      {...props}
    >
      {initials(name)}
    </span>
  );
}
