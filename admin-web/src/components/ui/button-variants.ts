import { cva } from "class-variance-authority";

/**
 * The look of a button. It lives apart from <Button> (which is a client component) so that server-rendered pages,
 * such as the "page not found" screen, can style a link like a button.
 */
export const buttonVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[transform,box-shadow,background-color,color,border-color,opacity] duration-200 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-white shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_6px_14px_-6px_var(--brand)] hover:bg-brand-strong hover:shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_10px_22px_-8px_var(--brand)] dark:text-[#04130a]",
        accent: "bg-accent text-[#2a2100] shadow-[0_6px_14px_-8px_rgb(217_150_0/0.8)] hover:brightness-95",
        secondary: "border border-line-strong bg-surface text-ink shadow-card hover:bg-surface-2 hover:border-line-strong",
        soft: "bg-brand-soft text-brand-strong hover:brightness-[0.97]",
        ghost: "text-ink-soft hover:bg-surface-3 hover:text-ink",
        danger: "bg-danger text-white shadow-[0_6px_14px_-8px_var(--danger)] hover:brightness-95",
        "danger-soft": "bg-danger-soft text-danger hover:brightness-[0.97]",
        link: "h-auto rounded-md p-0 text-brand underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        xs: "h-7 px-2.5 text-xs",
        sm: "h-9 px-3.5 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
        "icon-sm": "size-8 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);
