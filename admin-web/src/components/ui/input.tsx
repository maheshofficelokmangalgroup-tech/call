import * as React from "react";

import { cn } from "@/lib/utils";

export const inputClasses =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 text-sm text-ink shadow-[inset_0_1px_2px_rgb(16_24_18/0.04)] transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-faint focus:border-brand focus:outline-none focus:ring-4 focus:ring-[var(--brand-ring)] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:opacity-70 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-[color-mix(in_oklab,var(--danger)_25%,transparent)]";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, type = "text", ...props }, ref) {
  return <input ref={ref} type={type} className={cn(inputClasses, "h-10", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputClasses, "min-h-24 resize-y py-2.5", className)} {...props} />;
});

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint / error message, laid out the same everywhere. */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-[13px] font-semibold text-ink-soft">
        {label}
        {required ? <span className="text-danger" aria-hidden>*</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
