import { useMemo, useState } from "react";

import { colors } from "@/lib/theme";
import { callbackPresets, formatDateTime, fromLocalInputValue, toLocalInputValue } from "@/lib/time";

import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { Text } from "./Text";

interface Props {
  value: number | null;
  onChange: (ms: number) => void;
}

/** "When should we call back?" - quick presets plus a date & time field. */
export function CallbackPicker({ value, onChange }: Props) {
  const presets = useMemo(() => callbackPresets(), []);
  const matchesPreset = presets.some((p) => value !== null && Math.abs(p.at - value) < 60_000);
  const [custom, setCustom] = useState(false);
  const showField = custom || (value !== null && !matchesPreset);

  return (
    <div>
      <div className="chips">
        {presets.map((preset) => (
          <Chip
            key={preset.key}
            label={preset.label}
            selected={value !== null && Math.abs(preset.at - value) < 60_000}
            onClick={() => {
              setCustom(false);
              onChange(preset.at);
            }}
            tone={colors.blue}
            toneSoft={colors.blueSoft}
          />
        ))}
        <Chip label="Pick date & time" icon="calendar-clock" selected={showField} tone={colors.blue} toneSoft={colors.blueSoft} onClick={() => setCustom(true)} testId="callback-custom" />
      </div>
      {showField ? (
        <label className="datetime">
          <Text variant="smallMedium" color="inkSoft" as="span">
            Date and time
          </Text>
          <input
            type="datetime-local"
            className="datetime-input"
            value={value !== null ? toLocalInputValue(value) : ""}
            min={toLocalInputValue(Date.now())}
            onChange={(event) => {
              const ms = fromLocalInputValue(event.target.value);
              if (ms !== null) onChange(ms);
            }}
            data-testid="callback-datetime"
          />
        </label>
      ) : null}
      {value !== null ? (
        <div className="chosen">
          <Icon name="clock" size={18} color={colors.blue} />
          <Text variant="bodyMedium" color={colors.blue}>
            {formatDateTime(value)}
          </Text>
        </div>
      ) : null}
    </div>
  );
}
