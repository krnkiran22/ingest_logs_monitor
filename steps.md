# Sentry Setup Steps

This is the exact CLI flow for the Next.js dashboard in:

- `apps/buildai-ingest/ingest-monitor-dashboard`

## Important

Do not paste tokens into chat or commit them into the repo.

If a token was pasted already, rotate it in Sentry before continuing.

## Current Known Values

- org slug: `build-ai-d5`
- project slug: `buildai-ingest-monitor-dashboard`

## Why You Must Run The Wizard Yourself

The Sentry Next.js wizard is interactive.

It can:

- open a browser
- ask for confirmation
- write config files based on your choices

So you should run it in your terminal, then send me the result and I will clean up and verify the integration.

## Step 1: Go To The Dashboard App

```bash
cd /Users/kiran/Desktop/ingestion/apps/buildai-ingest/ingest-monitor-dashboard
```

## Step 2: Run The Wizard

Run:

```bash
npx @sentry/wizard@latest -i nextjs --saas --org build-ai-d5 --project buildai-ingest-monitor-dashboard
```

## Step 3: What To Choose In The Wizard

Use these choices:

1. Org:
   - `build-ai-d5`
2. Project:
   - `buildai-ingest-monitor-dashboard`
3. Error monitoring:
   - yes
4. Tracing / performance:
   - yes
5. Source maps:
   - yes
6. Session Replay:
   - optional
   - choose yes if you want frontend session replays
   - choose no if you want the leanest initial setup

Recommended baseline:

- Error Monitoring: yes
- Tracing: yes
- Source Maps: yes
- Session Replay: optional

## Step 4: After The Wizard Finishes

Run:

```bash
git status --short
```

Then send me:

1. the full `git status --short` output
2. any important wizard terminal output
3. whether it completed successfully or failed

## Step 5: If The Wizard Fails

Send me:

1. the full terminal error
2. the output of:

```bash
git status --short
```

3. the output of:

```bash
cat package.json | grep -E '"next"|"@sentry/'
```

## Expected Changes The Wizard May Add

It may create or modify files like:

- `instrumentation.ts`
- `instrumentation-client.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `next.config.ts`
- env files
- global error boundary wiring
- optional example or test page

## What I Will Do After You Send The Result

I will:

1. review the wizard changes
2. remove anything unnecessary or noisy
3. keep the integration clean for this repo
4. verify lint and build
5. make sure the dashboard still behaves correctly
y
## Phase 2 Later

After the dashboard is done, we can add Sentry to:

- `apps/buildai-ingest/aggregator`
- `apps/buildai-ingest/upload-daemon`
- `apps/buildai-ingest/ingest-agent`
