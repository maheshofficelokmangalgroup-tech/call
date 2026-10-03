import { dismiss, useToasts, type ToastKind } from "@/lib/toast";

import { Icon, type IconName } from "./Icon";

const ICON: Record<ToastKind, IconName> = { success: "check-circle", error: "alert", info: "info", warning: "alert" };

/** Short messages at the bottom of the screen (no sliding or fading). */
export function ToastHost() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => (
        <button key={item.id} type="button" className={`toast toast-${item.kind}`} onClick={() => dismiss(item.id)}>
          <Icon name={ICON[item.kind]} size={18} />
          <span>{item.text}</span>
        </button>
      ))}
    </div>
  );
}
