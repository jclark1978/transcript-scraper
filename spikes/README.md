# Spikes

Throwaway validation scripts used to de-risk an approach before investing in it.

**Expected lifetime:** short. Delete spikes once their finding has been captured (in `docs/PLAN.md`, `docs/DECISIONS.md`, or actual code).

## Current spikes

### Phase 0 — [`phase-0-validation.js`](phase-0-validation.js)

Validates the three assumptions the extension plan rests on, before a single line of extension code gets written:

1. **Detection** — can we reliably locate `#OneTranscript`, the scrollable container, and `sub-entry-*` entries?
2. **ID stability** — when an entry scrolls out of view and back, is it rematched by the same `sub-entry-N` id with the same content? (If not, our dedup key is wrong.)
3. **Full capture** — does a scroll-and-harvest loop reach `aria-setsize` entries on a real transcript?

#### How to run

1. Open Microsoft Teams web in Edge or Chrome (`teams.microsoft.com` or `teams.live.com`).
2. Open a meeting recording (or live meeting) that has a transcript.
3. Open the transcript panel so entries are visible on screen.
4. Open DevTools (F12 or Cmd+Opt+I) → **Console** tab.
5. Open [`phase-0-validation.js`](phase-0-validation.js), copy the entire file, paste into the console, press Enter.
6. Watch the output. A `SPIKE RESULT` block prints at the end.
7. Inspect detail at `window.__TG_SPIKE` and the captured Map at `window.__TG_SPIKE_MAP`.

#### What to report back

Paste the `SPIKE RESULT` block into chat, or share `JSON.stringify(window.__TG_SPIKE.findings, null, 2)`. Specifically:

- `findings.detection` — confirms selectors resolved to sensible elements.
- `findings.idStability.sameText` — **the critical bit**. Must be `true` for the planned architecture to work.
- `findings.capture.capturedCount` vs `findings.capture.expected` — should be equal, or within a handful of missing indices that gap-fill couldn't reach.
- `findings.capture.missingIndices` — if non-empty, helps diagnose where the loop missed things.

#### Safety

The spike reads the DOM and calls `element.scrollTo()`. It does not write to the DOM, does not make network requests, does not access storage, clipboard, or downloads.
