// PokerNow Side Panel - Game Log Display

(function() {
  'use strict';

  const logContainer = document.getElementById('log');
  const clearBtn = document.getElementById('clearBtn');

  // Show empty state initially
  showEmptyState();

  // Clear button handler
  clearBtn.addEventListener('click', () => {
    logContainer.innerHTML = '';
    showEmptyState();
  });

  function showEmptyState() {
    logContainer.innerHTML = `
      <div class="empty-state">
        <p>No game activity yet</p>
        <p>Open a PokerNow table to see the log</p>
      </div>
    `;
  }

  function removeEmptyState() {
    const emptyState = logContainer.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }
  }

  // Format cards with four colors
  function formatCards(text) {
    if (!text) return text;
    return text
      .replace(/([AKQJT0-9]+)(♥)/g, '<span class="cards card-heart">$1$2</span>')
      .replace(/([AKQJT0-9]+)(♦)/g, '<span class="cards card-diamond">$1$2</span>')
      .replace(/([AKQJT0-9]+)(♣)/g, '<span class="cards card-club">$1$2</span>')
      .replace(/([AKQJT0-9]+)(♠)/g, '<span class="cards card-spade">$1$2</span>');
  }

  // Get current time string
  function getTimeString() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  // Add a log entry
  function addLogEntry(type, message) {
    removeEmptyState();

    // If this is my action, replace the last "turn" entry
    if (type === 'myaction') {
      const turnEntries = logContainer.querySelectorAll('.log-entry.turn');
      const lastTurn = turnEntries[turnEntries.length - 1];
      if (lastTurn) {
        const content = lastTurn.querySelector('.label');
        content.innerHTML = formatCards(message);
        lastTurn.className = 'log-entry action';
        logContainer.scrollTop = logContainer.scrollHeight;
        return;
      }
      // Fallback: add as regular action if no turn entry found
      type = 'action';
    }

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = getTimeString();

    const content = document.createElement('span');
    content.className = 'label';
    content.innerHTML = formatCards(message);

    entry.appendChild(time);
    entry.appendChild(content);
    logContainer.appendChild(entry);

    // Auto-scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'POKERNOW_GAME_LOG') {
      addLogEntry(message.logType, message.message);
    }
  });

  console.log('[SidePanel] Game log panel loaded');
})();
