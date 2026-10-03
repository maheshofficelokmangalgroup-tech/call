import type { ReactNode } from "react";

import { useGoBack } from "@/lib/useGoBack";

import { Icon } from "./Icon";
import { Text } from "./Text";

interface Props {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
}

/** Page title with an optional back button. */
export function ScreenHeader({ title, subtitle, back = false, right }: Props) {
  const goBack = useGoBack();
  return (
    <header className="screen-header">
      {back ? (
        <button type="button" className="icon-btn" onClick={goBack} aria-label="Go back" data-testid="back">
          <Icon name="arrow-left" size={22} />
        </button>
      ) : null}
      <div className="screen-titles">
        <Text variant="title" lines={1} as="h1">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" color="muted" lines={1}>
            {subtitle}
          </Text>
        ) : null}
      </div>
      {right ? <div className="screen-right">{right}</div> : null}
    </header>
  );
}
