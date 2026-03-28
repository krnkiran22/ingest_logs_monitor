import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const tracesSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "1",
);

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate,
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration()],
    initialScope: {
      tags: {
        app: "buildai-ingest-monitor-dashboard",
        surface: "ingest-monitor-dashboard",
      },
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
