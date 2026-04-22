/*
 * Phase 0 — Teams transcript capture validation spike.
 *
 * HOW TO RUN
 *   1. Open Microsoft Teams web (teams.microsoft.com or teams.live.com).
 *   2. Open a meeting recording or live meeting with a transcript.
 *   3. Open the transcript panel (so entries are visible).
 *   4. Open DevTools (F12 or Cmd+Opt+I) → Console tab.
 *   5. Paste this entire file into the console and press Enter.
 *   6. Watch the console. Final summary is logged at the end.
 *   7. Results are stashed on window.__TG_SPIKE for inspection.
 *
 * WHAT IT VALIDATES
 *   A) We can locate the transcript panel, scroll container, and entries.
 *   B) sub-entry-N IDs are stable across virtualization cycles.
 *      (Same ID after scrolling away and back = same logical entry.)
 *   C) aria-setsize is accurate.
 *   D) A scroll-and-harvest loop reaches 100% coverage.
 *
 * NONE OF THIS MUTATES TEAMS.
 *   It only reads the DOM and calls element.scrollTo().
 *   No network, no storage, no clipboard, no downloads.
 *
 * If any of A/B/C/D fails, the extension plan needs revision before code.
 */

(async () => {
  const log = (...args) => console.log('%c[TG-Spike]', 'color:#06c;font-weight:bold', ...args);
  const warn = (...args) => console.warn('%c[TG-Spike]', 'color:#c60;font-weight:bold', ...args);
  const err = (...args) => console.error('%c[TG-Spike]', 'color:#c00;font-weight:bold', ...args);

  const results = { step: 'starting', ok: false, findings: {} };
  window.__TG_SPIKE = results;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rafx2 = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // ---------- STEP A: Detection ----------
  log('Step A — detecting transcript panel…');
  results.step = 'detection';

  const oneTranscript = document.querySelector('#OneTranscript');
  if (!oneTranscript) {
    err('No #OneTranscript element found. Is the transcript panel open?');
    results.error = 'no-one-transcript';
    return;
  }

  // Find an initial entry so we can derive its scroll parent.
  const firstEntry = oneTranscript.querySelector('div[id^="sub-entry-"][role="listitem"]');
  if (!firstEntry) {
    err('Found #OneTranscript but no sub-entry-* listitems inside it.');
    results.error = 'no-entries';
    return;
  }

  // Walk up to find the actual scrollable ancestor.
  function findScrollParent(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const overflowY = style.overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight + 1
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  const scrollContainer = findScrollParent(firstEntry);
  if (!scrollContainer) {
    err('Could not identify a scrollable ancestor of sub-entry-*.');
    results.error = 'no-scroll-parent';
    return;
  }

  const setSize = parseInt(firstEntry.getAttribute('aria-setsize') || '0', 10);
  log('  #OneTranscript:', oneTranscript);
  log('  scrollContainer:', scrollContainer,
      `(scrollHeight=${scrollContainer.scrollHeight}, clientHeight=${scrollContainer.clientHeight})`);
  log('  first sub-entry:', firstEntry.id, 'aria-setsize=', setSize);

  results.findings.detection = {
    hasOneTranscript: true,
    scrollContainerTag: scrollContainer.tagName,
    scrollContainerId: scrollContainer.id || null,
    scrollContainerClass: scrollContainer.className || null,
    scrollHeight: scrollContainer.scrollHeight,
    clientHeight: scrollContainer.clientHeight,
    ariaSetSize: setSize,
    initialVisibleCount: oneTranscript.querySelectorAll('div[id^="sub-entry-"]').length,
  };

  if (!setSize) warn('  aria-setsize is missing or zero — termination will fall back to heuristics.');

  // ---------- STEP B: ID stability ----------
  log('Step B — testing sub-entry ID stability across virtualization…');
  results.step = 'id-stability';

  // Scroll to top first to normalize starting state.
  scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
  await rafx2();
  await sleep(400);

  // Pick an entry currently rendered near the top — capture (id → text).
  const sampleNodes = Array.from(
    oneTranscript.querySelectorAll('div[id^="sub-entry-"][role="listitem"]'),
  );
  if (sampleNodes.length === 0) {
    err('After scrolling to top, no entries are rendered. Aborting.');
    results.error = 'no-entries-after-top-scroll';
    return;
  }
  const sample = sampleNodes[Math.min(2, sampleNodes.length - 1)]; // pick an inner one
  const sampleId = sample.id;
  const sampleText = (sample.innerText || '').trim().slice(0, 200);
  const sampleNodeRef = sample;
  log(`  sampling ${sampleId}: "${sampleText.slice(0, 80)}…"`);

  // Scroll to the very bottom to force the sample out of the DOM.
  scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' });
  await rafx2();
  await sleep(500);

  const sampleStillAttached = document.contains(sampleNodeRef);
  log(`  after scroll-to-bottom, original node still in DOM? ${sampleStillAttached}`);

  // Scroll back to top and look for the same id.
  scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
  await rafx2();
  await sleep(500);

  const rematched = document.getElementById(sampleId);
  const rematchedText = rematched ? (rematched.innerText || '').trim().slice(0, 200) : null;
  const sameNode = rematched === sampleNodeRef;
  const sameText = rematchedText === sampleText;

  log(`  rematched element with same id? ${!!rematched}`);
  log(`  same DOM node instance? ${sameNode}`);
  log(`  same text content? ${sameText}`);

  results.findings.idStability = {
    sampleId,
    sampleTextPreview: sampleText.slice(0, 120),
    sampleDestroyedOnScrollAway: !sampleStillAttached,
    rematchedExists: !!rematched,
    sameNodeInstance: sameNode,
    sameText: sameText,
    rematchedTextPreview: rematchedText ? rematchedText.slice(0, 120) : null,
  };

  if (!rematched) {
    err('  FAIL: scrolled back but no element with the same id exists. IDs may not be stable.');
  } else if (!sameText) {
    err('  FAIL: same id now shows different text. sub-entry-N is NOT a globally stable key.');
  } else {
    log('  PASS: sub-entry ID appears stable across virtualization.');
  }

  // ---------- STEP C/D: Scroll-and-harvest ----------
  log('Step C/D — full scroll-and-harvest pass…');
  results.step = 'capture';

  const captured = new Map(); // id (string) -> { index, text, speakerGuess, timestampGuess, posInSet }

  function extractEntry(node) {
    const id = node.id;
    const indexMatch = /sub-entry-(\d+)/.exec(id);
    const index = indexMatch ? parseInt(indexMatch[1], 10) : null;
    const posInSet = parseInt(node.getAttribute('aria-posinset') || '0', 10) || null;

    // Speaker + timestamp: best-effort. Look for an itemHeader-* descendant first.
    const header = node.querySelector('[id^="itemHeader-"]');
    let speakerGuess = null;
    let timestampGuess = null;
    if (header) {
      const headerText = (header.innerText || '').trim();
      // Typical format lines: "Jeff Clark  0:04" or similar; parse loosely.
      const tsMatch = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/.exec(headerText);
      timestampGuess = tsMatch ? tsMatch[1] : null;
      speakerGuess = headerText
        .replace(tsMatch ? tsMatch[0] : '', '')
        .trim()
        .split('\n')[0] || null;
    }

    // Utterance text: prefer .entryText-* node if present; else full node text minus header.
    const textNode = node.querySelector('[class*="entryText-"]');
    let text;
    if (textNode) {
      text = (textNode.innerText || '').trim();
    } else {
      const full = (node.innerText || '').trim();
      const headerText = header ? (header.innerText || '').trim() : '';
      text = headerText && full.startsWith(headerText) ? full.slice(headerText.length).trim() : full;
    }

    return { id, index, posInSet, speakerGuess, timestampGuess, text };
  }

  function harvestVisible() {
    const nodes = oneTranscript.querySelectorAll('div[id^="sub-entry-"][role="listitem"]');
    let added = 0;
    for (const node of nodes) {
      const entry = extractEntry(node);
      if (!entry.id) continue;
      const existing = captured.get(entry.id);
      if (!existing) {
        captured.set(entry.id, entry);
        added++;
      } else if (entry.text && entry.text.length > (existing.text || '').length) {
        // Prefer longer/more-complete text on re-harvest.
        captured.set(entry.id, entry);
      }
    }
    return added;
  }

  // Go to top, harvest.
  scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
  await rafx2();
  await sleep(400);
  harvestVisible();

  const pageStep = Math.max(100, Math.floor(scrollContainer.clientHeight * 0.8));
  const maxIterations = setSize > 0
    ? Math.ceil((scrollContainer.scrollHeight / pageStep) * 3) + 20
    : 500;

  let iteration = 0;
  let lastSize = captured.size;
  let noProgressStreak = 0;

  log(`  pageStep=${pageStep}px, maxIterations=${maxIterations}, starting captured=${captured.size}`);

  while (iteration < maxIterations) {
    iteration++;
    const prevTop = scrollContainer.scrollTop;
    const target = Math.min(prevTop + pageStep, scrollContainer.scrollHeight);
    scrollContainer.scrollTo({ top: target, behavior: 'auto' });
    await rafx2();
    await sleep(250);
    harvestVisible();

    const atBottom =
      scrollContainer.scrollTop + scrollContainer.clientHeight >=
      scrollContainer.scrollHeight - 4;

    if (captured.size === lastSize) {
      noProgressStreak++;
    } else {
      noProgressStreak = 0;
      lastSize = captured.size;
    }

    if (iteration % 5 === 0) {
      log(
        `  iter=${iteration} scrollTop=${Math.round(scrollContainer.scrollTop)}/` +
        `${scrollContainer.scrollHeight} captured=${captured.size}` +
        (setSize ? `/${setSize}` : ''),
      );
    }

    if (setSize && captured.size >= setSize) {
      log('  reached aria-setsize — stopping main pass.');
      break;
    }
    if (atBottom && noProgressStreak >= 2) {
      log('  at bottom with no new entries for 2 iterations — stopping main pass.');
      break;
    }
  }

  log(`Main pass done after ${iteration} iterations. Captured=${captured.size}, expected=${setSize || 'unknown'}.`);

  // ---------- Gap-fill pass ----------
  if (setSize > 0 && captured.size < setSize) {
    log('Gap-fill pass — seeking missing indices…');
    results.step = 'gap-fill';

    const capturedIndices = new Set(
      Array.from(captured.values()).map((e) => e.index).filter((n) => n !== null),
    );
    const missing = [];
    for (let i = 1; i <= setSize; i++) if (!capturedIndices.has(i)) missing.push(i);
    log(`  ${missing.length} indices missing, first few:`, missing.slice(0, 10));

    const maxGapTries = Math.min(missing.length * 2, 60);
    let gapAttempt = 0;
    for (const idx of missing) {
      if (gapAttempt >= maxGapTries) break;
      gapAttempt++;
      const ratio = idx / setSize;
      const target = Math.max(0, Math.min(
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
        Math.floor(ratio * scrollContainer.scrollHeight) - scrollContainer.clientHeight / 2,
      ));
      scrollContainer.scrollTo({ top: target, behavior: 'auto' });
      await rafx2();
      await sleep(300);
      harvestVisible();
    }
    log(`  gap-fill done. captured=${captured.size}/${setSize}`);
  }

  // ---------- Final report ----------
  results.step = 'done';
  const sorted = Array.from(captured.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const missingFinal = [];
  if (setSize > 0) {
    const have = new Set(sorted.map((e) => e.index));
    for (let i = 1; i <= setSize; i++) if (!have.has(i)) missingFinal.push(i);
  }

  results.findings.capture = {
    iterations: iteration,
    capturedCount: captured.size,
    expected: setSize || null,
    coveragePct: setSize ? +((captured.size / setSize) * 100).toFixed(2) : null,
    missingIndices: missingFinal.slice(0, 50),
    missingCount: missingFinal.length,
    firstThree: sorted.slice(0, 3).map((e) => ({
      id: e.id, index: e.index, speaker: e.speakerGuess, ts: e.timestampGuess,
      textPreview: (e.text || '').slice(0, 100),
    })),
    lastThree: sorted.slice(-3).map((e) => ({
      id: e.id, index: e.index, speaker: e.speakerGuess, ts: e.timestampGuess,
      textPreview: (e.text || '').slice(0, 100),
    })),
  };

  results.ok =
    results.findings.idStability.rematchedExists &&
    results.findings.idStability.sameText &&
    (setSize === 0 || captured.size === setSize);

  log('========== SPIKE RESULT ==========');
  log('overall OK?', results.ok);
  log('detection:', results.findings.detection);
  log('id stability:', results.findings.idStability);
  log('capture:', results.findings.capture);
  log('Full data at window.__TG_SPIKE (and window.__TG_SPIKE_MAP).');
  window.__TG_SPIKE_MAP = captured;
})();
