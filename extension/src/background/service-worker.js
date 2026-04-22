/*
 * Service worker. Currently minimal — the popup talks to the content script
 * directly via chrome.tabs.sendMessage and performs the download itself.
 *
 * Kept alive here as a no-op listener so MV3 is happy and so we have a
 * place to put future cross-cutting concerns (history, batch export, etc).
 */

chrome.runtime.onInstalled.addListener(() => {
  // Placeholder. Nothing to initialize yet.
});

export {};
