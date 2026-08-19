# GoLive

Minimal browser-to-browser screen sharing. Fastify and WebSocket handle room
membership and WebRTC signaling; screen video and audio travel directly between
browsers. Optional Cloudflare TURN provides relaying for connections that
cannot establish a peer-to-peer link.

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
- TURN credentials: `http://localhost:3000/turn-credentials`

In development the Vite server proxies `/ws` to the signaling server, so no
configuration is required. Copy the `.env.example` files into `.env` in each
workspace when you need to customize them (see [Environment variables](#environment-variables)).

## Commands

```bash
npm run dev        # run server and web app
npm run typecheck  # check both workspaces
npm run build      # compile server and production web assets
npm start          # run the compiled signaling server
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
- `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` — to enable TURN
  relaying for connections that can't go peer-to-peer.

Screen capture is available on `localhost` during development. A deployed app
must use HTTPS and secure WebSocket (`wss://`).

## Environment variables

Server variables are read from `server/.env` (via `dotenv`) or the process
environment. Web variables are read by Vite from `web/.env` and must use the
`VITE_` prefix to be exposed to the browser. Both `.env` files are gitignored;
use the committed `.env.example` files as templates.

### Server (`server/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port the signaling server listens on. |
| `HOST` | `0.0.0.0` | Address the signaling server binds to. |
| `ORIGIN` | — | CORS allow-origin for the web app. Required when the web app and server are on different origins. |
| `CLOUDFLARE_TURN_KEY_ID` | — | Cloudflare TURN key ID, sent to `/turn-credentials`. |
| `CLOUDFLARE_TURN_API_TOKEN` | — | Cloudflare TURN API token, sent to `/turn-credentials`. |

### Web (`web/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_SIGNALING_URL` | web app origin | Full signaling endpoint for WebSocket and TURN credential requests. Accepts `http`/`https`/`ws`/`wss`. |

### TURN

When `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` are set, the web app
fetches ICE servers from `/turn-credentials` before starting a peer connection.
Otherwise it falls back to STUN-only:

- `stun:stun.cloudflare.com:3478`
- `stun:stun.l.google.com:19302`

TURN adds resilience on symmetric NATs, corporate networks, and UDP-blocked
connections, at the cost of relaying traffic through Cloudflare.

## Project structure

```
.
├── package.json            # npm workspaces: dev/build/typecheck/start scripts
├── LICENSE
├── README.md
├── server/                 # @golive/server — Fastify signaling server
│   ├── .env.example        # template for server environment variables
│   ├── package.json
│   └── src/
│       ├── app.ts          # Fastify app, CORS, /health, /turn-credentials, listen
│       ├── signaling.ts    # WebSocket /ws endpoint, room signaling protocol
│       └── rooms.ts        # in-memory room and peer store
└── web/                    # @golive/web — React + Vite client
    ├── .env.example        # template for web environment variables
    ├── index.html
    ├── package.json
    ├── vercel.json         # rewrites /room/:path* to index.html
    ├── vite.config.ts      # dev proxy: /ws -> ws://localhost:3000
    └── src/
        ├── App.tsx         # Landing -> NameGate -> Room flow
        ├── main.tsx
        ├── styles.css
        ├── types.ts
        ├── components/     # UI components (Landing, Room, VideoStage, ...)
        ├── components/room/# room-specific UI (ControlDock, ShareSettingsPanel, ...)
        ├── hooks/          # useRoom
        ├── services/       # roomSession — WebSocket + WebRTC client logic
        └── utils/          # signaling, webrtc, sharePresets, fullscreen, room
```

## MVP constraints

- Rooms and peer state are in memory and disappear when the server restarts.
- One participant can share at a time; one peer connection is created per viewer.
- The same captured screen stream is reused for every viewer.
- STUN is always available; TURN works only when the Cloudflare credentials are
  configured (see [Environment variables](#environment-variables)).
- There are no accounts, recording, chat, persistence, or reconnect recovery.
