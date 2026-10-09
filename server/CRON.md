# Empty room cleanup on Render

The server package builds a cleanup command at `server/dist/scripts/cleanup-empty-rooms.js`.
It deletes only room records with no device memberships and an `empty_since`
timestamp older than 30 days. Rooms with authorized members are retained even
when nobody is connected.

Create a Render **Cron Job** from this repository with:

- **Build command:** `npm ci && npm run build -w @golive/core && npm run build -w @golive/server`
- **Start command:** `npm run cleanup:empty-rooms -w @golive/server`
- **Schedule:** `0 3 * * *` (daily at 03:00 UTC)
- **Environment:** set `DATABASE_URL` to the same PostgreSQL database used by the
  signaling server.

The command is safe to rerun and logs how many room records it removed. Apply all
SQL files in `server/db/migrations/` in numeric order before deploying the new
server build.
