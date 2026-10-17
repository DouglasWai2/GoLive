# GoLive

Multi-participant screen sharing for web and mobile. Fastify and WebSocket handle
room membership and WebRTC signaling; screen video and audio travel directly
between peers. Web and mobile clients share a framework-agnostic core package
(`@golive/core`) that implements signaling and WebRTC room sessions. Optional
Google sign-in uses Managed Neon Auth for account-backed room ownership and
quotas; guest access remains available when auth is not configured. Optional
Cloudflare TURN provides relaying for connections that cannot establish a
peer-to-peer link.

## Run locally

Requirements: Node.js 22 or newer, npm, and Docker.

```bash
npm install
npm run db:start
cp server/.env.example server/.env
# Set JWT_SECRET and DATABASE_URL in server/.env.
# DATABASE_URL=postgres://golive:golive@localhost:5432/golive
npm run dev -w server # in one terminal
npm run dev -w web    # in another terminal
```

The database runs in a Docker container and keeps its data in the
`golive-local-postgres-data` volume. Start it again with `npm run db:start`; stop
it with `npm run db:stop`.

Open `http://localhost:5173`, create a room, and open its invite link in another
browser or incognito window. Enter a different display name in each window, then
select **Share screen** in either one. Other participants can start sharing at
the same time; choose which live screen to focus from the screen selector.

## Multiple transmissions and focus

Each participant can share one screen at a time, and multiple participants can
share concurrently. A viewer selects one active remote screen to focus. Only the
focused screen's video and shared audio are negotiated and received; switching
focus closes the previous screen connection. Room voice audio remains separate.

Screen media stays peer-to-peer. The signaling server assigns a fresh ID to each
share and authorizes subscriptions and screen signals for room members. The
server does not relay or store screen media. Rooms currently support up to 10
participants, so the number of simultaneous screen shares is bounded by that
room limit.

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

### Test the web app in an Android browser over Wi-Fi

`http://localhost:5173` is a secure browser context on the computer, but
`http://<HOST_IP>:5173` on a phone is not. Use HTTPS to join a room and view
screen shares from Android Chrome:

