# Architecture Decisions

A running log of notable architectural or scoping decisions. Newest at the top. Each entry: date, decision, context, and alternatives considered.

Use this instead of burying design rationale in commit messages or losing it in chat.

---

## 2026-04-22 — Add SharePoint Recap hosts to manifest matches

**Decision:** Extension now matches `*.sharepoint.com/*/_layouts/15/xplatplugins.aspx*` and `teams.cloud.microsoft/*` in addition to the original `teams.microsoft.com` / `teams.live.com`.

**Context:** Discovered in first-run testing that many enterprise tenants render the post-meeting Teams Recap transcript inside SharePoint at `https://{tenant}-my.sharepoint.com/personal/.../_layouts/15/xplatplugins.aspx` — not on `teams.microsoft.com`. The plugin URL carries `hp=TEAMS-WEB` in its query string, confirming it's the same Teams web plugin, just rehosted inside SharePoint.

**Implications:**
- Match pattern on SharePoint is narrow (`/_layouts/15/xplatplugins.aspx*`) to avoid injecting into unrelated SharePoint pages.
- Popup URL check (`isTeamsUrl`) updated to match same hosts.
- The content script's `hasTranscript()` guard remains the real gate — manifest matches are just the trigger for injection.

---

## 2026-04-22 — Phase 0 spike validated; proceed with planned architecture

**Decision:** Build the extension as designed in `PLAN.md`. The core assumptions are confirmed.

**Context:** Ran `spikes/phase-0-validation.js` against a real 908-entry Teams transcript:
- **Detection** — `#OneTranscript` and `#scrollToTargetTargetedFocusZone` located cleanly. Top frame, not an iframe.
- **ID stability** — `sub-entry-N` IDs rematch the same content after scroll-away-and-back. Safe to use as the dedup key.
- **Capture** — scroll-and-harvest reached 908 of 908 entries (100%) in 148 iterations.

**Implications for extension code:**
- Popup can talk directly to frame 0; no `webNavigation` permission needed.
- `sub-entry-N` indices are **0-based**, running `[0, setSize-1]`. Gap-fill must iterate `0..setSize-1`, not `1..setSize` (the spike had this off-by-one; fixed in `capture.js`).
- Entries at indices 0 and `setSize-1` are "started/stopped transcription" system events, not utterances. We include them for MVP; users can strip if desired. Decide later whether to filter.
- Speaker/timestamp extraction via `[id^="itemHeader-"]` did **not** match in the real DOM. The raw `innerText` contains the speaker, so the extractor uses multiple header-selector candidates plus an `innerText`-parsing fallback.

**Alternatives considered:** Abort the architecture if IDs turned out unstable. Did not apply — they were stable.

---

## 2026-04-22 — Plain JavaScript + MV3, no bundler (for MVP)

**Decision:** Build the extension as plain JavaScript targeting Manifest V3, loaded unpacked during development. No Vite, no TypeScript, no build step.

**Context:** Faster iteration for a solo project. Extension code will be small (one content script, one popup, one service worker). A build step adds friction for changes that are mostly single-file tweaks.

**Alternatives:** Vite + TypeScript for type safety. Revisit if the codebase grows past ~1000 LOC or if runtime bugs start tracing to type errors.

---

## 2026-04-22 — Target Chromium browsers only for MVP

**Decision:** Ship to Edge and Chrome first. Firefox is post-MVP.

**Context:** Teams is most commonly used in Edge. Chromium MV3 behavior is consistent between Chrome and Edge. Firefox MV3 has known differences in `chrome.downloads` and service worker lifecycle that would add scope.

**Alternatives:** Cross-browser from day one. Rejected as premature for a personal tool.

---

## 2026-04-22 — `.txt` as the only MVP export format

**Decision:** Ship with TXT export only. Architect the exporter as a registry so Markdown, JSON, CSV can be added later without refactoring.

**Context:** The user's stated need is a text file. Additional formats are "nice to have" and best added after real-world use reveals what structure is useful.

**Alternatives:** Ship with multiple formats. Rejected as scope creep.

---

## 2026-04-22 — `main` is production; all changes via feature branch + PR

**Decision:** No direct commits to `main`. Feature branches merge via pull request.

**Context:** Per user's workflow preference. Matches standard GitHub flow even for a solo project; keeps a clean PR history for future reference.
