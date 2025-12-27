// PokerNow Sound Replacer - Content Script
// Injects page script and bridges settings from extension storage

(function() {
  'use strict';

  // Inject the main script via src (inline scripts are blocked by CSP)
  // Use async=false to try to block other scripts until ours loads
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.async = false; // Try to load synchronously before other scripts
  script.onload = function() {
    this.remove();
    // Send initial settings after script loads
    sendSettings();
  };
  // Inject into documentElement as early as possible (before head exists)
  (document.documentElement || document.head).appendChild(script);

  // Load and send settings to page
  function sendSettings() {
    chrome.storage.local.get(['customSound', 'enabled', 'aiProvider', 'aiMode', 'displayMode'], (result) => {
      window.dispatchEvent(new CustomEvent('POKERNOW_SOUND_SETTINGS', {
        detail: {
          customSound: result.customSound || null,
          enabled: result.enabled !== false,
          aiProvider: result.aiProvider || 'off',
          aiMode: result.aiMode || 'auto',
          displayMode: result.displayMode || 'bb'
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

  // Listen for AI request from inject.js
  window.addEventListener('POKERNOW_SEND_TO_AI', (e) => {
    chrome.runtime.sendMessage({
      type: 'SEND_TO_AI',
      provider: e.detail.provider,
      handLog: e.detail.handLog
    }).catch((err) => {
      console.error('[SoundReplacer] Error sending to AI:', err);
    });
  });

  // Listen for AI response from background and forward to inject.js
  // Also listen for manual AI request from side panel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AI_RESPONSE') {
      window.dispatchEvent(new CustomEvent('POKERNOW_AI_RESPONSE', {
        detail: { response: message.response }
      }));
      sendResponse({ status: 'ok' });
    } else if (message.type === 'MANUAL_AI_REQUEST') {
      // Forward manual AI request to inject.js
      window.dispatchEvent(new CustomEvent('POKERNOW_MANUAL_AI_REQUEST'));
      sendResponse({ status: 'ok' });
    }
    return true;
  });

  console.log('[SoundReplacer] Content script loaded');
})();
