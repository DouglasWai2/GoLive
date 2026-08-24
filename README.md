# GoLive

Minimal screen sharing for web and mobile. Fastify and WebSocket handle room
membership and WebRTC signaling; screen video and audio travel directly between
peers. Web and mobile clients share a framework-agnostic core package
(`@golive/core`) that implements signaling and WebRTC room sessions. Optional
Cloudflare TURN provides relaying for connections that cannot establish a
peer-to-peer link.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm install
cp server/.env.example server/.env
npm run dev
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

In development the Vite server proxies `/ws` to the signaling server, so no
configuration is required. Copy the `.env.example` files into `.env` in each
workspace when you need to customize them (see [Environment variables](#environment-variables)).

### Mobile

Run the signaling server and web app as above, then start the Expo dev client
for the mobile app. The mobile app defaults to the Android emulator alias for
the host's `localhost`; point it at the host machine's LAN IP when using a
physical device:

```bash
EXPO_PUBLIC_SIGNALING_URL=http://192.168.1.20:3000 npm run dev:mobile
```

## Commands

```bash
npm run dev         # run server and web app
npm run dev:mobile  # start the Expo dev client for the mobile app
npm run typecheck   # check core, server, web, and mobile
npm run build       # compile core, server, and production web assets
npm start           # run the compiled signaling server
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
| `JWT_SECRET` | — | Secret used to sign room session JWTs. Authenticates `/session` and WebSocket room joins. |
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

### Mobile (`mobile/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_SIGNALING_URL` | `http://10.0.2.2:3000` | Full signaling endpoint for WebSocket and TURN credential requests (the Android emulator alias for the host's `localhost`). Set it to the host's LAN IP for a physical device. |

### TURN

Rooms are invite-only. The first person to join a room creates it and becomes
its host: `POST /room` accepts a `roomId` and `name` and returns a room session
JWT bound to both, but only works before a host exists.

Guests enter through a shareable invite token:

- `POST /invite` takes a `roomId` and an `Authorization: Bearer <room JWT>`
  header. Any room member can mint an invite JWT for their own room; it expires
  after 24 hours and is reusable.
- `POST /invite/verify` takes `{ roomId, name, inviteToken }`. It validates the
  invite and returns the same `{ session, token }` shape as `POST /room`, so
  only holders of a valid invite can obtain a room session.

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

One participant per room sends a ping every minute and the server replies with
pong to keep the Render service active. The creator owns this heartbeat while
connected; a connected guest is elected temporarily when the creator leaves or
misses the heartbeat lease. The creator reclaims it after resuming activity.

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
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts        # entry point: load env, build the app, listen
│       ├── app.ts          # buildApp(): Fastify, plugins, error handler, routes
│       ├── config/
│       │   └── env.ts      # centralized environment variables
│       ├── controllers/    # request/connection handlers
│       │   ├── health.controller.ts
│       │   ├── invite.controller.ts # invite token create/verify handlers
│       │   ├── room.controller.ts
│       │   ├── signaling.controller.ts
│       │   └── turn.controller.ts
│       ├── routes/         # route definitions (health, room, invite, turn, /ws)
│       │   └── index.ts
│       ├── services/       # business logic
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

- Rooms and peer state are in memory and disappear when the server restarts.
- Host and invite state are also in memory: invite tokens are stateless JWTs,
  but the host claim (and the 403 on `POST /room`) resets on restart.
- The web and mobile clients do not mint or verify invites yet — they still
  copy the plain `/room/<id>` link and join via `POST /room`.
- One participant can share at a time; one peer connection is created per viewer.
- The same captured screen stream is reused for every viewer.
- STUN is always available. TURN uses Cloudflare first and ExpressTURN after the
  configured Cloudflare egress threshold (see [Environment variables](#environment-variables)).
- There are no accounts, recording, chat, persistence, or reconnect recovery.
