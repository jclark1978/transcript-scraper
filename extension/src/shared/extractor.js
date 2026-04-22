/*
 * Entry extraction — given a sub-entry DOM node, produce a structured entry.
 *
 * Output: { id, index, posInSet, speaker, timestamp, text }
 *
 * Teams doesn't repeat the speaker header for consecutive utterances from the
 * same speaker. We extract what the DOM gives us and leave carry-forward to
 * the formatter.
 */

(() => {
  const TG = (globalThis.TG ||= {});
  const TS_PATTERN = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/;

  TG.extractEntry = function extractEntry(node) {
    const id = node.id;
    const indexMatch = /sub-entry-(\d+)/.exec(id || '');
    const index = indexMatch ? parseInt(indexMatch[1], 10) : null;
    const posInSet = parseInt(node.getAttribute('aria-posinset') || '0', 10) || null;

    const headerEl = TG.querySelectorAny(node, TG.selectors.HEADER_CANDIDATES);

    let speaker = null;
    let timestamp = null;

    if (headerEl) {
      const headerText = (headerEl.innerText || '').trim();
      const tsMatch = TS_PATTERN.exec(headerText);
      if (tsMatch) timestamp = tsMatch[1];
      const remaining = (tsMatch ? headerText.replace(tsMatch[0], '') : headerText)
        .trim()
        .split('\n')[0]
        .trim();
      speaker = remaining || null;
    }

    let text;
    const textEl = TG.querySelectorAny(node, TG.selectors.TEXT_CANDIDATES);
    if (textEl) {
      text = (textEl.innerText || '').trim();
    } else {
      const full = (node.innerText || '').trim();
      if (headerEl) {
        const headerText = (headerEl.innerText || '').trim();
        text = full.startsWith(headerText) ? full.slice(headerText.length).trim() : full;
      } else {
        // No header matched by any candidate selector — try to parse innerText.
        // Typical shapes we see in practice:
        //   "Jeff Clark  0:04\nYeah, we got some questions..."
        //   "Jeff Clark\n\n started transcription"
        //   "Plain utterance text with no header (continuation)"
        const lines = full
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (lines.length >= 2) {
          const first = lines[0];
          const tsMatch = TS_PATTERN.exec(first);
          if (tsMatch) {
            // Speaker + timestamp on the first line
            timestamp = tsMatch[1];
            speaker = first.replace(tsMatch[0], '').trim() || null;
            text = lines.slice(1).join(' ').trim();
          } else if (first.length < 60 && !/[.!?,]$/.test(first)) {
            // Bare name on first line (no ending punctuation, short)
            speaker = first;
            text = lines.slice(1).join(' ').trim();
          } else {
            text = full;
          }
        } else {
          text = full;
        }
      }
    }

    // Normalize whitespace inside text.
    text = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    return { id, index, posInSet, speaker, timestamp, text };
  };
})();
