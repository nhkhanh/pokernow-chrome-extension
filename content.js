// PokerNow Sound Replacer - Content Script
// Injects page script and bridges settings from extension storage

(function() {
  'use strict';

  // Inject the page script via src (to avoid CSP inline script issues)
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function() {
    this.remove();
    // Send initial settings after script loads
    sendSettings();
  };
  (document.head || document.documentElement).appendChild(script);

  // Load and send settings to page
  function sendSettings() {
    chrome.storage.local.get(['customSound', 'enabled'], (result) => {
      window.dispatchEvent(new CustomEvent('POKERNOW_SOUND_SETTINGS', {
        detail: {
          customSound: result.customSound || null,
          enabled: result.enabled !== false
        }
      }));
    });
  }

  // Listen for storage changes and forward to page
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      sendSettings();
    }
  });

  // Listen for game log events from inject.js and forward to side panel
  window.addEventListener('POKERNOW_GAME_LOG', (e) => {
    chrome.runtime.sendMessage({
      type: 'POKERNOW_GAME_LOG',
      logType: e.detail.logType,
      message: e.detail.message
    }).catch(() => {
      // Side panel might not be open, ignore errors
    });
  });

  // Listen for Gemini request from inject.js
  window.addEventListener('POKERNOW_SEND_TO_GEMINI', (e) => {
    chrome.runtime.sendMessage({
      type: 'SEND_TO_GEMINI',
      prompt: e.detail.prompt,
      handLog: e.detail.handLog
    }).catch((err) => {
      console.error('[SoundReplacer] Error sending to Gemini:', err);
    });
  });

  // Listen for Gemini response from background and forward to inject.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GEMINI_RESPONSE') {
      window.dispatchEvent(new CustomEvent('POKERNOW_GEMINI_RESPONSE', {
        detail: { response: message.response }
      }));
      sendResponse({ status: 'ok' });
    }
    return true;
  });

  console.log('[SoundReplacer] Content script loaded');
})();
