# Architecture Decisions

A running log of notable architectural or scoping decisions. Newest at the top. Each entry: date, decision, context, and alternatives considered.

Use this instead of burying design rationale in commit messages or losing it in chat.

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
