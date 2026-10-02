import { Compass } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="mb-6 flex size-20 items-center justify-center rounded-3xl bg-brand-soft text-brand shadow-pop">
        <Compass className="size-10" strokeWidth={1.6} />
      </span>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand">Error 404</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">We could not find that page</h1>
      <p className="mt-2 max-w-md text-sm text-muted">The link may be old or mistyped. Go back to the dashboard and pick what you need from the menu.</p>
      <Link href="/dashboard" className={`${buttonVariants({ size: "lg" })} mt-8`}>
        Back to the dashboard
      </Link>
    </div>
  );
}
