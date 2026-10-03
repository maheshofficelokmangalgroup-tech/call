import { useId, useState, type HTMLInputTypeAttribute, type KeyboardEvent } from "react";

import { colors } from "@/lib/theme";

import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

interface Props {
  label?: string;
  icon?: IconName;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  /** a password box with an eye button that reveals it */
  secure?: boolean;
  multiline?: boolean;
  rows?: number;
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "tel" | "email" | "search";
  onEnter?: () => void;
  testId?: string;
  name?: string;
}

/** Text input whose border turns green on focus and red on error (instantly). */
export function TextField({
  label,
  icon,
  value,
  onChange,
  error,
  secure,
  multiline,
  rows = 4,
  type = "text",
  placeholder,
  autoComplete,
  autoFocus,
  maxLength,
  inputMode,
  onEnter,
  testId,
  name,
}: Props) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const common = {
    id,
    name,
    value,
    placeholder,
    autoComplete,
    autoFocus,
    maxLength,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
    "data-testid": testId,
    className: "field-input",
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (onEnter && event.key === "Enter" && !multiline) {
      event.preventDefault();
      onEnter();
    }
  };
  return (
    <div className="field">
      {label ? (
        <label htmlFor={id} className="field-label">
          <Text variant="smallMedium" color="inkSoft" as="span">
            {label}
          </Text>
        </label>
      ) : null}
      <div className={["field-box", multiline ? "field-multi" : "", error ? "field-error" : ""].filter(Boolean).join(" ")}>
        {icon ? <Icon name={icon} size={20} color={colors.muted} /> : null}
        {multiline ? (
          <textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input {...common} type={secure && !reveal ? "password" : secure ? "text" : type} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
        )}
        {secure ? (
          <button type="button" className="field-eye" onClick={() => setReveal((v) => !v)} aria-label={reveal ? "Hide password" : "Show password"}>
            <Icon name={reveal ? "eye-off" : "eye"} size={20} color={colors.muted} />
          </button>
        ) : null}
      </div>
      {error ? (
        <Text variant="small" color="red" id={`${id}-error`} className="field-message" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
