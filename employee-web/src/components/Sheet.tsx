import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./Icon";
import { Text } from "./Text";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

const FOCUSABLE = "input, textarea, select, button, [href], [tabindex]:not([tabindex='-1'])";

/** A panel that slides up from the bottom on a phone and sits in the middle on a computer (both appear at once, without animation). */
export function Sheet({ open, onClose, title, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  // the page passes a new onClose on every render; keeping it in a ref means the effect below runs once per opening, so the
  // focus is not pulled out of a text box each time the page behind the sheet refreshes its data
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    // a text box is the first thing to type into; otherwise the first control in the sheet gets the focus
    const target = panel.current?.querySelector<HTMLElement>("textarea, input") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close.current()}>
      <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <Text variant="h2" as="h2">
            {title}
          </Text>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => close.current()} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
