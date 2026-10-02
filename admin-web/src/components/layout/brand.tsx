import { cn } from "@/lib/utils";

/** The app mark: a green tile with a handset and a yellow dot, like the mobile app's icon. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-10 items-center justify-center rounded-xl bg-brand shadow-[0_8px_18px_-8px_var(--brand)]", className)} aria-hidden>
      <svg viewBox="0 0 64 64" className="size-6" fill="none">
        <path
          d="M22.5 15.5c-1.4 0-2.7.7-3.4 1.9-2.3 3.9-1.4 9.8 3.3 17.7 4.7 7.9 9.6 11.6 14.2 11.7 1.4 0 2.7-.7 3.4-1.9l1.2-2c.6-1 .3-2.3-.7-3l-4-2.6c-.9-.6-2.1-.5-2.9.2l-1.4 1.3c-2.6-1.3-5.8-4.6-7.6-7.7l1.5-1.2c.9-.7 1.1-1.9.6-2.9l-1.9-4.2c-.4-1-1.4-1.6-2.4-1.6l-.1.3z"
          fill="#fff"
        />
      </svg>
      <span className="absolute -right-1 -top-1 size-3 rounded-full bg-accent ring-2 ring-surface" />
    </span>
  );
}

export function BrandName({ className }: { className?: string }) {
  const name = process.env.NEXT_PUBLIC_APP_NAME ?? "Employee Calling";
  return (
    <span className={cn("flex flex-col leading-tight", className)}>
      <span className="text-[15px] font-extrabold tracking-tight text-ink">{name}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Admin</span>
    </span>
  );
}
