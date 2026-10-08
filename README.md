# GoLive

Minimal screen sharing for web and mobile. Fastify and WebSocket handle room
membership and WebRTC signaling; screen video and audio travel directly between
peers. Web and mobile clients share a framework-agnostic core package
(`@golive/core`) that implements signaling and WebRTC room sessions. Optional
Cloudflare TURN provides relaying for connections that cannot establish a
peer-to-peer link.

## Run locally

Requirements: Node.js 22 or newer, npm, PostgreSQL, and `psql`.

```bash
npm install
cp server/.env.example server/.env
# Create the database, then set JWT_SECRET and DATABASE_URL in server/.env.
export DATABASE_URL='postgres://golive:golive@localhost:5432/golive'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/migrations/001_create_catalog.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/migrations/002_add_room_memberships.sql
npm run dev -w server # in one terminal
npm run dev -w web    # in another terminal
```

Open `http://localhost:5173`, create a room, and open its invite link in another
browser or incognito window. Enter a different display name in each window, then
select **Share screen** in either one.

- Web app: `http://localhost:5173`
- Signaling server: `ws://localhost:3000/ws`
- Health check: `http://localhost:3000/health`
- TURN credentials: `http://localhost:3000/session` (requires a room JWT)
- Create invite: `http://localhost:3000/invite` (requires a room JWT)
- Verify invite: `http://localhost:3000/invite/verify`
- Admin dashboard: `http://localhost:5173/admin` (requires `ADMIN_SECRET`)

