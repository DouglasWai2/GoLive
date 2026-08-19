# GoLive

Minimal browser-to-browser screen sharing. Fastify and WebSocket handle room
membership and WebRTC signaling; screen video and audio travel directly between
browsers.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, create a room, and open its invite link in another
browser or incognito window. Enter a different display name in each window, then
select **Share screen** in either one.

- Web app: `http://localhost:5173`
- Signaling server: `ws://localhost:3000/ws`
- Health check: `http://localhost:3000/health`

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

Screen capture is available on `localhost` during development. A deployed app
must use HTTPS and secure WebSocket (`wss://`).

## MVP constraints

- Rooms and peer state are in memory and disappear when the server restarts.
- One participant can share at a time; one peer connection is created per viewer.
- The same captured screen stream is reused for every viewer.
- Google STUN is configured, but TURN is not. Some corporate networks, symmetric
  NATs, and UDP-blocked connections will not work until a TURN service is added.
- There are no accounts, recording, chat, persistence, or reconnect recovery.
