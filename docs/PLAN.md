# Teams Transcript Grabber — Build Plan

> This document is the authoritative plan for the MVP. Revise it in place as we learn; don't let it drift from reality.

## 1. Problem Understanding

Microsoft Teams renders the transcript panel using a **virtualized list** (the `ms-List` component from Fluent UI). Virtualization means only the entries currently in the viewport — plus a small buffer above and below — are actually present in the DOM. As you scroll, entries that leave the viewport are **destroyed** (removed from DOM) and new ones are **created**. The `aria-setsize="908"` attribute tells us the *logical* list has 908 items, but at any moment only ~20–40 `div[id^="sub-entry-"]` nodes physically exist.

This is why Select All + Copy fails: the browser can only serialize what is currently in the DOM. Whatever is scrolled off-screen simply doesn't exist as text to copy. Naive approaches capture a window, not the whole list.

The fix is to **programmatically scroll the virtualized container while harvesting entries into an external store keyed by stable identifiers**, so even when a node is destroyed we retain its content. The `id="sub-entry-N"` attribute is the critical stable identifier — it maps to the logical index in the full list, giving us both dedup keys and a completion signal (we can compare captured IDs against `aria-setsize`).

## 2. Proposed Extension Architecture

**Manifest V3 WebExtension** (Chrome/Edge — Edge is most relevant since it's the usual Teams web host).

**Components:**

- **Content script** — injected into `https://teams.microsoft.com/*` and `https://teams.live.com/*`. Does all the real work: DOM detection, scrolling, entry harvesting, assembly. Runs in page context with DOM access.
- **Popup UI (extension action)** — small HTML/JS panel with: Start Capture, Stop, Progress indicator (captured / expected), Download .txt, Download .json (later), Copy to clipboard (optional).
- **Background service worker** — thin. Routes messages between popup and content script, triggers `chrome.downloads.download()` with a blob URL, handles lifecycle. No heavy state.
- **Storage** — `chrome.storage.session` for in-progress capture state (survives popup close but not browser restart — appropriate since transcripts are session-bound). `chrome.storage.local` for user preferences (filename template, output format).
- **Permissions needed:**
  - `activeTab` or host permission for `teams.microsoft.com` / `teams.live.com`
  - `downloads` for triggering the .txt save
  - `storage` for prefs and in-progress state
  - `scripting` if we want on-demand injection instead of static matches
  - No `tabs` needed unless we want cross-tab discovery

**Download flow:** Content script assembles the final string → sends to service worker → service worker creates `Blob` → `URL.createObjectURL()` → `chrome.downloads.download({ url, filename, saveAs: true })`. `saveAs: true` gives the user a file picker, which sidesteps any surprise about where files land and confirms the save gesture (a user-driven action reduces browser friction).

## 3. Detection Strategy

**Page-level detection:**
- URL match via manifest `matches` (the cheap filter).
- Presence of `div#OneTranscript` in DOM confirms the transcript feature is mounted. This is checked on content-script load and re-checked when the user clicks Start (transcript panel may open after meeting begins).

**Transcript pane detection (in priority order, so the extension survives CSS class churn):**
1. `#OneTranscript` as the root anchor.
2. Within it, `[data-testid="transcript-list-wrapper"]` — `data-testid` is more stable than class names (test IDs rarely churn because test suites depend on them).
3. `#scrollToTargetTargetedFocusZone` as the scrollable container candidate.
4. The `ms-List` element or any descendant with `role="list"` inside the wrapper.

**Scrollable container identification:** Walk up from the first `sub-entry-*` node and find the nearest ancestor whose `scrollHeight > clientHeight` and whose computed `overflow-y` is `auto` or `scroll`. This is the element we must `scrollTo` — easy to get wrong by picking a parent or child that doesn't actually scroll.

**Entry node detection:**
- Primary selector: `div[id^="sub-entry-"][role="listitem"]`.
- Extract the numeric index from the `id` as the **canonical key** (e.g., `sub-entry-457` → `457`).
- Within each entry, find:
  - **Speaker header**: elements with `id^="itemHeader-"` or a nested heading-like element; fall back to the first child block that contains an `aria-label` with a person name or a known speaker class fragment.
  - **Timestamp**: a short `m:ss` or `h:mm:ss` pattern — detect by regex on visible text within the header block.
  - **Utterance text**: the `.entryText-*` node (class fragment match: `[class*="entryText-"]`) — the hash suffix will change over time, but the prefix pattern is a reasonable bet. Fall back to "all non-header text inside the listitem."
- Speaker headers aren't repeated for consecutive utterances from the same person, so the extractor must **carry forward the last seen speaker** to entries missing a header.

**Metadata from the list itself:**
- `aria-setsize` on any listitem gives the expected total → drives progress and completion detection.
- `aria-posinset` gives the logical position → useful for dedup and for detecting gaps.

**Defensive layering:** Every selector has a fallback. Class-hash selectors (`entryText-359`) are last resort; `id`, `role`, `data-testid`, and `aria-*` are first line. If all primary selectors fail, show a clear "Transcript panel not detected — is it open?" message rather than silently failing.

## 4. Capture Strategy

**The core algorithm — "Scroll-and-Harvest":**

1. **Initialize store.** `Map<number, Entry>` keyed by sub-entry index. Entry = `{ index, speaker, timestamp, text, posInSet, setSize }`.
2. **Mount a MutationObserver** on the list wrapper, watching `childList` + `subtree`. Every time a new `sub-entry-*` appears, harvest it into the map. (Observer runs independently of the scroll driver, so we catch entries that appear from any cause.)
3. **Jump to the top.** Scroll the container to `scrollTop = 0`. Wait for DOM to settle (see settling strategy below). Harvest everything visible.
4. **Drive the scroll loop.** Repeatedly advance `scrollTop` by roughly `clientHeight * 0.8` (slightly less than one page so adjacent pages share overlap, reducing the chance of skipping virtualized rows that render briefly between pages).
5. **Settle between scrolls.** After each scroll tick, wait on a combined signal:
   - `requestAnimationFrame` x 2 (let layout apply)
   - Then either: (a) the MutationObserver has fired and then stayed quiet for ~150ms (IdleCallback-ish), or (b) a hard ceiling of ~600ms. Whichever comes first.
6. **Harvest after every settle.** Re-scan all current `sub-entry-*` nodes, upsert into the map.
7. **Termination conditions** (any triggers stop):
   - `map.size === aria-setsize` (primary signal).
   - Scroll position is at bottom (`scrollTop + clientHeight >= scrollHeight - tolerance`) AND two consecutive settles produce no new keys.
   - Hard safety cap: N scroll iterations (e.g., 3× ceil(setSize / pageSize)) — prevents runaway.
8. **Gap-fill pass.** After the initial pass, compute missing indices: `expected = [1..setSize]`, missing = expected \ capturedKeys. For each contiguous missing range, jump scroll to the estimated position (`(minMissingIndex / setSize) * scrollHeight`), settle, harvest. Repeat until no progress or a retry cap.
9. **Finalize.** Sort captured entries by `index` ascending, collapse into the output format.

**Why this works:**
- Using `id^="sub-entry-N"` as the dedup key means a node being destroyed and re-created produces no duplicates — same key, same value (with possible text refinement if the first harvest caught a partially-rendered node).
- The MutationObserver catches entries that render between our explicit harvest ticks (e.g., during fast scrolls).
- The gap-fill pass rescues entries that virtualization may have skipped by never materializing them (can happen if the container jumps past them on a large scroll delta).

**Avoiding missed entries:**
- Overlap between scroll pages (80% advance, not 100%).
- Two-phase capture: sequential scroll pass then gap-fill.
- Set `scrollTop` numerically rather than using `scrollIntoView` — more deterministic, avoids Teams' own scroll handlers fighting us.
- Don't use smooth scroll (`behavior: 'smooth'`) — it's async and the exact landing position is hard to observe. Instant scroll + explicit settle is more predictable.

**User interaction during capture:** Put up a non-blocking overlay indicating capture in progress and asking the user to leave the window focused and the transcript panel open. Scroll a background tab and browsers throttle rAF/timers, which will slow capture — detect `document.hidden` and warn.

## 5. Output Strategy

**Internal data model during capture:**
```
Map<number, {
  index: number,         // from sub-entry-N
  posInSet: number,      // aria-posinset
  setSize: number,       // aria-setsize (for sanity check)
  speaker: string | null,
  timestamp: string | null,  // "0:04" preserved as-is
  text: string,
  capturedAt: number     // perf.now() — for diagnostics only
}>
```

Using a Map (not array) keeps O(1) dedup and allows gap analysis by comparing key set to expected range.

**MVP output — plain text:** Human-readable transcript, one utterance per block:

```
[0:04] Jeff Clark
Welcome everyone to the sync. Today we're going to...

[0:38] Alex Kim
Thanks Jeff. Before we start, quick note on...
```

Rules:
- Speaker line shown only when speaker changes from previous entry (reduces noise, matches how Teams displays it).
- Timestamp in `[m:ss]` brackets on the speaker line.
- Blank line between entries for readability.
- UTF-8 with BOM optional (helps older Windows text editors display correctly).
- `\r\n` line endings on Windows downloads is nice-to-have but `\n` is fine.

**Header block** prepended to the file:
```
Microsoft Teams Transcript
Meeting: <meeting title if detectable>
Captured: 2026-04-22 14:03 local
Entries: 908 of 908
Source: <URL>
---
```

**Filename pattern:**
`Teams-Transcript_<meeting-title-slug>_<YYYY-MM-DD>_<HHMM>.txt`

Fallback when title is unknown: `Teams-Transcript_<YYYY-MM-DD>_<HHMM>.txt`.

Slugify the title (lowercase, spaces → hyphens, strip filesystem-unsafe characters). Cap title length at ~60 chars. Meeting title can likely be pulled from the page `<title>`, the meeting header in the Teams chrome, or a known breadcrumb — detection is best-effort and degrades gracefully.

**Future formats (post-MVP):**
- **Markdown** — same shape as plain text but with `## Speaker` headings; useful for pasting into Obsidian/Notion.
- **JSON** — the raw Map serialized, full fidelity, useful for downstream tooling.
- **VTT/SRT** — if timestamps are reliable enough to build subtitle cues. Probably not worth it for MVP because Teams already offers a .vtt download in some tenants — we're solving for users who don't have that option.
- **CSV** — one row per utterance (speaker, timestamp, text) — nice for pivot tables.

Architect the export as a **formatter registry** from day one (even if only TXT is registered) so adding new formats is plug-in, not a rewrite.

## 6. Failure Cases and Edge Cases

| Risk | Likelihood | Mitigation |
|---|---|---|
| Teams changes `.entryText-NNN` class hash | High — happens on every Teams release | Class-fragment match (`[class*="entryText-"]`) as fallback; rely on `id`/`role`/`data-testid` first |
| Teams restructures DOM entirely | Medium, eventually certain | Selector registry with named levels (ROOT, WRAPPER, ITEM, HEADER, TEXT); all in one file so updates are one PR |
| Transcript panel not open when user clicks Start | High | Detect absence of `#OneTranscript`; show actionable error ("Open the transcript panel first, then try again") |
| Transcript still being generated live during meeting | Medium | Detect by checking if new entries keep appearing at the bottom after scroll-to-bottom settles; offer "capture current state" vs "wait for end" modes |
| Virtualizer keeps a wide buffer, no virtualization actually occurs | Low | Our approach still works — we just capture on first pass; no harm |
| `aria-setsize` missing or wrong | Low-medium | Fall back to "no new entries after N consecutive full-bottom settles" as termination |
| Duplicate `sub-entry-N` across renders | Possible if IDs aren't globally stable | Dedup key is `id`; if same id has different text, keep the longer one (assume later render is more complete) |
| Speaker header missing on continuation entries | Expected behavior | Carry-forward last speaker during extraction |
| User-initiated scrolling during capture | Medium | Lock with a visible overlay explaining "capturing — do not scroll"; detect unexpected scrollTop changes and re-seek |
| Background tab throttling | High if user switches away | Detect `visibilitychange`; pause and warn, resume when visible |
| Browser blocks programmatic download | Low with `chrome.downloads` API | `saveAs: true` makes it user-visible; `downloads` permission handles it cleanly; fallback to anchor-click with blob URL |
| `chrome.downloads` not available (e.g., Firefox MV3 quirks) | Depends on target browsers | Fallback: create `<a href="blob:..." download="..."> `and click it |
| Infinite scroll loop (never terminates) | Medium without safeguards | Hard cap on iterations; no-progress counter; explicit user Stop button |
| Huge transcripts (10k+ entries) | Low but possible | Store is a Map — O(1) inserts; memory is bounded (~1KB/entry ≈ 10MB for 10k); no pathological behavior expected |
| CSP blocking content script injection | Low for `teams.microsoft.com`, but possible | Content scripts are privileged and bypass page CSP for their own code; issue would only arise if we tried `eval` in page context — avoid that |
| Clipboard write requires user gesture | Relevant only for optional copy feature | Only trigger clipboard write from the popup button click, which is a gesture |
| Teams split into multiple iframes | Medium | Match `all_frames: true` in manifest; detect which frame contains `#OneTranscript` before acting |
| User is in the desktop app, not web | Certain for many users | **Out of scope** — document that this is a web-only extension. Users must open the meeting's transcript in the Teams web app |
| Accessibility attributes get localized differently | Possible | Avoid selectors based on English text; rely on structural attributes only |
| Meeting ends / tab redirects mid-capture | Medium | Observer disconnect on navigation; save whatever was captured so far; toast notification |

## 7. Recommended Phased Build Plan

**Phase 0 — Spike (½ day, no extension yet).** Open a real Teams transcript in the browser. In DevTools console, write a quick throwaway script that finds the scroll container, scrolls from top to bottom in a loop, harvests `sub-entry-*` into a Map, and logs the captured count vs. `aria-setsize`. This validates the core assumption that our approach can actually reach 100% before we invest in an extension skeleton. **Do this first. Everything else is worthless if this fails.**

**Phase 1 — Detection prototype (1 day).** Minimal MV3 extension: manifest, content script, popup with one "Detect" button. Popup button asks content script to locate `#OneTranscript`, the scroll container, and the first/last `sub-entry-*`, then reports findings back. No capture yet. Goal: prove we can reliably identify the right elements across a few real transcripts and a couple of Teams tenants.

**Phase 2 — Capture engine (2 days).** Port the Phase 0 spike into the content script as a proper module. Add MutationObserver. Implement scroll loop, settle logic, gap-fill pass, termination conditions. Add progress messages to popup (captured / expected). Dump captured Map to console as JSON for inspection. No download yet — validate capture correctness first.

**Phase 3 — File export and UX (1 day).** Implement the TXT formatter. Wire blob → background worker → `chrome.downloads.download` with `saveAs: true`. Add filename generation with meeting title detection. Polish popup: Start, Stop, progress bar, Download button enabled only when capture complete. Add a page-level overlay that shows capture status and discourages user interaction.

**Phase 4 — Hardening and testing (1–2 days).** Selector registry refactor so all selectors are in one file with fallbacks. Error handling and user-visible error messages for each failure mode. Background-tab throttling detection and warning. Stop button that flushes partial capture. Settings (filename template, output format stub). Documented "Troubleshooting" in the popup.

**Phase 5 — Optional extensions (later).** Markdown/JSON/CSV formatters. Auto-capture on meeting end. Save captures to `chrome.storage.local` history. Firefox port (mostly a manifest change).

Total MVP: **~5 days of focused work** after Phase 0 validates.

## 8. Validation Plan

**Phase 0 validation (the single most important test):**
- On a real meeting transcript with ≥500 entries, does the spike reach `capturedCount === aria-setsize` within a reasonable number of scroll iterations? If yes, the plan is viable. If no, we need to rethink (e.g., maybe Teams destroys entries too quickly, or IDs aren't stable — discover this *before* building UX around it).

**Unit-ish tests (manual but scripted):**
1. **Small transcript** (~20 entries) — baseline.
2. **Medium** (~200).
3. **Large** (~900+ like the user's example with `aria-setsize="908"`).
4. **Live meeting** where entries are still being added during capture.
5. **Single-speaker vs. multi-speaker** — verify speaker carry-forward logic.
6. **Transcript with long utterances** (multi-sentence) — verify no text truncation.
7. **Transcript opened right after meeting starts** vs. reopened hours later.
8. **Different tenants** — personal and enterprise Teams (`teams.live.com` vs. `teams.microsoft.com`) if accessible.
9. **Different Teams UI versions** — if a rollout is in flight, test both old and new UI.

**Correctness checks for each run:**
- Captured entry count equals `aria-setsize`.
- Entry indices are contiguous 1..N (no gaps).
- First captured entry matches the first visible one manually.
- Last captured entry matches the last visible one manually.
- Random spot-check: pick 5 entries from the exported file, search Teams for them, confirm text matches.
- Speaker attribution: spot-check transitions — entry after a speaker change has correct speaker.
- Timestamps: all present and ordered monotonically non-decreasing.

**UX/robustness checks:**
- Start capture, close popup, reopen → progress still correct.
- Start capture, switch tabs briefly → handles throttling with a warning.
- Click Start when transcript panel isn't open → clean error, not a crash.
- Click Stop mid-capture → exports partial transcript with a header noting it's incomplete.
- Capture twice in a row → second run produces identical output.
- File downloads with a sensible name and opens cleanly in Notepad/TextEdit/VS Code.

**Regression canary:** Keep a small sample of known-good captured outputs. When Teams releases a UI update, re-run and diff.

---

## MVP Scope

- MV3 extension for Chromium (Edge/Chrome) — Teams web only.
- Popup with Start / Stop / Download buttons and a progress indicator.
- Content script that detects the transcript panel, scroll-and-harvests with a MutationObserver, runs one gap-fill pass, and terminates on `setSize` match or bottom-with-no-progress.
- TXT export with speaker + timestamp blocks, sensible filename, `saveAs: true` download via the background worker.
- Clear error messages for the top 3 failure modes (panel not open, not on Teams, capture stalled).
- Selector registry in one file for easy maintenance.

**Explicitly out of MVP:** Markdown/JSON/CSV formats, Firefox support, desktop-app support, auto-capture, history storage, settings UI beyond defaults.

## Biggest Technical Risk

**That `id="sub-entry-N"` is not a globally stable identifier across virtualization cycles** — i.e., Teams might reuse `sub-entry-1` for different logical content as you scroll, rather than using `1` as a permanent index into the 908-entry logical list. If that turns out to be the case, our dedup key is wrong and the whole approach needs a different identifier (likely a content hash, or reliance on `aria-posinset`, or an index we assign based on scroll position).

The second-biggest risk is **Teams class-name churn**, but that's a maintenance cost, not an existence threat — mitigated by the selector registry pattern.

## What to Validate First, Before Writing Code

1. **ID stability.** In DevTools, note the text in `sub-entry-5`, scroll it far out of view, scroll back — is the same text still at `sub-entry-5`? Is the element the same node or a recreated one? This is a 2-minute test and it determines the entire architecture.
2. **`aria-setsize` accuracy.** Does it match the actual transcript length in a meeting you know the size of? (Cross-check against Teams' own .vtt export if you can get one.)
3. **The scroll-and-harvest spike from Phase 0.** Can a console script actually reach 100% coverage on a real transcript? This is the go/no-go decision for the whole project.

If those three checks pass, the plan is solid and we can move to Phase 1 with confidence. If any fail, we revise before writing a single line of extension code.
