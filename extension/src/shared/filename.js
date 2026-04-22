/*
 * Filename generation. Best-effort meeting title detection; falls back to
 * timestamp-only when no title is available.
 */

(() => {
  const TG = (globalThis.TG ||= {});

  function slugify(raw, maxLen = 60) {
    if (!raw) return '';
    return raw
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, maxLen)
      .replace(/^-+|-+$/g, '');
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  TG.detectMeetingTitle = function detectMeetingTitle() {
    // Strategy: walk a few known candidate selectors, reject obvious generic
    // chrome titles like "Microsoft Teams". Best-effort.
    const candidates = [
      'h1[data-tid*="meeting"]',
      'h2[data-tid*="meeting"]',
      '[data-tid="meeting-title"]',
      '[data-tid="page-title"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.innerText || '').trim();
        if (t && !/^microsoft teams$/i.test(t)) return t;
      }
    }
    const pageTitle = (document.title || '').trim();
    if (pageTitle && !/^microsoft teams$/i.test(pageTitle)) {
      // Teams often uses "Title | Microsoft Teams"
      return pageTitle.split('|')[0].trim() || null;
    }
    return null;
  };

  TG.buildFilename = function buildFilename({ title, extension, now = new Date() }) {
    const y = now.getFullYear();
    const m = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    const hh = pad2(now.getHours());
    const mm = pad2(now.getMinutes());
    const datePart = `${y}-${m}-${d}_${hh}${mm}`;
    const slug = slugify(title);
    const base = slug ? `Teams-Transcript_${slug}_${datePart}` : `Teams-Transcript_${datePart}`;
    return `${base}.${extension}`;
  };
})();
