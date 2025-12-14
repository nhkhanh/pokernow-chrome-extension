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

  console.log('[SoundReplacer] Content script loaded');
})();
