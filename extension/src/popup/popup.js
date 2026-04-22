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
  btnReset: document.getElementById('btn-reset'),
  hint: document.getElementById('hint'),
};

let activeTabId = null;
let pollTimer = null;

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
  try {
    // Send to the top frame. The Phase 0 spike confirmed #OneTranscript lives
    // in the top frame of teams.microsoft.com, so no frame-walking needed.
    // If that assumption ever breaks, we'll add webNavigation here.
    const res = await chrome.tabs.sendMessage(
      activeTabId,
      { type, ...extra },
      { frameId: 0 },
    );
    return res;
  } catch (e) {
    return { ok: false, error: 'send-failed', detail: e.message };
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

function render(status) {
  if (!status) {
    setStatusClass('error');
    els.statusLabel.textContent = 'No content script responding';
    setHint('This page may not be a Teams transcript page. Open Teams web and load a meeting with a transcript, then reopen this popup.');
    els.btnStart.disabled = true;
    els.btnStart.hidden = false;
    els.btnStop.hidden = true;
    els.btnDownload.hidden = true;
    els.btnReset.hidden = true;
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
  poll();
}

async function onDownload() {
  els.btnDownload.disabled = true;
  const res = await sendToTranscriptFrame('GET_EXPORT', { formatId: 'txt' });
  if (!res || res.ok === false) {
    render({ phase: 'error', error: res?.error || 'export-failed', hasTranscriptPanel: true });
    els.btnDownload.disabled = false;
    return;
  }
  const blob = new Blob([res.content], { type: res.mime });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename: res.filename,
      saveAs: true,
    });
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
  els.btnReset.addEventListener('click', onReset);

  poll();
})();