1. Install [mkcert](https://github.com/FiloSottile/mkcert) on the development
   computer. Find the computer's LAN IPv4 address. If `web/.certs/lan.pem` and
   `web/.certs/lan-key.pem` already exist and the certificate covers that IP,
   keep them; otherwise, from the repository root generate a local certificate:

   ```bash
   mkcert -install
   mkdir -p web/.certs
   mkcert -cert-file web/.certs/lan.pem -key-file web/.certs/lan-key.pem \
     192.168.18.249 localhost 127.0.0.1
   ```

   Replace the example IP with your computer's IP. Generate a new certificate
   if the IP changes. `web/.certs/` is Git-ignored; keep its private key and
   mkcert's root CA key on the development computer.
2. Install **only the CA certificate** on the Android phone. With USB debugging
   and `adb`, you can transfer it using:

   ```bash
   adb push "$(mkcert -CAROOT)/rootCA.pem" /sdcard/Download/golive-rootCA.crt
   ```

   On the phone, choose **Settings → Security → Encryption & credentials →
   Install a certificate → CA certificate**, then select `golive-rootCA.crt`
   from Downloads (menu names vary by device). Confirm the trust prompt.
3. Start the database and signaling server as in [Run locally](#run-locally),
   then start Vite over HTTPS from the repository root:

   ```bash
   npm run dev-https
   ```

   This uses `web/.certs/lan.pem` and `web/.certs/lan-key.pem`. Run
   `npm run dev -w web` for the usual HTTP localhost server.

4. Open `https://192.168.18.249:5173` in desktop Chrome and Android Chrome,
   substituting your IP and using the port Vite prints if 5173 is busy. Create
   a room on the desktop, copy its invite link,
   and open that link on the phone to join and view the desktop's share. Keep
   `VITE_SIGNALING_URL` unset so the app uses Vite's HTTPS/WSS proxy for its
   signaling and API requests. The phone needs access to Vite's port on the
   computer; allow it through the firewall if the page does not load.

This workflow is for joining and viewing. Android browsers may not support
sharing the phone screen via `getDisplayMedia`.

### Mobile

These instructions cover Android emulators and physical Android devices. Install
Android Studio, an Android SDK/emulator, a compatible JDK, and `adb`. Run
`npm install`, start the local database with `npm run db:start`, configure
`server/.env`, and start the signaling server and web app as described in
[Run locally](#run-locally).
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

#### Android background call controls

GoLive starts its voice foreground service while the room is open. On Android
13 and later, allow **GoLive notifications** when prompted if you want the
ongoing call notification and its Disconnect, microphone, and deafen actions in
the notification drawer. A room can remain connected without notification
permission, but Android may hide that notification and its controls; open the
GoLive app settings from the in-room notice to enable them. The foreground
service may still appear in Android's active-apps/task-manager surface.

Microphone access is a separate permission. For privacy and Android's
background-microphone restrictions (especially Android 14 and later), first
unmute while GoLive is visible so Android can grant microphone access and
establish the eligible foreground-service type. GoLive retains that already
established type while muted; this does not keep a microphone track active.
Notification Unmute is available in the background only while that capability
is retained. If it was never established or microphone capture fails, the
action is discarded rather than deferred, so it cannot unexpectedly unmute
later; reopen GoLive, check microphone access, and unmute while the app is
visible. This also applies while screen-sharing. Voice playback can continue in
the background while the service is available.

To test a room, create one in the web app at `http://localhost:5173` and paste
its full invite link into the mobile app, or create the room on mobile and open
its invite link in the browser. The invite URL must point to the **web app**;
the signaling URL points to the **API**. Both clients should enter the same
room before starting screen sharing. A mobile release APK also needs the API
to be reachable, but it does not need Metro.

Screen sharing requests stereo Opus audio at up to 128 kb/s per viewer when
supported by both peers; Android also captures device playback and plays
remote screen audio in stereo. Actual quality depends on the source app,
browser/Android capture support, and network conditions.

For higher-quality shared music or game audio with Bluetooth headphones, keep
the room microphone muted. When a Bluetooth headset's microphone is active,
Android (and many desktop systems) switches from stereo media playback to a
lower-bandwidth two-way call profile; this is a headset limitation, even if the
shared audio itself is captured separately. Use a wired headset or a separate
microphone if you need to talk while listening in stereo. Native audio changes
require reinstalling a newly built development APK (`npm run android -w mobile
-- --device` from the repository root); restarting Metro only updates JS.

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
npm run dev -w server        # signaling server
npm run dev -w web           # web app
npm run dev-https            # HTTPS web app for LAN testing (requires web/.certs/)
npm run start -w mobile      # Expo dev client
npm run test -w server       # integration tests use TEST_DATABASE_URL when set
npm run test -w packages/core # shared WebRTC/session tests
npm run typecheck -w server
npm run typecheck -w packages/core
npm run typecheck -w web
npm run typecheck -w mobile
npm run build -w server      # compiled signaling server
npm run build -w web         # production web assets
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
- `TRUST_PROXY` — optional trusted proxy hop count or comma-separated trusted IP/CIDR values. Configure only for the actual proxy chain; leaving it unset ignores forwarded IP headers.
- `MAX_ROOMS_PER_DEVICE` — maximum persisted room grants per device (default `100`).
- `MAX_MEMBERS_PER_ROOM` — maximum persisted device memberships per room (default `1000`).
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
files (server, web, and mobile) as templates.

### Server (`server/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port the signaling server listens on. |
| `HOST` | `0.0.0.0` | Address the signaling server binds to. |
| `ORIGIN` | — | CORS allow-origin for the web app. Required when the web app and server are on different origins. |
| `TRUST_PROXY` | disabled | Trusted proxy hop count, `true` for a platform-controlled proxy, or comma-separated trusted IP/CIDR values. Configure only for the actual trusted chain; never trust forwarded headers from direct untrusted clients. |
| `JWT_SECRET` | — | Required secret used to sign invite, room session, and admin JWTs. The server will not start without it. |
| `ADMIN_SECRET` | — | Shared secret exchanged for a one-hour admin JWT. Admin endpoints are disabled unless this and `JWT_SECRET` are explicitly set. |
| `DATABASE_URL` | — | PostgreSQL connection string, e.g. `postgres://golive:golive@localhost:5432/golive`. Required at server startup. Use durable storage in production. |
| `MAX_ROOMS_PER_DEVICE` | `100` | Maximum saved room grants per device profile. |
| `MAX_MEMBERS_PER_ROOM` | `1000` | Maximum persisted device memberships per room. |
| `NEON_AUTH_BASE_URL` | — | Managed Neon Auth URL for this branch, used when Google account features are enabled. |
| `GOOGLE_AUTH_ENABLED` | on in development, off when `NODE_ENV=production` | Set `false` to reject Google account tokens and keep guest room access; set `true` to enable account features. |
| `NEON_AUTH_JWKS_URL` | derived | Optional JWKS URL override; defaults to `NEON_AUTH_BASE_URL/.well-known/jwks.json`. |
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
| `VITE_NEON_AUTH_URL` | — | Managed Neon Auth URL for this branch. Leave unset to keep the web app guest-only. |
| `VITE_GOOGLE_AUTH_ENABLED` | on in Vite dev, off in production builds | Set `false` to hide Google sign-in and skip account session restoration; set `true` to enable it. |

### Admin dashboard

Open `/admin` on the web deployment and enter `ADMIN_SECRET`. The browser sends
the shared secret only to `/admin/login` and stores the returned one-hour admin
JWT in session storage. Live room, participant, and resource values represent
only the current signaling-server process and reset when it restarts. The admin
console provides CRUD for saved room IDs/names and guest profiles in
PostgreSQL. Each device has a profile; guest profiles have one current room
grant, while authenticated profiles can retain multiple account-owned and
invited room grants. Manually created profiles are unclaimed. The display name
belongs to the device profile and is shared across its rooms. Rooms with access
grants are retained even when nobody is connected. When the final grant is
revoked, the room starts a 30-day empty retention period before the scheduled
cleanup deletes it. Profiles without room grants are removed after 90 days
without device activity. Cloudflare
TURN usage is queried separately for the current UTC month and cached for ten
minutes. Historical connection counts, cross-instance live totals, and
hosting-provider metrics are not collected.

All catalog endpoints require an admin JWT (`Authorization: Bearer <token>`):
`GET/POST /admin/rooms`, `GET/PATCH/DELETE /admin/rooms/:id`, and the same
operations under `/admin/profiles`. Rooms use `{ id, name }` on create and
`{ name }` on update; profiles use `{ name }` and receive a generated UUID.
Admins can mint invites for unclaimed rooms using `POST /admin/rooms/:id/invite`.
Catalog lists are paginated with `limit` (1–100, default 100) and `offset`
(default 0); use the returned `nextOffset` to request the next page.
`POST /room` creates a *new* room and its first device membership; it cannot
claim a saved room by guessing its ID. Authenticated accounts can create up to
five rooms without losing previous access; creating another room as a guest
replaces that guest profile's current room grant. Room IDs, memberships, and
device profile names survive restarts; short-lived room session tokens are
renewed on return.
For a database-backed integration check, run
`TEST_DATABASE_URL=postgres://... npm run test -w server` against a disposable
PostgreSQL database after applying all SQL files there. The database user
must have permission to create tables in its schema. SQL migrations live in
`server/db/migrations/`, run in numeric order with `psql -v ON_ERROR_STOP=1`,
and record applied versions in `schema_migrations`. Re-running them is safe.
Migration 002 removes old rooms that had no verifiable owner. Migration 003
enables multiple device-room memberships and marks empty rooms. Migration 004
adds profile activity tracking, the shared PostgreSQL rate-limit store, and
WebSocket connection leases. Migration 005 stores the Neon account that created
each room and supports the five-room limit. Migration 006 tracks a guest device's
current room separately from its account rooms and restores retained owner
memberships previously emptied by the old guest switching behavior. Run all
migrations before starting an upgraded server; local `npm run db:start` applies
them automatically, while other deployments must apply them explicitly.

### Mobile (`mobile/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_SIGNALING_URL` | `http://10.0.2.2:3000` | Full signaling endpoint for WebSocket and TURN credential requests (the Android emulator alias for the host's `localhost`). Set it to the host's LAN IP for a physical device. |
| `EXPO_PUBLIC_INVITE_URL` | `EXPO_PUBLIC_SIGNALING_URL` | Web origin used for shareable invite links. Set it to the web app's reachable URL; the default points to the signaling server, not the web app. |
| `EXPO_PUBLIC_NEON_AUTH_URL` | — | Managed Neon Auth URL for this branch. Leave unset to keep mobile in guest mode. |
| `EXPO_PUBLIC_GOOGLE_AUTH_ENABLED` | on in development, off in release builds | Set `false` to hide Google sign-in and skip account restoration; set `true` to enable it in a release build. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | — | Google OAuth Web Client ID; configure this same ID as the Google provider's Client ID in Neon Auth. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | — | Optional native iOS OAuth Client ID. |
| `GOOGLE_IOS_URL_SCHEME` | derived | Optional override for the reversed client-ID URL scheme used by the Google Sign-In config plugin on iOS. |

### Google sign-in

`neon.ts` already enables Managed Better Auth. On each Neon branch, configure the
Google provider with a Google OAuth Web Client ID and secret, then add the web
app's local and deployed origins to Neon Auth's trusted domains (include the
scheme and omit the trailing slash). Google's OAuth callback URI is
`{NEON_AUTH_BASE_URL}/callback/google`. Disable email/password authentication
in that branch's Neon Auth settings to make Google the only sign-in method. The
app has no separate sign-up form: a user's first successful Google sign-in
creates their GoLive identity automatically.

Google sign-in is disabled by default in production web/mobile builds and on the
server when `NODE_ENV=production`, even if the Neon Auth URLs are configured.
To explicitly keep production in guest-only mode, set
`VITE_GOOGLE_AUTH_ENABLED=false` for the web build,
`EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=false` for the mobile release build, and
`GOOGLE_AUTH_ENABLED=false` on the server. To turn account features on later,
set all corresponding flags to `true` and rebuild/redeploy the clients and
restart the server. The flags do not delete existing accounts or room grants.

For local development, set `VITE_NEON_AUTH_URL` in `web/.env`, the two
`NEON_AUTH_*` values in `server/.env`, and `EXPO_PUBLIC_NEON_AUTH_URL` plus
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in `mobile/.env`. Native Google Sign-In uses
that Web Client ID for the ID token exchanged with Neon Auth. For iOS builds,
also configure an iOS OAuth client and set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
(the URL scheme is derived from that ID unless explicitly overridden). Android
builds must use the app's `com.golive.mobile` package name and a signing
certificate fingerprint registered in the Google Cloud project. Rebuild the
native app after changing its Google Sign-In configuration.

Authenticated accounts can own at most five rooms that still have device access
grants. Ending an account-owned room from web `/rooms` removes it and its access
grants for everyone, freeing its slot. Guests can create rooms and accept
invites, but each guest device profile is limited to
one room grant at a time. Linking a device profile to Google does not transfer
the guest room into the Google account's owned-room quota.

### TURN

Rooms are invite-only after creation, except that an authenticated owner can
re-enter their own room from another device. `POST /room` accepts a `roomId` and,
for a new device, a `name`; it creates the room and owner membership and returns
an eight-hour room session JWT plus a private `deviceToken`. Existing devices use
the name saved on their profile, which can be edited in `/profile` on web or the
mobile Profile screen. Profile name changes are shared across rooms and sent to
participants in already-open rooms. Other accounts and guests cannot claim an
existing room ID without an invite, even if nobody is online.

The browser stores the device credential in local storage; mobile stores it in
AsyncStorage. `GET /device/rooms` returns rooms associated with that device and
visible to the current guest or authenticated identity. Authenticated web
`GET /account/rooms` lists active account-owned rooms independently of local
device storage; `DELETE /account/rooms/:roomId` ends an owned room for everyone.
`POST /device/rooms/:roomId/session` renews a session only for an authorized
room. The web `/rooms` page and mobile My rooms screen require Google sign-in;
the web page shows account-owned rooms plus invited rooms saved on this device,
while mobile lists the current device's available grants. Guests return to the
landing page instead. Leaving a live room keeps its grant;
`DELETE /device/rooms/:roomId` revokes one device's access to a room. Creating a new
room as a guest replaces that profile's previous room grant and disconnects its
old session. Accepting a different room's invite does the same for guests, while
authenticated profiles can retain multiple account-owned and invited rooms.
Linking a guest profile to Google does not promote its guest-created room into
the account's owned-room quota. New devices must provide a display name when
first creating a room or accepting an invite; known devices reuse their saved
profile name. If a saved device credential is invalid, room creation and invite
verification retry without it when a display name is available; mobile prompts
for a name if needed.

The Render Cron Job defined in `render.yaml` runs daily at 03:00 UTC and deletes
rooms with no device memberships for more than 30 days, profiles with no room
memberships and 90 days without device activity, and expired rate-limit counters.
Expired WebSocket connection leases are pruned as well. Rooms with existing
access grants are deliberately retained regardless of connection activity.
Configure the Cron Job's `DATABASE_URL` to the signaling server's database; see
`server/CRON.md`.

HTTP JSON bodies are limited to 16 KiB. `/room` is limited to 5 requests/minute
and 20 room creations per client IP/day; `/invite/verify` is limited to 5
requests/minute and 300 verifications per client IP/day. Device routes use a
30/minute per-IP limit, and the server also applies a 100/minute global HTTP
limit. Admin catalog lists are limited to 10 requests/minute and catalog detail
reads and mutations to 30 and 20 requests/minute, respectively. In production,
HTTP rate-limit counters and WebSocket connection leases are stored in
PostgreSQL so server instances share per-IP limits. WebSocket leases are renewed
while connected and expire automatically after a process crash.
Accurate per-client limits behind a proxy require setting `TRUST_PROXY` to the
trusted proxy chain, never to an untrusted forwarded-header source. The
WebSocket signaling protocol limits frames to 64 KiB and caps message rate and
queued work per connection. It also limits each client IP to 20 concurrent
WebSocket connections across server instances using expiring database leases.

Devices can retain up to 100 room grants, and each room can have up to 1,000
device memberships by default. Both limits can be adjusted with the environment
variables above.

Guests enter through a shareable invite token:

- `POST /invite` takes a `roomId` and an `Authorization: Bearer <room JWT>`
  header. Any current room member can mint a room-bound invite JWT; it expires
  after 24 hours and is reusable while that room exists.
- `POST /invite/verify` takes `{ roomId, inviteToken, name?, deviceToken? }`.
  It validates the invite and adds access to that room. A new device must supply
  `name`; an existing device uses the name in its saved profile. A valid invite
  works across server restarts; an invite from a deleted room cannot be used if
  its ID is later reused.

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
│           ├── neonAuth.ts     # Neon Auth token helper and verifier errors
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
│       │   ├── neon-auth.service.ts # Neon Auth JWT verification
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
    ├── app.config.js       # Expo config with Google Sign-In plugin options
    ├── app.json            # Expo config + permissions + config plugins
    ├── babel.config.js
    ├── metro.config.js
    ├── plugins/
    │   └── withWebRTCMediaProjection.js # Expo config plugin for screen capture
    ├── android/            # native Android project (Expo prebuild output)
    └── src/
        ├── auth.ts          # Neon Auth session and native Google Sign-In
        ├── adapter.ts      # mobile PlatformAdapter (react-native-webrtc)
        ├── config.ts       # SIGNALING_URL from EXPO_PUBLIC_SIGNALING_URL
        ├── session.ts
        ├── components/     # ControlDock, ShareSheet, VideoTile
        ├── hooks/          # useRoom
        ├── screens/        # LandingScreen, NameGateScreen, RoomScreen
        └── utils/          # roomId
```

## MVP constraints

- Room IDs, profiles, and room grants persist in PostgreSQL. Guest profiles have
  one current room grant; authenticated device profiles can retain multiple.
  The migration resets old room rows, which had no verifiable owners.
- WebSocket connections and room instances are process-local. Short-lived room
  JWTs must be renewed after a restart; invite tokens remain valid for up to
  24 hours while their room exists.
- Each participant can share one screen; multiple participants can share at once.
- Each viewer subscribes to only one remote screen at a time; the server enforces
  that limit and room membership before forwarding screen signals.
- The same captured screen stream is reused for each viewer subscribed to it.
- Each viewer still needs a separate P2P video encoder. Screen-share settings
  offer Auto or an available preferred codec (H.264, VP8, VP9, AV1); the
  receiver may negotiate a fallback. Android Auto prefers hardware AV1 where
  the native WebRTC factory exposes it. With Auto or H.264 selected, additional
  viewers use VP8 capped at 480p/15 fps to avoid exhausting H.264 encoders.
  A manually selected AV1/VP8/VP9 is preferred for all viewers, subject to
  device capacity. The bitrate budget is divided among active viewers.
- Room capacity is 10 participants; simultaneous shares cannot exceed that cap.
- STUN is always available. TURN uses Cloudflare first and ExpressTURN after the
  configured Cloudflare egress threshold (see [Environment variables](#environment-variables)).
- Device credentials, display names, and invite grants are device-specific; Google
  sign-in provides account-level room ownership, quota, and re-entry on a new
  device, but does not sync invite grants or display names across devices.
  There is no recording, chat, or participant history.
