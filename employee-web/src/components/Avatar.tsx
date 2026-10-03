import { avatarColors, initials } from "@/lib/format";

import { Icon } from "./Icon";

interface Props {
  name: string;
  size?: number;
}

/** Coloured initials - the colour is derived from the name so a contact always looks the same. */
export function Avatar({ name, size = 48 }: Props) {
  const [bg, fg] = avatarColors(name);
  const numberOnly = /^[\d\s+()*#.-]*$/.test(name.trim()); // "+1 (415) 555-0131" has no initials: show a person instead
  return (
    <span className="avatar" style={{ width: size, height: size, backgroundColor: bg, color: fg, fontSize: size * 0.38 }} aria-hidden="true">
      {numberOnly ? <Icon name="user" size={size * 0.46} strokeWidth={2.4} /> : initials(name)}
    </span>
  );
}
