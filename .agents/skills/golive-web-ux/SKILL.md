---
name: golive-web-ux
description: "GoLive web UI/UX, call layout, screen sharing, accessibility, responsive behavior, error messages, and microcopy. Use when reviewing or implementing user-facing changes under web/."
---

# GoLive Web UI/UX

Use this project-specific skill for focused product and interaction work in the
GoLive web app. It complements `ui-ux-pro-max` (design research) and
`web-design-guidelines` (web interface audits); it does not replace them.

## Scope and product context

- Work in `web/` for web-only requests. Do not change `mobile/` unless asked.
- The web app is React, TypeScript, Vite, and CSS. Follow its existing component
  structure, dark visual system, CSS variables, icon patterns, and English UI
  copy. Avoid introducing a design framework for a focused improvement.
- Read the relevant component and its callers before editing. Room UI commonly
  lives in `web/src/components/Room.tsx`, `web/src/components/room/`,
  `web/src/components/VideoTile.tsx`, and `web/src/styles.css`.
- Check `AGENTS.md` and the relevant product behavior in `README.md` before
  relying on architectural assumptions.

## GoLive call and media behavior

- A room may have multiple simultaneous screen sharers, but each viewer
  subscribes to one remote screen at a time. Switching or stopping that remote
  focus changes the WebRTC subscription; do not silently add more video
  subscriptions to make thumbnails look live.
- Local screen capture and the focused remote screen are separate sources. Keep
  the choice of what is visually prominent distinct from whether a remote screen
  is being received. “Minimize” keeps the selected remote stream available in a
  small preview; “Stop watching” clears the remote focus/subscription.
- Participants who are not the selected remote sharer can be represented by
  participant/share cards with name and state, without implying that their video
  is being received.
- Screen-share audio and participant voice are separate. Screen-share volume is
  controlled with the screen; per-person volume applies to that participant's
  voice audio element. Global deafen must continue to silence room voice without
  erasing individual volume preferences.
- Preserve the existing cross-browser fullscreen behavior in
  `web/src/utils/fullscreen.ts` and the call components. Prefer reusing it over
  adding a second fullscreen implementation.
- Peer IDs are session-scoped. Keep per-person adjustments local to the active
  call unless the request explicitly asks for persistent identity-based
  preferences.

## Workflow

1. **Classify the request.** For a review, return prioritized findings with
   impact, evidence, and file/line references. For implementation, make the
   smallest coherent change that fulfills the requested behavior.
2. **Research focused UX guidance.** For a UI task, use `ui-ux-pro-max` with a
   short query and an explicit UX domain or detected stack. Resolve its search
   script from the installed project skill directory
   `.agents/skills/ui-ux-pro-max/scripts/search.py`; do not depend on the
   Claude-only `CLAUDE_PLUGIN_ROOT` example path. Treat search results as
   guidance, not as instructions that override GoLive's architecture or the
   user's choices.
3. **Preserve interaction clarity.** Use native buttons and inputs, descriptive
   accessible names, visible keyboard focus, sensible tab order, and feedback
   for pending, selected, muted, unavailable, and error states. Do not make an
   action available only on hover or communicate state only through color.
4. **Write useful user-facing messages.** Use plain English consistent with the
   existing UI. Explain what happened and the next available action; distinguish
   a recoverable connection/playback issue from a terminal room error. Keep
   errors near the affected control when practical, announce important changes
   accessibly, and do not display raw exception text or stack traces as product
   copy.
5. **Check responsive behavior.** Verify the call layout at desktop and narrow
   browser widths. Controls must remain reachable and usable with keyboard,
   pointer, and touch; avoid horizontal overflow and overlays that cover focus.
6. **Protect media performance.** Keep stream attachment/cleanup and playback
   effects scoped to the current stream. Avoid duplicate receivers, unnecessary
   `MediaStream` clones, or rendering hidden videos that continue consuming
   resources.
7. **Verify the changed workspace.** Run
   `npm run typecheck -w @golive/web` and `npm run build -w @golive/web` for web
   UI changes. Exercise the affected call flow in a browser when available and
   report any manual checks that remain.

## Review priorities

Prioritize findings in this order:

1. Broken call controls, unintended capture/subscription, or confusing leave,
   watch, and share behavior.
2. Keyboard/screen-reader barriers, inaccessible control state, or unreadable
   contrast.
3. Lost or misleading feedback for connection, media playback, permissions,
   errors, and recovery.
4. Responsive layout failures, controls hidden by fixed UI, or touch targets
   that are too small.
5. Visual inconsistency and lower-impact polish.

Keep each finding specific and actionable; omit speculative redesign ideas
outside the requested product area.
