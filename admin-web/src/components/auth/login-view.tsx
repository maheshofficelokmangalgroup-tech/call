"use client";

import { ArrowRight, Eye, EyeOff, Headphones, Lock, ShieldCheck, Sparkles, User, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { BrandMark } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ApiError, authRequest } from "@/lib/api";
import { useIsClient } from "@/lib/hooks";

const FEATURES = [
  { icon: Users, title: "Every employee, live", text: "See who is on a call right now, how many calls they made and for how long." },
  { icon: Headphones, title: "Recordings and timing", text: "Open any call: who was called, when it started, how long it lasted, and the recording." },
  { icon: ShieldCheck, title: "Private and audited", text: "Role-based access, signed recording links and a full audit trail." },
];

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : "/dashboard";
}

function Waveform() {
  return (
    <div className="flex h-10 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: 34 }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom animate-eq rounded-full bg-white/70"
          style={{ height: `${20 + ((i * 37) % 80)}%`, animationDelay: `${(i % 9) * 0.12}s`, animationDuration: `${0.9 + (i % 5) * 0.18}s` }}
        />
      ))}
    </div>
  );
}

export function LoginView() {
  const router = useRouter();
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shake, setShake] = React.useState(0);
  const ready = useIsClient();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await authRequest("login", { identifier, password });
      // read when it is needed, not with a hook: the page can then be built on the server (no blank screen while the script loads)
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 429
          ? `Too many attempts. Try again in ${e.retryAfter ?? 60} seconds.`
          : e instanceof ApiError
            ? e.message
            : "Something went wrong. Please try again.";
      setError(message);
      setShake((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 min-h-dvh lg:grid-cols-[1.08fr_1fr]">
      {/* brand panel */}
      <section className="mesh relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="grid-fade absolute inset-0 opacity-60" />
        <div className="absolute -left-24 -top-24 size-[420px] animate-drift rounded-full bg-accent/40 blur-3xl" />
        <div className="absolute -bottom-32 right-0 size-[480px] animate-drift rounded-full bg-emerald-300/25 blur-3xl [animation-delay:-8s]" />

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="relative flex items-center gap-3">
          <BrandMark className="bg-white/15 backdrop-blur" />
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight">{process.env.NEXT_PUBLIC_APP_NAME ?? "Employee Calling"}</p>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Admin panel</p>
          </div>
        </motion.div>

        <div className="relative max-w-xl">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur">
              <Sparkles className="size-3.5 text-accent" /> Calls, talk time and recordings in one place
            </div>
            <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight xl:text-6xl">
              Every call.
              <br />
              <span className="text-accent">Every employee.</span>
              <br />
              One clear view.
            </h1>
            <div className="mt-8 opacity-90">
              <Waveform />
            </div>
          </motion.div>

          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, title, text }, i) => (
              <motion.li key={title} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 + i * 0.12, duration: 0.55, ease: [0.22, 1, 0.36, 1] }} className="flex gap-4">
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 backdrop-blur">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block text-[15px] font-bold">{title}</span>
                  <span className="block text-sm text-white/75">{text}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">Employees sign in on the mobile app. This panel is for administrators and managers.</p>
      </section>

      {/* form */}
      <section className="relative flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="absolute inset-0 -z-10 lg:hidden mesh opacity-[0.12]" />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <p className="text-lg font-extrabold tracking-tight text-ink">{process.env.NEXT_PUBLIC_APP_NAME ?? "Employee Calling"}</p>
          </div>

          <h2 className="text-3xl font-extrabold tracking-tight text-ink">Welcome back</h2>
          <p className="mt-2 text-sm text-muted">Sign in with your email or employee ID to open the panel.</p>

          <motion.form
            key={shake}
            onSubmit={submit}
            // if the page is submitted before its script has loaded, the browser must not put the password in the address
            method="post"
            data-ready={ready}
            noValidate
            animate={shake ? { x: [0, -10, 10, -7, 7, -3, 3, 0] } : undefined}
            transition={{ duration: 0.45 }}
            className="mt-8 space-y-5"
            data-testid="login-form"
          >
            <Field label="Email or employee ID" htmlFor="identifier">
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input
                  id="identifier"
                  name="identifier"
                  autoComplete="username"
                  autoFocus
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="h-12 pl-10"
                  placeholder="admin@company.com"
                  aria-invalid={!!error}
                />
              </div>
            </Field>
            <Field label="Password" htmlFor="password">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input
                  id="password"
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-10 pr-12"
                  placeholder="Your password"
                  aria-invalid={!!error}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            <AnimatePresence initial={false}>
              {error ? (
                <motion.p
                  key="error"
                  role="alert"
                  data-testid="login-error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger"
                >
                  {error}
                </motion.p>
              ) : null}
            </AnimatePresence>

            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!identifier.trim() || !password} data-testid="login-submit">
              Sign in <ArrowRight className="size-4" />
            </Button>
          </motion.form>

          <p className="mt-8 text-center text-xs text-faint">Forgot your password? Ask another administrator to reset it from the Employees page.</p>
        </motion.div>
      </section>
    </div>
  );
}
