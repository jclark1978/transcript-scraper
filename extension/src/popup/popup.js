/*
 * Popup — stateless. All capture state lives in the content script; the popup
 * polls GET_STATUS while capture is running and reflects the latest snapshot.
 */

const els = {
  statusBox: document.getElementById('status'),
  statusLabel: document.getElementById('status-label'),
  statusProgress: document.getElementById('status-progress'),
  statusNumbers: document.getElementById('status-numbers'),
  statusError: document.getElementById('status-error'),
  barFill: document.getElementById('bar-fill'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnDownload: document.getElementById('btn-download'),
  btnCopy: document.getElementById('btn-copy'),
  btnOpen: document.getElementById('btn-open'),
  btnReset: document.getElementById('btn-reset'),
  exportPreview: document.getElementById('export-preview'),
  exportContent: document.getElementById('export-content'),
  hint: document.getElementById('hint'),
};

let activeTabId = null;
let pollTimer = null;
let transcriptFrameId = null;
let lastExport = null;

const CONTENT_SCRIPT_FILES = [
  'src/shared/selectors.js',
  'src/shared/extractor.js',
  'src/shared/formatter.js',
  'src/shared/filename.js',
  'src/content/capture.js',
  'src/content/content.js',
];

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function isTeamsUrl(url) {
  if (!url) return false;
  if (/^https:\/\/teams\.microsoft\.com\//.test(url)) return true;
  if (/^https:\/\/teams\.live\.com\//.test(url)) return true;
  if (/^https:\/\/teams\.cloud\.microsoft\//.test(url)) return true;
  // Teams Recap / transcript viewer is served from SharePoint as an
  // xplatplugins.aspx page — observed at *-my.sharepoint.com for tenants.
  if (/^https:\/\/[^/]+\.sharepoint\.com\/.*\/_layouts\/15\/xplatplugins\.aspx/i.test(url)) return true;
  return false;
}

async function sendToTranscriptFrame(type, extra = {}) {
  if (activeTabId == null) return { ok: false, error: 'no-tab' };

  let frameId = await resolveTranscriptFrame();
  if (frameId == null) {
    return { ok: false, error: 'no-transcript-frame' };
  }

  try {
    const res = await chrome.tabs.sendMessage(activeTabId, { type, ...extra }, { frameId });
    return res;
  } catch (e) {
    if (/Receiving end does not exist/i.test(e.message || '')) {
      try {
        transcriptFrameId = null;
        frameId = await resolveTranscriptFrame();
        if (frameId == null) {
          return { ok: false, error: 'no-transcript-frame' };
        }
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId, frameIds: [frameId] },
          files: CONTENT_SCRIPT_FILES,
        });
        const res = await chrome.tabs.sendMessage(activeTabId, { type, ...extra }, { frameId });
        return res;
      } catch (retryError) {
        return { ok: false, error: 'send-failed', detail: retryError.message };
      }
    }
    return { ok: false, error: 'send-failed', detail: e.message };
  }
}

async function resolveTranscriptFrame() {
  if (activeTabId == null) return null;
  if (transcriptFrameId != null) return transcriptFrameId;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabId, allFrames: true },
      func: () => !!document.querySelector('#OneTranscript'),
    });
    const match = results.find((result) => result.result === true);
    transcriptFrameId = match?.frameId ?? null;
    return transcriptFrameId;
  } catch {
    transcriptFrameId = null;
    return null;
  }
}

function setStatusClass(name) {
  els.statusBox.className = `status status--${name}`;
}

function setHint(text) {
  if (text) {
    els.hint.textContent = text;
    els.hint.hidden = false;
  } else {
    els.hint.hidden = true;
  }
}

async function openExportInNewTab(url) {
  if (chrome.tabs?.create) {
    await chrome.tabs.create({ url });
    return true;
  }

  const opened = window.open(url, '_blank', 'noopener');
  return !!opened;
}

