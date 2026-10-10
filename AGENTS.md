# GoLive agent notes

## Architecture
- npm workspaces: `packages/core`, `server`, `web`, `mobile`, and `vendor`.
- `packages/core` owns shared signaling and room-session behavior; web and mobile
  consume it through platform adapters.
- Server HTTP/WebSocket routes live in `server/src/routes/`; PostgreSQL queries
  and room state belong in `server/src/services/`.
- PostgreSQL stores rooms, guest profiles, memberships, shared HTTP rate limits,
  and expiring WebSocket connection leases. Active room state remains
  process-local.

## Security invariants
- Keep input schemas strict and bounded. Validate display names and route IDs at
  the boundary; bound WebSocket frame size, message rate, and pending queue size.
- Parameterize every user-controlled SQL value. Never build SQL identifiers or
  predicates from request strings.
- Device tokens are bearer credentials: validate their format, compare the
  stored hash, do not return profile IDs unnecessarily, and use `no-store` for
  credential/profile responses.
- Rate limits in production use the PostgreSQL store and `request.ip`. Only trust
  forwarded client IPs when `TRUST_PROXY` names the actual trusted proxy chain.
- Keep API payloads, WebSocket queues, and admin catalog pages bounded; do not
  replace the shared production rate-limit store with process-local counters.
- Room retention means no persisted memberships for 30 days; profile retention
  means no memberships and no authenticated device activity for 90 days. Do not
  expire room grants merely because a device is offline.
- Keep the Render retention job and its environment configuration in sync with
  the server cleanup script.

## Database changes
- Add migrations in numeric order under `server/db/migrations/`; update `README.md`
  and `server/CRON.md` when migrations or retention behavior changes.
- The server does not apply migrations at startup. Tests that use
  `TEST_DATABASE_URL` require all migrations applied to a disposable database.

## Verification
- Run `npm run test -w @golive/server` for server tests and
  `npm run test -w @golive/core` when shared signaling changes.
- Run `npm run typecheck -w @golive/server`; also typecheck/build affected
  workspaces when changing shared APIs.
- `server/test/catalog.routes.test.ts` requires `TEST_DATABASE_URL` and skips
  otherwise.
