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
  const ARIA_DURATION_PATTERN = /(\d+\s+hour[s]?)?\s*(\d+\s+minute[s]?)?\s*(\d+\s+second[s]?)?$/i;

  function compactText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function parseHeaderText(headerText) {
    const compact = compactText(headerText);
    if (!compact) return { speaker: null, timestamp: null };

    const tsMatch = TS_PATTERN.exec(compact);
    if (!tsMatch) {
      return { speaker: compact || null, timestamp: null };
    }

    const speaker = compact.replace(tsMatch[0], '').trim() || null;
    return { speaker, timestamp: tsMatch[1] };
  }

  function parseAriaDuration(labelText) {
    const compact = compactText(labelText);
    if (!compact) return { speaker: null, timestamp: null };

    const durationMatch = compact.match(ARIA_DURATION_PATTERN);
    if (!durationMatch || !durationMatch[0].trim()) {
      return { speaker: compact || null, timestamp: null };
    }

    const durationText = durationMatch[0].trim();
    const speaker = compact.slice(0, compact.length - durationText.length).trim() || null;

    const hoursMatch = /(\d+)\s+hour/i.exec(durationText);
    const minutesMatch = /(\d+)\s+minute/i.exec(durationText);
    const secondsMatch = /(\d+)\s+second/i.exec(durationText);

    const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
    const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
    const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;

    let timestamp = null;
    if (hours > 0) {
      timestamp = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else if (minutes > 0 || seconds > 0) {
      timestamp = `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    return { speaker, timestamp };
  }

  TG.extractEntry = function extractEntry(node) {
    const id = node.id;
    const indexMatch = /sub-entry-(\d+)/.exec(id || '');
    const index = indexMatch ? parseInt(indexMatch[1], 10) : null;
    const posInSet = parseInt(node.getAttribute('aria-posinset') || '0', 10) || null;
    const baseEntryEl = node.closest('[id^="entry-"]');
    const rightColumnEl = node.closest('[id^="rightColumn-"]');
    const headerEl = rightColumnEl
      ? TG.querySelectorAny(rightColumnEl, TG.selectors.HEADER_CANDIDATES)
      : TG.querySelectorAny(node, TG.selectors.HEADER_CANDIDATES);
    const eventSpeakerEl = baseEntryEl ? baseEntryEl.querySelector('[class*="eventSpeakerName"]') : null;

    let speaker = null;
    let timestamp = null;

    if (headerEl) {
      ({ speaker, timestamp } = parseHeaderText(headerEl.innerText || ''));
    } else if (eventSpeakerEl) {
      speaker = compactText(eventSpeakerEl.innerText || '') || null;
    } else if (baseEntryEl) {
      const ariaMeta = parseAriaDuration(baseEntryEl.getAttribute('aria-label') || '');
      speaker = ariaMeta.speaker;
      timestamp = ariaMeta.timestamp;
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

    if (speaker && text) {
      const escapedSpeaker = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`^${escapedSpeaker}\\s+`, 'i'), '').trim();
    }

    // Normalize whitespace inside text.
    text = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    return { id, index, posInSet, speaker, timestamp, text };
  };
})();
