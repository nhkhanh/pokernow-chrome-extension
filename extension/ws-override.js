// WebSocket override - must run before any page scripts
(function() {
  'use strict';

  if (window.__pokerNowWsOverrideInstalled) return;
  window.__pokerNowWsOverrideInstalled = true;

  console.log('[SoundReplacer] WebSocket override installing (early injection)...');

  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    const socket = protocols
      ? new OriginalWebSocket(url, protocols)
      : new OriginalWebSocket(url);

    if (url && url.includes('pokernow.com')) {
      console.log('[SoundReplacer] 🔌 Intercepted PokerNow WebSocket:', url);

      socket.addEventListener('message', (event) => {
        if (typeof window.__pokerNowParseSocketMessage === 'function') {
          window.__pokerNowParseSocketMessage(event.data);
        }
      });
    }

    return socket;
  };

  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  console.log('[SoundReplacer] ✓ WebSocket override installed');
})();
