# Vercel Deployment

This dashboard is a standalone Next.js app inside the repo:

- `apps/buildai-ingest/ingest-monitor-dashboard`

## 1. Create The Vercel Project

1. Import the Git repository into Vercel.
2. Create a new project for this app.
3. Set the **Root Directory** to:

```text
apps/buildai-ingest/ingest-monitor-dashboard
```

4. Keep the framework preset as **Next.js**.

## 2. Environment Variables

Add these environment variables in Vercel for Preview and Production:

```text
BUILD_AI_INGEST_MINI_PASSWORD=<your-mini-password>
BUILD_AI_INGEST_SERVER_PASSWORD=<your-server-password>
BUILD_AI_INGEST_WORKER_API_KEY=<your-worker-api-key>
INGEST_AGGREGATOR_URL=http://10.0.3.66:8080
INGEST_BACKEND_BASE_URL=https://<your-private-ingest-backend>
INGEST_REMOTE_NETWORK=secondary
NEXT_PUBLIC_INGEST_DIRECT_BASE_URL=http://ingest-server-01.taila4bcf0.ts.net:8080

NEXT_PUBLIC_SENTRY_DSN=<your-sentry-dsn>
SENTRY_DSN=<your-sentry-dsn>
SENTRY_ORG=build-ai-d5
SENTRY_PROJECT=buildai-ingest-monitor-dashboard
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=1
SENTRY_TRACES_SAMPLE_RATE=1
```

Optional but recommended for release and source map uploads:

```text
SENTRY_AUTH_TOKEN=<your-sentry-auth-token>
```

## 3. Build Settings

The app already includes the right scripts:

- Install command: default
- Build command: `npm run build`
- Output: default for Next.js

## 4. Deploy

Trigger the first deployment from Vercel.

After it is live:

1. open the dashboard URL
2. move around the app a bit
3. open this route once:

```text
/api/sentry-test
```

That should create:

- an error event
- frontend page-load transactions
- navigation transactions
- server transactions from app requests

## 5. What To Expect In Sentry

Sentry surfaces fill from different signal types:

- **Issues** fill from captured errors
- **Performance** fills from page loads, navigations, and traced server requests
- **Releases** fill only if `SENTRY_AUTH_TOKEN` is provided and source map upload/release automation is active

If you only send one manual error, you will usually see:

- the issue
- maybe limited charts

You need real traffic after deployment for the graphs to look populated.

## 6. Fast Verification Checklist

After deploy:

1. open the dashboard home page
2. switch between a few machines
3. leave the page open for log polling
4. call `/api/sentry-test`
5. check Sentry for:
   - the new error event
   - page load transactions
   - navigation transactions
   - request traces

## 7. If Graphs Still Look Empty

Check these first:

1. the deployed app is using the production DSN
2. `NEXT_PUBLIC_SENTRY_DSN` is set in Vercel
3. `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=1`
4. the site has actually received fresh traffic after deployment
5. you are looking at the correct Sentry project and environment

## 8. Private Network Requirement

This dashboard can run in two modes:

1. **Self-hosted inside the ingest network**
   - the built-in Next.js routes can SSH to minis and servers directly
2. **Frontend on Vercel via existing ingest backend**
   - set `NEXT_PUBLIC_INGEST_DIRECT_BASE_URL`
   - browser requests go directly to the existing aggregator and machine status APIs
   - this requires the viewer's device to be on Tailscale
   - this mode shows live status data from the existing ingest surfaces
3. **Frontend on Vercel via a private proxy backend**
   - set `INGEST_BACKEND_BASE_URL`
   - that backend must run inside your ingest or Tailscale network
   - Vercel should call that backend instead of SSH-ing to `.local`, LAN, or Tailnet-only hosts directly
## 9. Cost Note

`1.0` trace sampling is useful for initial validation.

Once the dashboard is stable and receiving regular traffic, reduce:

```text
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.2
SENTRY_TRACES_SAMPLE_RATE=0.2
```

to control event volume.
