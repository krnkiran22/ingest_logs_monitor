# Build AI Ingest Monitor Dashboard

This app is a dedicated frontend for `apps/buildai-ingest`.

It only visualizes data that already exists in the current ingest fleet:

- aggregator health and fleet JSON
- server upload-daemon JSON
- mini `agent.log`, `agent.err`, `nic.log`, `nic.err`
- server `journalctl -u upload-daemon`
- aggregator `journalctl -u aggregator`

## Environment

Create `.env.local` from `.env.example`.

```bash
BUILD_AI_INGEST_MINI_PASSWORD=...
BUILD_AI_INGEST_SERVER_PASSWORD=...
INGEST_AGGREGATOR_URL=http://10.0.3.66:8080
INGEST_REMOTE_NETWORK=primary
```

`INGEST_REMOTE_NETWORK=primary` uses the primary host from the catalog.

`INGEST_REMOTE_NETWORK=secondary` uses the alternate host from the catalog.

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.
