# transcript-scraper

A browser extension to reliably capture full Microsoft Teams meeting transcripts from the web app — including content hidden behind virtualized scrolling — and export them as a downloadable text file.

## The Problem

Microsoft Teams renders the transcript panel as a **virtualized list**. Only entries currently in the viewport exist in the DOM; everything else is destroyed as it scrolls out of view. This means:

- Select All + Copy only captures the currently visible window, not the full transcript.
- Large middle sections of long transcripts are missed.
- A normal manual copy approach is unreliable for any meeting beyond a few minutes.

This extension solves that by programmatically scrolling the transcript pane and harvesting each entry into an external store keyed by its stable `sub-entry-N` identifier — so entries are retained even after the virtualizer discards them.

## Status

**MVP implemented.** Phase 0 validation passed (100% capture on a real 908-entry transcript). Extension ready for hands-on testing — see [Install](#install) below.

The full build plan lives in [docs/PLAN.md](docs/PLAN.md). Architecture decisions are logged in [docs/DECISIONS.md](docs/DECISIONS.md).

## Scope

- **Target:** Microsoft Teams web app (`teams.microsoft.com`, `teams.live.com`).
- **Browsers (MVP):** Chromium-based — Edge and Chrome. Firefox support is post-MVP.
- **Out of scope:** The Teams desktop app. Users must open the meeting transcript in the web app.
- **Output (MVP):** `.txt` file download. Markdown, JSON, and CSV formats are post-MVP.

## Planned Architecture

Manifest V3 WebExtension with:

- **Content script** — detects the transcript panel, runs the scroll-and-harvest loop, assembles output.
- **Popup UI** — Start / Stop / Download controls with progress indicator.
- **Background service worker** — routes messages and triggers file downloads.

See the plan for details.

## Repository Layout

```
docs/              Planning and decision documents
extension/         MV3 extension source (empty until Phase 1)
  src/
    background/   Service worker
    content/      Content script (detection + capture engine)
    popup/        Extension popup UI
    shared/       Selector registry, formatters, shared utilities
  icons/
spikes/            Throwaway validation scripts (Phase 0 lives here)
```

## Install

This is an unpacked developer install (no Chrome Web Store listing yet).

1. Clone this repo: `git clone https://github.com/jclark1978/transcript-scraper.git`
2. In Edge or Chrome, go to `edge://extensions` or `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension/` directory in this repo.
5. Pin the extension to the toolbar for convenience.

## Usage

1. Open Microsoft Teams web (`teams.microsoft.com` or `teams.live.com`).
2. Open a meeting recording (or live meeting) that has a transcript.
3. Open the **transcript panel** — entries must be visible.
4. Click the extension icon → **Start Capture**.
5. Leave the Teams tab focused while it runs. The panel will scroll automatically. A 900-entry transcript takes under a minute.
6. When it completes, click **Download .txt**. The browser's Save dialog appears; choose where to save.

### Troubleshooting

- **"Transcript panel not detected"** — open the transcript panel in Teams first. In a meeting view, click **More > Language and speech > Show transcript**.
- **"Only works on Microsoft Teams web"** — this extension doesn't run in the Teams desktop app. Open the meeting at `teams.microsoft.com` in a browser instead.
- **Capture stalls or missing entries** — the extension detects when no new entries have loaded for several iterations and stops. If results look incomplete, check that you left Teams focused the whole time — background tabs get throttled by the browser.

## Development

Plain JavaScript + MV3, no bundler. Edit files in `extension/` and reload the extension from `edge://extensions` or `chrome://extensions` (click the reload icon on the extension card) to pick up changes.

## Workflow

- `main` is the production branch.
- All changes go through feature branches and pull requests before merging to `main`.

## License

[MIT](LICENSE)