In development the Vite server proxies `/ws` to the signaling server. Copy
the `.env.example` files into `.env` in each workspace when you need to
customize them (see [Environment variables](#environment-variables)).

### Mobile

These instructions cover Android emulators and physical Android devices. Install
Android Studio, an Android SDK/emulator, a compatible JDK, and `adb`. Run
`npm install`, configure PostgreSQL and `server/.env`, apply the migrations, and
start the signaling server and web app as described in [Run locally](#run-locally).
Keep both processes running. The mobile app uses native WebRTC, so it needs an
Expo **development build**; Expo Go cannot run it. Run all commands below from
the repository root.

#### Android emulator: build and test

1. Start an Android Virtual Device in Android Studio and check `adb devices`.
2. Build and install the development app (this also starts Metro):

   ```bash
   EXPO_PUBLIC_INVITE_URL=http://localhost:5173 npm run android -w mobile
   ```

   The default `EXPO_PUBLIC_SIGNALING_URL` is `http://10.0.2.2:3000`, the
   Android emulator's route to the host's `localhost`. The invite URL in this
   example is for links opened in a browser on the host, not in the emulator.
3. For subsequent JS/style changes, keep Metro running. If you stopped it,
   start it again with
   `EXPO_PUBLIC_INVITE_URL=http://localhost:5173 npm run start -w mobile -- --dev-client`,
   then press `a` to open the installed development app. Repeat the build
   command above after native dependency, permission, or native config changes.
   If `mobile/.env` sets a signaling URL for a physical device,
   unset it or override it with `EXPO_PUBLIC_SIGNALING_URL=http://10.0.2.2:3000`.

#### Physical Android device: build and test over Wi-Fi

1. Enable Developer options and USB debugging, connect the phone by USB, and
   confirm it appears in `adb devices` (accept the authorization prompt).
   Connect the phone and computer to the same network. Find the computer's LAN
   IPv4 address, e.g. with `ip -4 addr` on Linux. Do not use `localhost` or
   `10.0.2.2` as the signaling URL for a phone over Wi-Fi.
2. Check `http://<HOST_IP>:3000/health` in the phone's browser. Allow incoming
   TCP ports **3000** (signaling), **8081** (Metro), and **5173** (web invites)
   through the computer's firewall if needed; also check for Wi-Fi client
   isolation. You do not need to leave the firewall disabled. The server and
   Vite already listen on all interfaces by default.
3. Replace the example IP and build/install the development app:

   ```bash
   HOST_IP=192.168.1.20
   EXPO_PUBLIC_SIGNALING_URL="http://${HOST_IP}:3000" \
   EXPO_PUBLIC_INVITE_URL="http://${HOST_IP}:5173" \
   REACT_NATIVE_PACKAGER_HOSTNAME="$HOST_IP" \
   npm run android -w mobile -- --device
   ```

   Once installed, restart Metro without rebuilding (using the same `HOST_IP`
   from above):

   ```bash
   EXPO_PUBLIC_SIGNALING_URL="http://${HOST_IP}:3000" \
   EXPO_PUBLIC_INVITE_URL="http://${HOST_IP}:5173" \
   REACT_NATIVE_PACKAGER_HOSTNAME="$HOST_IP" \
   npm run start -w mobile -- --dev-client --lan
   ```

   Open the development app, scan Metro's QR code, or press `a` while the
   phone is connected by USB. Metro runs on port 8081. The `start:device`
   and `android:device` scripts contain a fixed IP; use the commands above
   unless that IP matches your computer.

To test a room, create one in the web app at `http://localhost:5173` and paste
its full invite link into the mobile app, or create the room on mobile and open
its invite link in the browser. The invite URL must point to the **web app**;
the signaling URL points to the **API**. Both clients should enter the same
room before starting screen sharing. A mobile release APK also needs the API
to be reachable, but it does not need Metro.

If Wi-Fi access is unavailable but USB debugging works, install the development
app over USB as above and forward both ports. Stop the old Metro process before
switching its host:

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000
EXPO_PUBLIC_SIGNALING_URL=http://127.0.0.1:3000 \
EXPO_PUBLIC_INVITE_URL=http://localhost:5173 \
npm run start -w mobile -- --dev-client --localhost
```

Keep USB connected and press `a` in Metro to open the installed development
app. `adb reverse --list` shows active forwards. The invite URL above is for
opening links in a browser on the host; use a reachable web origin for other
recipients.

#### Standalone Android APK (no Metro)

Build a local release APK with URLs the target device can reach. For LAN testing,
keep the server and web app running as above and set the computer's LAN IP:

```bash
HOST_IP=192.168.1.20
EXPO_PUBLIC_SIGNALING_URL="http://${HOST_IP}:3000" \
EXPO_PUBLIC_INVITE_URL="http://${HOST_IP}:5173" \
npm run build:android:release -w mobile
```

The build script runs Gradle's `:app:assembleRelease` and copies the APK to
`mobile/release/GoLive-<versionName>.apk` (the version name comes from
`mobile/android/app/build.gradle`). To build for the Android emulator instead,
use its host alias:

```bash
EXPO_PUBLIC_SIGNALING_URL=http://10.0.2.2:3000 \
EXPO_PUBLIC_INVITE_URL=http://localhost:5173 \
npm run build:android:release -w mobile
```

Install the resulting APK on an emulator or a phone with
`adb -s <DEVICE_SERIAL> install -r mobile/release/GoLive-<versionName>.apk`;
find the serial with `adb devices`. A standalone APK has its JS bundled and
must be rebuilt for changes. Set production URLs (HTTPS/WSS and a public web
origin) when building for use outside the local network.

The current Gradle `release` variant is **signed with the debug keystore** and
is only suitable for local testing. Configure production signing before
distribution (see `mobile/TODO_for_publishing.md`). Android will reject an
install if its `versionCode` is below the installed version, or if the signing
keys differ. Keep `mobile/app.json` and `mobile/android/app/build.gradle`
version codes in sync when incrementing; alternatively uninstall the existing
app before installing a differently signed local build (this deletes its app
data).

## Commands

```bash
npm run dev -w server       # signaling server
npm run dev -w web          # web app
npm run start -w mobile     # Expo dev client
npm run typecheck -w server # server typecheck (repeat for core, web, mobile)
npm run build -w server     # compiled signaling server
npm run build -w web        # production web assets
```

## Deploy

Build output is written to `server/dist` and `web/dist`. Serve `web/dist` with a
static host and run the signaling server separately. If they use different
origins, configure the browser with the full WebSocket endpoint:

```bash
VITE_SIGNALING_URL=wss://signal.example.com/ws npm run build -w web
```

Set the server-side variables on the signaling server:

- `ORIGIN=https://example.com` — the web app origin, so CORS permits it.
- `JWT_SECRET` — required for the signaling server to start. Use a
  cryptographically random secret with at least 32 bytes of entropy.
- `ADMIN_SECRET` — required only to enable the admin dashboard.
- `DATABASE_URL` — required PostgreSQL connection string. Apply the SQL migrations before starting the server.
- Cloudflare TURN credentials and analytics variables, to relay connections
  that cannot go peer-to-peer until monthly egress reaches the switch limit.
- ExpressTURN URLs and credentials, to provide the fallback relay service.

Screen capture is available on `localhost` during development. A deployed app
must use HTTPS and secure WebSocket (`wss://`).

## Environment variables

Server variables are read from `server/.env` (via `dotenv`) or the process
environment. Web variables are read by Vite from `web/.env` and must use the
`VITE_` prefix to be exposed to the browser. Mobile variables are read by Expo
from `mobile/.env` and must use the `EXPO_PUBLIC_` prefix to be inlined into the
client bundle. The `.env` files are gitignored; use the committed `.env.example`
files (server and web) as templates.

### Server (`server/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port the signaling server listens on. |
| `HOST` | `0.0.0.0` | Address the signaling server binds to. |
| `ORIGIN` | — | CORS allow-origin for the web app. Required when the web app and server are on different origins. |
| `JWT_SECRET` | — | Required secret used to sign invite, room session, and admin JWTs. The server will not start without it. |
| `ADMIN_SECRET` | — | Shared secret exchanged for a one-hour admin JWT. Admin endpoints are disabled unless this and `JWT_SECRET` are explicitly set. |
| `DATABASE_URL` | — | PostgreSQL connection string, e.g. `postgres://golive:golive@localhost:5432/golive`. Required at server startup. Use durable storage in production. |
| `CLOUDFLARE_TURN_KEY_ID` | — | Cloudflare TURN key ID used by the server. |
| `CLOUDFLARE_TURN_API_TOKEN` | — | Cloudflare API token used to generate temporary TURN credentials. |
| `CLOUDFLARE_ACCOUNT_ID` | — | Cloudflare account ID, queried for TURN usage. |
| `CLOUDFLARE_ANALYTICS_API_TOKEN` | — | Cloudflare API token with analytics read access, used for TURN usage. |
| `CLOUDFLARE_TURN_SWITCH_GB` | `950` | Monthly Cloudflare egress at which new TURN requests switch to ExpressTURN. |
| `EXPRESSTURN_URLS` | — | Comma-separated ExpressTURN URLs, for example `turn:free.expressturn.com:3478`. |
| `EXPRESSTURN_USERNAME` | — | ExpressTURN username. |
| `EXPRESSTURN_CREDENTIAL` | — | ExpressTURN password/credential. |
| `EXPRESSTURN_DISABLED` | `false` | Emergency switch preventing new ExpressTURN configurations from being returned. |

### Web (`web/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_SIGNALING_URL` | web app origin | Full signaling endpoint for WebSocket and TURN credential requests. Accepts `http`/`https`/`ws`/`wss`. |

### Admin dashboard

Open `/admin` on the web deployment and enter `ADMIN_SECRET`. The browser sends
the shared secret only to `/admin/login` and stores the returned one-hour admin
JWT in session storage. Live room, participant, and resource values represent
only the current signaling-server process and reset when it restarts. The admin
console provides CRUD for saved room IDs/names and guest profiles in
PostgreSQL. Invited devices have profiles linked to a single room; profiles
created manually by admins are unclaimed. Rooms with members cannot be deleted.
When the last member leaves, the room record is deleted. Cloudflare
TURN usage is queried separately for the current UTC month and cached for ten
minutes. Historical connection counts, cross-instance live totals, and
hosting-provider metrics are not collected.

All catalog endpoints require an admin JWT (`Authorization: Bearer <token>`):
`GET/POST /admin/rooms`, `GET/PATCH/DELETE /admin/rooms/:id`, and the same
operations under `/admin/profiles`. Rooms use `{ id, name }` on create and
`{ name }` on update; profiles use `{ name }` and receive a generated UUID.
Admins can mint invites for unclaimed rooms using `POST /admin/rooms/:id/invite`.
`POST /room` creates a *new* room and its first device membership; it cannot
claim a saved room by guessing its ID. Room IDs and device membership survive
restarts; short-lived room session tokens are renewed on return.
For a database-backed integration check, run
`TEST_DATABASE_URL=postgres://... npm run test -w server` against a disposable
PostgreSQL database after applying both SQL files there. The database user
must have permission to create tables in its schema. SQL migrations live in
`server/db/migrations/`, run in numeric order with `psql -v ON_ERROR_STOP=1`,
and record applied versions in `schema_migrations`. Re-running them is safe.
Migration 002 removes old rooms that had no verifiable owner. Run these files
before starting an upgraded server; the server only opens a database connection.

### Mobile (`mobile/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_SIGNALING_URL` | `http://10.0.2.2:3000` | Full signaling endpoint for WebSocket and TURN credential requests (the Android emulator alias for the host's `localhost`). Set it to the host's LAN IP for a physical device. |
| `EXPO_PUBLIC_INVITE_URL` | `EXPO_PUBLIC_SIGNALING_URL` | Web origin used for shareable invite links. Set it to the web app's reachable URL; the default points to the signaling server, not the web app. |

### TURN

Rooms are invite-only after creation. `POST /room` accepts a new `roomId` and
`name`, creates the room and an owner membership, and returns an eight-hour room
session JWT plus a private `deviceToken`. An existing room ID cannot be created
or claimed without an invite, even if nobody is online. The browser stores the
device credential in local storage; mobile stores it in AsyncStorage. On launch,
`GET /device/room` checks the stored credential and issues a fresh room session
for the device's single saved room. Closing the app preserves membership; tapping
**Leave** calls `DELETE /device/room` and revokes it. If the last member leaves,
the room is removed. Opening a different room's invite prompts for confirmation;
the server validates the invite before switching membership atomically.

Guests enter through a shareable invite token:

- `POST /invite` takes a `roomId` and an `Authorization: Bearer <room JWT>`
  header. Any current room member can mint a room-bound invite JWT; it expires
  after 24 hours and is reusable while that room exists.
- `POST /invite/verify` takes `{ roomId, name, inviteToken, deviceToken? }`.
  It validates the invite, enrolls the device, and returns a new room session
  and its device credential. A valid invite works across server restarts; an
  invite from a deleted room cannot be used if its ID is later reused.

The web app sends the room token as `Authorization: Bearer <token>` when
fetching ICE servers from `/session` and includes it in the WebSocket
join message, so only validated sessions can enter a room.

Peer connections start with STUN only:

- `stun:stun.cloudflare.com:3478`
- `stun:stun.l.google.com:19302`

Only after direct/STUN ICE fails does the affected participant request TURN
credentials from `/session`. The server uses Cloudflare while current-month
egress is below `CLOUDFLARE_TURN_SWITCH_GB`, then returns ExpressTURN. If
Cloudflare analytics or credential generation fails, ExpressTURN is also used.
ExpressTURN enforces its free-plan traffic cap; `EXPRESSTURN_DISABLED` provides
a manual emergency cutoff. If no relay can establish the connection, clients
show a temporary stream-unavailable message.

Every connected participant sends a ping every 30 seconds and the server replies
with a pong. This keeps idle WebSocket connections active and sends traffic to
Render while a room has connected participants. A client reconnects if its pong
does not arrive.

## Project structure

```
.
├── package.json            # npm workspaces: core, server, web, mobile scripts
├── LICENSE
├── README.md
├── packages/
│   └── core/               # @golive/core — shared signaling + WebRTC room session
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts        # public API surface (re-exports)
│           ├── types.ts        # shared types (Peer, SignalData, RoomSessionDeps, ...)
│           ├── signaling.ts    # join room + ICE server helpers
│           ├── webrtc.ts       # stats, ice route, sender config helpers
│           ├── sharePresets.ts # resolution/framerate/bitrate presets
│           ├── adapter.ts      # PlatformAdapter abstraction over screen capture
│           └── roomSession.ts  # RoomSession: WebSocket + WebRTC client logic
├── server/                 # @golive/server — Fastify signaling server
│   ├── .env.example        # template for server environment variables
│   ├── db/migrations/      # SQL files applied manually with psql
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts        # entry point: load env, build the app, listen
│       ├── app.ts          # buildApp(): Fastify, plugins, error handler, routes
│       ├── config/
│       │   └── env.ts      # centralized environment variables
│       ├── db/
│       │   └── connection.ts # PostgreSQL pool initialization
│       ├── controllers/    # request/connection handlers
│       │   ├── health.controller.ts
│       │   ├── invite.controller.ts # invite token create/verify handlers
│       │   ├── room.controller.ts
│       │   ├── signaling.controller.ts
│       │   └── turn.controller.ts
│       ├── routes/         # route definitions (health, room, invite, turn, /ws, admin CRUD)
│       │   └── index.ts
│       ├── services/       # business logic
│       │   ├── catalog.service.ts   # room/profile database queries
│       │   ├── room.service.ts      # in-memory room/peer store
│       │   ├── signaling.service.ts # WebSocket signaling protocol
│       │   └── turn.service.ts      # Cloudflare TURN credentials + usage
│       ├── middlewares/
│       │   └── error-handler.ts     # global Fastify error handler
│       ├── types/          # shared type definitions (room, message, turn)
│       └── utils/
│           └── ws.ts       # WebSocket send helper
├── web/                    # @golive/web — React + Vite client (uses @golive/core)
│   ├── .env.example        # template for web environment variables
│   ├── index.html
│   ├── package.json
│   ├── vercel.json         # rewrites /room/:path* to index.html
│   ├── vite.config.ts      # dev proxy: /ws -> ws://localhost:3000
│   └── src/
│       ├── App.tsx         # Landing -> NameGate -> Room flow
│       ├── main.tsx
│       ├── styles.css
│       ├── types.ts
│       ├── components/     # UI components (Landing, Room, VideoStage, ...)
│       ├── components/room/# room-specific UI (ControlDock, ShareSettingsPanel, ...)
│       ├── hooks/          # useRoom
│       ├── platform/       # webAdapter — PlatformAdapter for getDisplayMedia
│       ├── services/       # sessionDeps — wires RoomSession deps from @golive/core
│       └── utils/          # fullscreen, session, room
└── mobile/                 # @golive/mobile — React Native (Expo) client
    ├── App.tsx             # Landing -> NameGate -> Room flow
    ├── index.ts            # entry point: registerRootComponent
    ├── app.json            # Expo config + permissions + config plugins
    ├── babel.config.js
    ├── metro.config.js
    ├── plugins/
    │   └── withWebRTCMediaProjection.js # Expo config plugin for screen capture
    ├── android/            # native Android project (Expo prebuild output)
    └── src/
        ├── adapter.ts      # mobile PlatformAdapter (react-native-webrtc)
        ├── config.ts       # SIGNALING_URL from EXPO_PUBLIC_SIGNALING_URL
        ├── session.ts
        ├── components/     # ControlDock, ShareSheet, VideoTile
        ├── hooks/          # useRoom
        ├── screens/        # LandingScreen, NameGateScreen, RoomScreen
        └── utils/          # roomId
```

## MVP constraints

- Room IDs, profiles, and one-room-per-device membership persist in PostgreSQL.
  The migration resets old room rows, which had no verifiable owners.
- WebSocket connections and room instances are process-local. Short-lived room
  JWTs must be renewed after a restart; invite tokens remain valid for up to
  24 hours while their room exists.
- One participant can share at a time; one peer connection is created per viewer.
- The same captured screen stream is reused for every viewer.
- STUN is always available. TURN uses Cloudflare first and ExpressTURN after the
  configured Cloudflare egress threshold (see [Environment variables](#environment-variables)).
- There are no cross-device accounts, recording, chat, or participant history.
