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
- Only one participant can share a screen per room. WebRTC carries media
  peer-to-peer; the server handles signaling and membership.
- `neon.ts` declares Neon configuration and enables Auth. Preserve existing
  settings when changing that configuration.

## Local development
- Requires Node.js 22+, npm, and Docker. The server requires `DATABASE_URL` and
  `JWT_SECRET`; see `server/.env.example`.
- `npm run db:start` starts local PostgreSQL and applies all migrations;
  `npm run db:stop` stops it.
- Run the server and web app separately with `npm run dev -w @golive/server`
  and `npm run dev -w @golive/web`.
- Mobile uses native `react-native-webrtc`; Expo Go is unsupported. Use an Expo
  development build and follow the Android setup in `README.md`.

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
- There are no root-level test, lint, or format scripts. Run checks for the
  affected workspaces.
- Run `npm run test -w @golive/server` for server tests and
  `npm run test -w @golive/core` when shared signaling changes.
- Individual tests can be run with
  `npm exec -w @golive/core -- tsx --test test/roomSession.test.ts` or
  `npm exec -w @golive/server -- tsx --test test/invite.routes.test.ts`.
- Run `npm run typecheck -w @golive/server`; also typecheck/build affected
  workspaces when changing shared APIs.
- Build affected workspaces with `npm run build -w <workspace>` where available.
- `server/test/catalog.routes.test.ts` requires `TEST_DATABASE_URL` and skips
  otherwise.

## Change boundaries
- Keep browser/native media APIs in their platform adapters and shared session
  behavior in `packages/core`.
- When changing shared core APIs or signaling messages, check all consumers
  (`server`, `web`, and `mobile`) and run their typechecks and relevant tests.
