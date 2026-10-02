"use client";

/** Last line of defence: replaces the whole page when even the layout fails. Plain markup only - no app styles are guaranteed here. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", minHeight: "100dvh", placeItems: "center", margin: 0, background: "#f3f5f0", color: "#0f1511" }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", color: "#647268" }}>The panel could not be shown. Please try again.</p>
          <button onClick={reset} style={{ background: "#0c831f", color: "#fff", border: 0, borderRadius: 12, padding: "12px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
