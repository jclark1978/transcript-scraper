# transcript-scraper

A browser extension to reliably capture full Microsoft Teams meeting transcripts from the web app — including content hidden behind virtualized scrolling — and export them as a downloadable text file.

## The Problem

Microsoft Teams renders the transcript panel as a **virtualized list**. Only entries currently in the viewport exist in the DOM; everything else is destroyed as it scrolls out of view. This means:

- Select All + Copy only captures the currently visible window, not the full transcript.
- Large middle sections of long transcripts are missed.
- A normal manual copy approach is unreliable for any meeting beyond a few minutes.

This extension solves that by programmatically scrolling the transcript pane and harvesting each entry into an external store keyed by its stable `sub-entry-N` identifier — so entries are retained even after the virtualizer discards them.

## Status

**Planning phase — no code yet.**

The full build plan lives in [docs/PLAN.md](docs/PLAN.md). Architecture decisions will be logged in [docs/DECISIONS.md](docs/DECISIONS.md).

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

## Development

Plain JavaScript + MV3, no bundler (MVP). Load unpacked from `extension/` in Edge or Chrome once code lands.

## Workflow

- `main` is the production branch.
- All changes go through feature branches and pull requests before merging to `main`.

## License

[MIT](LICENSE)
