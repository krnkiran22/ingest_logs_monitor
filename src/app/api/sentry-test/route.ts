import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const error = new Error("Manual Sentry test from ingest monitor dashboard");
  const eventId = Sentry.captureException(error, {
    tags: {
      source: "api-sentry-test",
    },
  });

  await Sentry.flush(2000);

  return Response.json(
    {
      ok: false,
      eventId,
      message: error.message,
    },
    { status: 500 },
  );
}
