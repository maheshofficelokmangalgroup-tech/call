import type { CSSProperties } from "react";

interface Props {
  height?: number;
  width?: number | string;
  rounded?: number;
  style?: CSSProperties;
}

/** A grey placeholder block shown while data loads (it does not shimmer). */
export function Skeleton({ height = 16, width = "100%", rounded = 8, style }: Props) {
  return <div className="skeleton" style={{ height, width, borderRadius: rounded, ...style }} aria-hidden="true" />;
}

export function RowSkeleton() {
  return (
    <div className="row-skeleton" aria-hidden="true">
      <Skeleton height={46} width={46} rounded={23} />
      <div className="row-skeleton-lines">
        <Skeleton height={14} width="55%" />
        <Skeleton height={12} width="35%" />
      </div>
    </div>
  );
}
