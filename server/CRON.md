# Retention cleanup on Render

The server package builds the cleanup command at
`server/dist/scripts/cleanup-empty-rooms.js`. It performs four idempotent
cleanups:

- Delete rooms with no device memberships whose `empty_since` is older than 30
  days. A room with an access grant is retained even if nobody is online.
- Delete profiles with no room memberships and no authenticated device activity
  for 90 days. Profiles that still have room access are retained.
- Delete expired shared HTTP rate-limit counters.
- Delete expired WebSocket connection leases left by interrupted server processes.

The root `render.yaml` declares a Render Cron Job that runs daily at 03:00 UTC.
Create or update the Render Blueprint from this repository and provide
`DATABASE_URL` for the Cron Job, pointing it to the same PostgreSQL database as
the signaling server. The equivalent Dashboard settings are:

- **Build command:** `npm ci && npm run build -w @golive/core && npm run build -w @golive/server`
- **Start command:** `npm run cleanup:retention -w @golive/server`
- **Schedule:** `0 3 * * *` (daily at 03:00 UTC)
- **Environment:** set `DATABASE_URL` to the same PostgreSQL database used by the
  signaling server.

The command is safe to rerun and logs counts for each deleted record type. Apply
all SQL files in `server/db/migrations/` in numeric order before deploying the
server or enabling the job. Set `TRUST_PROXY` on the signaling service only for
the actual trusted proxy chain; do not trust arbitrary forwarded headers. If a
proxy hop count is configured, ensure the signaling service cannot be reached
directly by untrusted clients.
