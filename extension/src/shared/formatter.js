/*
 * Formatter registry. MVP registers only 'txt'; markdown/json/csv come later.
 */

(() => {
  const TG = (globalThis.TG ||= {});

  function formatTxt(entries, meta) {
    // Carry speaker forward when consecutive entries share one but the later
    // entry didn't render a header.
    let lastSpeaker = null;
    const lines = [];

    lines.push('Microsoft Teams Transcript');
    if (meta.meetingTitle) lines.push(`Meeting: ${meta.meetingTitle}`);
    lines.push(`Captured: ${meta.capturedAtISO} (${meta.capturedAtLocal})`);
    lines.push(`Entries: ${entries.length}${meta.expected ? ` of ${meta.expected}` : ''}`);
    if (meta.partial) lines.push('Status: PARTIAL — capture stopped before completion');
    if (meta.sourceUrl) lines.push(`Source: ${meta.sourceUrl}`);
    lines.push('---', '');

    for (const entry of entries) {
      const speaker = entry.speaker || lastSpeaker;
      const showHeader = !!entry.speaker && entry.speaker !== lastSpeaker;
      if (entry.speaker) lastSpeaker = entry.speaker;

      if (showHeader || entry.timestamp) {
        const ts = entry.timestamp ? `[${entry.timestamp}] ` : '';
        const name = speaker || '';
        const header = `${ts}${name}`.trim();
        if (header) lines.push(header);
      }
      if (entry.text) lines.push(entry.text);
      lines.push('');
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  const registry = new Map();
  registry.set('txt', {
    id: 'txt',
    label: 'Plain text (.txt)',
    extension: 'txt',
    mime: 'text/plain;charset=utf-8',
    format: formatTxt,
  });

  TG.formatters = {
    get(id) {
      return registry.get(id);
    },
    list() {
      return Array.from(registry.values()).map((f) => ({
        id: f.id,
        label: f.label,
        extension: f.extension,
      }));
    },
  };
})();
