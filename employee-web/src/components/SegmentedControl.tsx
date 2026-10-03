import { Text } from "./Text";

interface Props<T extends string> {
  options: { key: T; label: string; badge?: number }[];
  value: T;
  onChange: (key: T) => void;
}

/** Two/three-way switch; the active option is filled straight away (no animation). */
export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={["segment", active ? "segment-on" : ""].filter(Boolean).join(" ")}
            onClick={() => onChange(option.key)}
            data-testid={`segment-${option.key}`}
          >
            <Text variant="bodyMedium" as="span" className="segment-label">
              {option.label}
            </Text>
            {option.badge ? <span className="segment-badge">{option.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
