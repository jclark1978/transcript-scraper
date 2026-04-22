/*
 * Content script entry point. Owns capture state across popup open/close.
 *
 * The popup is stateless: on open it queries GET_STATUS and polls while
 * capture is running. All data lives here.
 */

(() => {
  const TG = (globalThis.TG ||= {});

  // Only the top frame should respond to messages. Teams uses iframes; only
  // the frame containing #OneTranscript is relevant.
  const hasTranscript = () => !!document.querySelector(TG.selectors.ROOT);

  let state = {
    phase: 'idle', // 'idle' | 'capturing' | 'complete' | 'error'
    captured: 0,
    expected: null,
    result: null, // CaptureResult when phase === 'complete'
    error: null,
    startedAt: null,
    lastProgressPhase: null,
  };

  function broadcastPhase(phase, extras = {}) {
    state = { ...state, phase, ...extras };
  }

  function onProgress(p) {
    state.captured = p.captured;
    state.expected = p.expected;
    state.lastProgressPhase = p.phase;
  }

  async function handleStart() {
    if (state.phase === 'capturing') return { ok: false, error: 'already-capturing' };

    broadcastPhase('capturing', {
      captured: 0,
      expected: null,
      result: null,
      error: null,
      startedAt: Date.now(),
    });

    try {
      const result = await TG.capture.start(onProgress);
      broadcastPhase('complete', {
        captured: result.entries.length,
        expected: result.expected,
        result,
        error: null,
      });
      return { ok: true };
    } catch (e) {
      broadcastPhase('error', { error: e.message || String(e), result: null });
      return { ok: false, error: e.message || String(e) };
    }
  }

  function handleStop() {
    TG.capture.stop();
    return { ok: true };
  }

  function handleGetStatus() {
    return {
      phase: state.phase,
      captured: state.captured,
      expected: state.expected,
      error: state.error,
      startedAt: state.startedAt,
      hasTranscriptPanel: hasTranscript(),
      // Don't ship entries until download is requested — keeps messaging small.
      entryCount: state.result ? state.result.entries.length : 0,
      partial: state.result ? state.result.partial : null,
      missingCount: state.result ? state.result.missingCount : null,
      durationMs: state.result ? state.result.durationMs : null,
    };
  }

  function handleGetExport(formatId) {
    if (state.phase !== 'complete' || !state.result) {
      return { ok: false, error: 'no-result' };
    }
    const formatter = TG.formatters.get(formatId || 'txt');
    if (!formatter) return { ok: false, error: `unknown-format:${formatId}` };

    const meta = {
      meetingTitle: TG.detectMeetingTitle(),
      capturedAtISO: new Date(state.startedAt || Date.now()).toISOString(),
      capturedAtLocal: new Date(state.startedAt || Date.now()).toLocaleString(),
      expected: state.result.expected,
      partial: state.result.partial,
      sourceUrl: location.href,
    };

    const content = formatter.format(state.result.entries, meta);
    const filename = TG.buildFilename({ title: meta.meetingTitle, extension: formatter.extension });
    return { ok: true, content, filename, mime: formatter.mime };
  }

  function handleReset() {
    broadcastPhase('idle', {
      captured: 0,
      expected: null,
      result: null,
      error: null,
      startedAt: null,
    });
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Only the frame that actually contains the transcript should respond.
    // Other frames return a marker so the popup can ignore them.
    if (!hasTranscript() && msg?.type !== 'PING') {
      sendResponse({ ok: false, error: 'not-transcript-frame', skip: true });
      return false;
    }

    switch (msg?.type) {
      case 'PING':
        sendResponse({ ok: true, hasTranscriptPanel: hasTranscript() });
        return false;
      case 'GET_STATUS':
        sendResponse(handleGetStatus());
        return false;
      case 'START':
        handleStart().then(sendResponse);
        return true; // async
      case 'STOP':
        sendResponse(handleStop());
        return false;
      case 'GET_EXPORT':
        sendResponse(handleGetExport(msg.formatId));
        return false;
      case 'RESET':
        sendResponse(handleReset());
        return false;
      default:
        sendResponse({ ok: false, error: 'unknown-message' });
        return false;
    }
  });
})();
