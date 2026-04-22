/*
 * Capture engine. Ported from spikes/phase-0-validation.js with refinements.
 *
 * Public API (on globalThis.TG):
 *   TG.capture.detect()      — synchronous detection probe; returns diagnostic
 *   TG.capture.start(onProgress) — runs the scroll-and-harvest loop, returns
 *                                   a Promise<CaptureResult>
 *   TG.capture.stop()        — aborts the current run; partial result flushed
 *
 * CaptureResult = { entries: Entry[], expected: number|null, partial: boolean,
 *                   missingCount: number, missingIndices: number[],
 *                   durationMs: number }
 */

(() => {
  const TG = (globalThis.TG ||= {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rafx2 = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  function detect() {
    const root = document.querySelector(TG.selectors.ROOT);
    if (!root) return { ok: false, reason: 'transcript-panel-not-open' };

    const firstEntry = root.querySelector(TG.selectors.ENTRY);
    if (!firstEntry) return { ok: false, reason: 'no-entries-rendered' };

    const scrollContainer = TG.findScrollContainer(firstEntry);
    if (!scrollContainer) return { ok: false, reason: 'no-scroll-container' };

    const setSize = parseInt(firstEntry.getAttribute('aria-setsize') || '0', 10) || null;

    return {
      ok: true,
      root,
      scrollContainer,
      firstEntry,
      setSize,
      visibleCount: root.querySelectorAll(TG.selectors.ENTRY).length,
    };
  }

  let activeRun = null;

  async function start(onProgress) {
    if (activeRun) throw new Error('capture already in progress');

    const t0 = performance.now();
    const det = detect();
    if (!det.ok) {
      const errMap = {
        'transcript-panel-not-open': 'Transcript panel not detected. Open the transcript panel in Teams, then try again.',
        'no-entries-rendered': 'Transcript found but no entries are rendered yet. Make sure the transcript has loaded.',
        'no-scroll-container': 'Could not identify the transcript scroll container. The Teams UI may have changed.',
      };
      throw new Error(errMap[det.reason] || det.reason);
    }

    const { root, scrollContainer } = det;
    const expected = det.setSize;
    const captured = new Map();
    let aborted = false;
    activeRun = { abort: () => (aborted = true) };

    function harvest() {
      const nodes = root.querySelectorAll(TG.selectors.ENTRY);
      for (const node of nodes) {
        const entry = TG.extractEntry(node);
        if (!entry.id) continue;
        const existing = captured.get(entry.id);
        if (!existing) {
          captured.set(entry.id, entry);
        } else if ((entry.text || '').length > (existing.text || '').length) {
          captured.set(entry.id, entry);
        }
      }
    }

    function progress(phase) {
      if (onProgress) {
        onProgress({
          phase,
          captured: captured.size,
          expected,
          scrollTop: Math.round(scrollContainer.scrollTop),
          scrollHeight: scrollContainer.scrollHeight,
        });
      }
    }

    // --- Main pass: scroll from top to bottom ---
    scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
    await rafx2();
    await sleep(400);
    harvest();
    progress('main-pass');

    const pageStep = Math.max(100, Math.floor(scrollContainer.clientHeight * 0.8));
    const maxIterations = expected
      ? Math.ceil((scrollContainer.scrollHeight / pageStep) * 3) + 20
      : 500;

    let lastSize = captured.size;
    let noProgressStreak = 0;

    for (let i = 0; i < maxIterations; i++) {
      if (aborted) break;

      const prevTop = scrollContainer.scrollTop;
      const target = Math.min(prevTop + pageStep, scrollContainer.scrollHeight);
      scrollContainer.scrollTo({ top: target, behavior: 'auto' });
      await rafx2();
      await sleep(250);
      harvest();

      const atBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
        scrollContainer.scrollHeight - 4;

      if (captured.size === lastSize) {
        noProgressStreak++;
      } else {
        noProgressStreak = 0;
        lastSize = captured.size;
      }

      if (i % 3 === 0) progress('main-pass');

      if (expected && captured.size >= expected) break;
      if (atBottom && noProgressStreak >= 2) break;
    }

    progress('main-pass-done');

    // --- Gap-fill pass ---
    if (!aborted && expected && captured.size < expected) {
      const capturedIndices = new Set(
        Array.from(captured.values()).map((e) => e.index).filter((n) => n !== null),
      );
      const missing = [];
      // Teams uses 0-indexed sub-entry-N where N ranges [0, expected-1].
      for (let i = 0; i < expected; i++) if (!capturedIndices.has(i)) missing.push(i);

      const maxGapTries = Math.min(missing.length * 2, 80);
      let tries = 0;
      for (const idx of missing) {
        if (aborted || tries >= maxGapTries) break;
        tries++;
        const ratio = idx / expected;
        const target = Math.max(
          0,
          Math.min(
            scrollContainer.scrollHeight - scrollContainer.clientHeight,
            Math.floor(ratio * scrollContainer.scrollHeight) - scrollContainer.clientHeight / 2,
          ),
        );
        scrollContainer.scrollTo({ top: target, behavior: 'auto' });
        await rafx2();
        await sleep(300);
        harvest();
        if (tries % 5 === 0) progress('gap-fill');
      }
      progress('gap-fill-done');
    }

    // --- Finalize ---
    activeRun = null;
    const entries = Array.from(captured.values()).sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );

    let missingIndices = [];
    if (expected) {
      const have = new Set(entries.map((e) => e.index));
      for (let i = 0; i < expected; i++) if (!have.has(i)) missingIndices.push(i);
    }

    return {
      entries,
      expected,
      partial: aborted || (!!expected && entries.length < expected),
      missingCount: missingIndices.length,
      missingIndices: missingIndices.slice(0, 100),
      durationMs: Math.round(performance.now() - t0),
      aborted,
    };
  }

  function stop() {
    if (activeRun) activeRun.abort();
  }

  TG.capture = { detect, start, stop };
})();
