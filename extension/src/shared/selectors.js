/*
 * Centralized selector registry.
 *
 * All DOM selectors for locating Teams transcript structures live here, ordered
 * from most-stable to least-stable. When Teams ships a UI change, this is the
 * one file to update.
 *
 * Stability rationale:
 *   - Element IDs (#OneTranscript, sub-entry-*) — most stable, used by Teams
 *     code for its own bookkeeping.
 *   - data-testid — stable because Teams' own test suites depend on them.
 *   - role + id prefix — structural, resilient to styling changes.
 *   - class-name fragments (class*="entryText-") — unstable; hash suffix
 *     changes with Teams releases. Last-resort fallback only.
 */

(() => {
  const TG = (globalThis.TG ||= {});

  TG.selectors = {
    ROOT: '#OneTranscript',
    WRAPPER: [
      '[data-testid="transcript-list-wrapper"]',
      '#scrollToTargetTargetedFocusZone',
    ],
    SCROLL_CONTAINER_ID: '#scrollToTargetTargetedFocusZone',
    ENTRY: 'div[id^="sub-entry-"][role="listitem"]',
    ENTRY_ID_PREFIX: 'sub-entry-',
    HEADER_CANDIDATES: [
      '[id^="itemHeader-"]',
      '[class*="itemHeader"]',
      '[class*="speakerHeader"]',
      '[class*="entryHeader"]',
    ],
    TEXT_CANDIDATES: [
      '[class*="entryText-"]',
      '[class*="entryText"]',
    ],
  };

  TG.findScrollContainer = function findScrollContainer(anchorEl) {
    if (!anchorEl) return null;
    let node = anchorEl.parentElement;
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
  };

  TG.querySelectorAny = function querySelectorAny(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };
})();
