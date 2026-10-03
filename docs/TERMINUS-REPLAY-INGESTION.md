# Terminus Replay Ingestion

The scheduled `/api/cron/terminus-replay-ingest` route fetches the curated
Terminus Maximus replay library, normalizes candidates, and stages or publishes
them through the shared external-replay ingest path.

## Visibility

Terminus Maximus replays are community data and public by design (operator
ruling 2026-09-04); changing this would change the audience for community data.