async function copyExportToClipboard(content) {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

function setExport(res) {
  if (!res?.content) {
    lastExport = null;
    els.exportPreview.hidden = true;
    els.exportContent.value = '';
    els.btnCopy.hidden = true;
    els.btnOpen.hidden = true;
    return;
  }

  lastExport = res;
  els.exportPreview.hidden = false;
  els.exportContent.value = res.content;
  els.btnCopy.hidden = false;
  els.btnOpen.hidden = false;
}

function render(status) {
  if (!status) {
    setStatusClass('error');
    els.statusLabel.textContent = 'No content script responding';
    setHint('This page may not be a Teams transcript page. Open Teams web and load a meeting with a transcript, then reopen this popup.');
    els.btnStart.disabled = true;
    els.btnStart.hidden = false;
    els.btnStop.hidden = true;
    els.btnDownload.hidden = true;
    els.btnCopy.hidden = true;
    els.btnOpen.hidden = true;
    els.btnReset.hidden = true;
    els.exportPreview.hidden = true;
    return;
  }

  if (status.error) {
    setStatusClass('error');
    els.statusLabel.textContent = 'Error';
    els.statusError.textContent = status.error;
    els.statusError.hidden = false;
    els.statusProgress.hidden = true;
    els.btnStart.hidden = false;
    els.btnStart.disabled = !status.hasTranscriptPanel;
    els.btnStop.hidden = true;
    els.btnDownload.hidden = true;
    els.btnCopy.hidden = true;
    els.btnOpen.hidden = true;
    els.btnReset.hidden = false;
    setHint(null);
    return;
  }
  els.statusError.hidden = true;

  switch (status.phase) {
    case 'idle': {
      setStatusClass('idle');
      if (!status.hasTranscriptPanel) {
        els.statusLabel.textContent = 'Transcript panel not detected';
        setHint('Open the transcript panel in Teams (Show transcript in the meeting view), then try again.');
        els.btnStart.disabled = true;
      } else {
        els.statusLabel.textContent = 'Ready to capture';
        setHint('This scrolls the transcript pane to capture every entry. Leave Teams focused while it runs.');
        els.btnStart.disabled = false;
      }
      els.statusProgress.hidden = true;
      els.btnStart.hidden = false;
      els.btnStop.hidden = true;
      els.btnDownload.hidden = true;
      els.btnCopy.hidden = true;
      els.btnOpen.hidden = true;
      els.btnReset.hidden = true;
      break;
    }
    case 'capturing': {
      setStatusClass('capturing');
      els.statusLabel.textContent = 'Capturing…';
      const captured = status.captured || 0;
      const expected = status.expected || 0;
      const pct = expected ? Math.min(100, (captured / expected) * 100) : 0;
      els.barFill.style.width = `${pct}%`;
      els.statusNumbers.textContent = expected
        ? `${captured} / ${expected} entries`
        : `${captured} entries captured`;
      els.statusProgress.hidden = false;
      els.btnStart.hidden = true;
      els.btnStop.hidden = false;
      els.btnDownload.hidden = true;
      els.btnCopy.hidden = true;
      els.btnOpen.hidden = true;
      els.btnReset.hidden = true;
      setHint('Do not scroll the transcript manually while capture runs.');
      break;
    }
    case 'complete': {
      setStatusClass('complete');
      const captured = status.entryCount || 0;
      const expected = status.expected || 0;
      const partial = status.partial;
      els.statusLabel.textContent = partial
        ? `Captured ${captured} entries (partial)`
        : `Captured ${captured} entries`;
      els.barFill.style.width = '100%';
      els.statusNumbers.textContent = expected
        ? `${captured} of ${expected}${status.missingCount ? ` — ${status.missingCount} missing` : ''}`
        : `${captured} entries`;
      els.statusProgress.hidden = false;
      els.btnStart.hidden = true;
      els.btnStop.hidden = true;
      els.btnDownload.hidden = false;
      els.btnCopy.hidden = false;
      els.btnOpen.hidden = false;
      els.btnReset.hidden = false;
      setHint(partial
        ? 'Capture was stopped before completion. The downloaded file will note it is partial.'
        : null);
      break;
    }
    default: {
      setStatusClass('idle');
      els.statusLabel.textContent = status.phase || 'Unknown';
    }
  }
}

async function poll() {
  const res = await sendToTranscriptFrame('GET_STATUS');
  if (res?.error === 'no-transcript-frame') {
    pollTimer = null;
    render({
      phase: 'idle',
      hasTranscriptPanel: false,
      error: null,
    });
    return;
  }
  render(res && res.ok !== false ? res : null);
  if (res && res.phase === 'capturing') {
    pollTimer = setTimeout(poll, 500);
  } else {
    pollTimer = null;
  }
}

async function onStart() {
  els.btnStart.disabled = true;
  const res = await sendToTranscriptFrame('START');
  if (res?.ok === false && res.error) {
    render({ phase: 'error', error: res.error, hasTranscriptPanel: true });
    return;
  }
  poll();
}

async function onStop() {
  await sendToTranscriptFrame('STOP');
  poll();
}

async function onReset() {
  await sendToTranscriptFrame('RESET');
  transcriptFrameId = null;
  setExport(null);
  poll();
}

async function getExport() {
  const res = await sendToTranscriptFrame('GET_EXPORT', { formatId: 'txt' });
  if (!res || res.ok === false) {
    return null;
  }
  setExport(res);
  return res;
}

async function onCopy() {
  const res = lastExport || await getExport();
  if (!res) {
    render({ phase: 'error', error: 'export-failed', hasTranscriptPanel: true });
    return;
  }

  const copied = await copyExportToClipboard(res.content);
  if (copied) {
    setHint('Transcript copied to your clipboard.');
  } else {
    render({ phase: 'error', error: 'Clipboard copy failed in this browser.', hasTranscriptPanel: true });
  }
}

async function onOpen() {
  const res = lastExport || await getExport();
  if (!res) {
    render({ phase: 'error', error: 'export-failed', hasTranscriptPanel: true });
    return;
  }

  const blob = new Blob([res.content], { type: res.mime });
  const url = URL.createObjectURL(blob);
  try {
    const opened = await openExportInNewTab(url);
    if (!opened) {
      render({ phase: 'error', error: 'Opening the transcript in a new tab failed.', hasTranscriptPanel: true });
      return;
    }
    setHint('Transcript opened in a new tab.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function onDownload() {
  els.btnDownload.disabled = true;
  const res = lastExport || await getExport();
  if (!res) {
    render({ phase: 'error', error: 'export-failed', hasTranscriptPanel: true });
    els.btnDownload.disabled = false;
    return;
  }
  const blob = new Blob([res.content], { type: res.mime });
  const url = URL.createObjectURL(blob);
  try {
    let started = false;
    let usedFallback = false;
    let copied = false;

    if (chrome.downloads?.download) {
      try {
        const downloadId = await chrome.downloads.download({
          url,
          filename: res.filename,
          saveAs: true,
        });
        started = Number.isInteger(downloadId);
      } catch (downloadError) {
        // Some Chromium variants expose partial extension APIs or silently
        // reject saveAs. Fall back to a normal browser download below.
      }
    }

    if (!started) {
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = res.filename;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        started = true;
        usedFallback = true;
      } catch {
        // Ignore and continue to non-download fallbacks.
      }
    }

    if (!started) {
      started = await openExportInNewTab(url);
      usedFallback = usedFallback || started;
    }

    if (!started) {
      copied = await copyExportToClipboard(res.content);
      if (copied) {
        started = true;
        usedFallback = true;
      }
    }

    if (!started) {
      throw new Error('Atlas blocked file download, opening a new tab, and clipboard copy.');
    }

    if (usedFallback) {
      setHint(copied
        ? 'Atlas blocked direct file saving. The transcript was copied to your clipboard.'
        : 'Atlas blocked direct file saving. The transcript was opened using a browser fallback.');
    }
  } catch (e) {
    render({ phase: 'error', error: `Download failed: ${e.message}`, hasTranscriptPanel: true });
  } finally {
    // Revoke after a delay so the download has time to start.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    els.btnDownload.disabled = false;
  }
}

(async function init() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;

  if (!tab || !isTeamsUrl(tab.url)) {
    render({
      phase: 'error',
      error: 'Open a Teams meeting transcript first. This works on teams.microsoft.com, teams.live.com, teams.cloud.microsoft, or the SharePoint-hosted Teams Recap page (*.sharepoint.com/.../xplatplugins.aspx).',
      hasTranscriptPanel: false,
    });
    return;
  }

  els.btnStart.addEventListener('click', onStart);
  els.btnStop.addEventListener('click', onStop);
  els.btnDownload.addEventListener('click', onDownload);
  els.btnCopy.addEventListener('click', onCopy);
  els.btnOpen.addEventListener('click', onOpen);
  els.btnReset.addEventListener('click', onReset);

  poll();
})();
