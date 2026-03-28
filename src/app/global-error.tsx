"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen max-w-[720px] flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="rounded-[28px] border border-border bg-card px-8 py-10 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Build AI
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">
              Dashboard error
            </h1>
            <p className="mt-3 max-w-[34ch] text-sm text-muted-foreground">
              The dashboard hit an unexpected failure. The error was reported to
              Sentry if monitoring is configured.
            </p>
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="mt-6 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90"
            >
              Retry
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
