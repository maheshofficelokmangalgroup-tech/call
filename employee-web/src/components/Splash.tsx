import { colors } from "@/lib/theme";

import { Icon } from "./Icon";

/** Shown while the saved session is being checked. */
export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading">
      <span className="splash-logo">
        <Icon name="phone-call" size={38} color={colors.green} />
      </span>
      <span className="spinner spinner-dark" />
    </div>
  );
}
