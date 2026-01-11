// PokerNow Side Panel - Game Log Display

(function() {
  'use strict';

  const logContainer = document.getElementById('log');
  const clearBtn = document.getElementById('clearBtn');
  const askAiBtn = document.getElementById('askAiBtn');

  // Auto-play panel elements
  const autoPlayPanel = document.getElementById('autoPlayPanel');
  const autoPlayStatus = document.getElementById('autoPlayStatus');
  const autoPlayAction = document.getElementById('autoPlayAction');
  const actionType = document.getElementById('actionType');
  const actionReason = document.getElementById('actionReason');
  const countdownProgress = document.getElementById('countdownProgress');
  const countdownText = document.getElementById('countdownText');
  const cancelAutoBtn = document.getElementById('cancelAutoBtn');
  const foldAutoBtn = document.getElementById('foldAutoBtn');
  const callAutoBtn = document.getElementById('callAutoBtn');
  const raiseAutoBtn = document.getElementById('raiseAutoBtn');

  let countdownInterval = null;
  let countdownEndTime = null;

  // Show empty state initially
  showEmptyState();

  // Load auto-play settings to show/hide panel
  chrome.storage.local.get(['autoPlayEnabled'], (result) => {
    if (result.autoPlayEnabled) {
      autoPlayPanel.style.display = 'block';
    }
  });

  // Listen for auto-play settings changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoPlayEnabled) {
      autoPlayPanel.style.display = changes.autoPlayEnabled.newValue ? 'block' : 'none';
    }
  });

  // Clear button handler
  clearBtn.addEventListener('click', () => {
    logContainer.innerHTML = '';
    showEmptyState();
  });

  // Ask AI button handler
  askAiBtn.addEventListener('click', () => {
    // Track manual AI request
    if (window.analytics) {
      window.analytics.sendEvent('manual_ai_request');
    }
    // Send message to background script to trigger AI analysis
    chrome.runtime.sendMessage({ type: 'MANUAL_AI_REQUEST' })
      .catch(err => console.error('[SidePanel] Error sending AI request:', err));
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

  // Escape HTML special characters to prevent XSS and display issues
  function escapeHtml(text) {
    if (!text) return text;
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Format cards with four colors and suit emojis
  // Only format cards in specific contexts where cards appear (not player names)
  function formatCards(text) {
    if (!text) return text;

    const suitMap = { h: '♥', d: '♦', c: '♣', s: '♠' };
    const cardPattern = /\b(10|[AKQJT2-9])([hdcs])\b/gi;

    // Only format cards after these context prefixes
    const contextPrefixes = ['Your cards:', 'FLOP:', 'TURN:', 'RIVER:', 'BOARD:', 'CARDS:', 'shows ', 'with ', 'RABBIT:'];

    let formatted = text;
    for (const prefix of contextPrefixes) {
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(${escapedPrefix}\\s*)(.+)`, 'i');
      formatted = formatted.replace(pattern, (match, pre, cards) => {
        const formattedCards = cards.replace(cardPattern, (m, rank, suit) => {
          return rank.toUpperCase() + suitMap[suit.toLowerCase()];
        });
        return pre + formattedCards;
      });
    }

    // Apply colors to emoji suits (no word boundary - emoji breaks \b)
    return formatted
      .replace(/(10|[AKQJT2-9])(♥)/g, '<span class="cards card-heart">$1$2</span>')
      .replace(/(10|[AKQJT2-9])(♦)/g, '<span class="cards card-diamond">$1$2</span>')
      .replace(/(10|[AKQJT2-9])(♣)/g, '<span class="cards card-club">$1$2</span>')
      .replace(/(10|[AKQJT2-9])(♠)/g, '<span class="cards card-spade">$1$2</span>');
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

  // Extract player name from message (e.g., "PlayerName: FOLD" -> "PlayerName")
  function extractPlayerName(message) {
    const match = message.match(/^([^:]+):/);
    return match ? match[1].trim() : null;
  }

  // Get action type CSS class from message (e.g., "PlayerName: FOLD" -> "action-fold")
  function getActionTypeClass(message) {
    const upperMsg = message.toUpperCase();
    if (upperMsg.includes(': CHECK')) {
      return 'action-check';
    } else if (upperMsg.includes(': FOLD')) {
      return 'action-fold';
    } else if (upperMsg.includes(': CALL') || upperMsg.includes(': LIMP')) {
      return 'action-call';
    } else if (upperMsg.includes(': RAISE') || upperMsg.includes(': BET') || upperMsg.includes(': ALL-IN')) {
      return 'action-raise';
    }
    return 'action'; // default green for unknown actions
  }

  // Add a log entry
  function addLogEntry(type, message) {
    removeEmptyState();

    // If this is an action (my or other), replace matching turn entry
    if (type === 'myaction' || type === 'action') {
      const playerName = extractPlayerName(message);
      const actionTypeClass = getActionTypeClass(message);
      if (playerName) {
        // Find turn entries and look for one matching this player
        const turnEntries = logContainer.querySelectorAll('.log-entry.turn, .log-entry.myturn');
        for (let i = turnEntries.length - 1; i >= 0; i--) {
          const turnEntry = turnEntries[i];
          const turnLabel = turnEntry.querySelector('.label')?.textContent || '';
          // Check if turn entry is for this player (e.g., "PlayerName's turn")
          if (turnLabel.includes(playerName)) {
            const content = turnEntry.querySelector('.label');
            content.innerHTML = formatCards(escapeHtml(message));
            turnEntry.className = `log-entry ${actionTypeClass}`;
            logContainer.scrollTop = logContainer.scrollHeight;
            return;
          }
        }
      }
      // Fallback: add as regular action if no matching turn entry found
      type = actionTypeClass;
    }

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = getTimeString();

    const content = document.createElement('span');
    content.className = 'label';
    content.innerHTML = formatCards(escapeHtml(message));

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
    } else if (message.type === 'AUTO_PLAY_PREVIEW') {
      showAutoPlayPreview(message.action, message.delay);
    } else if (message.type === 'AUTO_PLAY_EXECUTED') {
      hideAutoPlayPreview();
    } else if (message.type === 'AUTO_PLAY_CANCELLED') {
      hideAutoPlayPreview();
    }
  });

  // Auto-play button handlers
  cancelAutoBtn.addEventListener('click', () => {
    sendCancelAutoAction();
    hideAutoPlayPreview();
  });

  foldAutoBtn.addEventListener('click', () => {
    sendManualAction('fold');
  });

  callAutoBtn.addEventListener('click', () => {
    sendManualAction('call');
  });

  raiseAutoBtn.addEventListener('click', () => {
    sendManualAction('raise');
  });

  function showAutoPlayPreview(action, delay) {
    autoPlayStatus.textContent = 'Active';
    autoPlayStatus.classList.add('active');
    autoPlayAction.style.display = 'block';

    // Set action info
    const actionText = action.action.toUpperCase();
    actionType.textContent = actionText + (action.amount ? ` $${action.amount}` : '');
    actionType.className = `action-type ${action.action}`;
    actionReason.textContent = action.reasoning || `${action.hand} - ${action.position}`;

    // Start countdown
    countdownEndTime = Date.now() + delay;
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 100);
  }

  function hideAutoPlayPreview() {
    autoPlayStatus.textContent = 'Ready';
    autoPlayStatus.classList.remove('active');
    autoPlayAction.style.display = 'none';

    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function updateCountdown() {
    if (!countdownEndTime) return;

    const remaining = Math.max(0, countdownEndTime - Date.now());
    const totalDelay = countdownEndTime - (Date.now() - remaining);
    const progress = (1 - remaining / totalDelay) * 100;

    countdownProgress.style.width = progress + '%';
    countdownText.textContent = (remaining / 1000).toFixed(1) + 's';

    if (remaining === 0 && countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function sendCancelAutoAction() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CANCEL_AUTO_ACTION' })
          .catch(err => console.error('[SidePanel] Error cancelling auto-action:', err));
      }
    });
  }

  function sendManualAction(actionType) {
    // Cancel auto-action and let user act manually
    sendCancelAutoAction();
    hideAutoPlayPreview();
    // TODO: Could potentially trigger the action directly if needed
  }

  // Track sidepanel open
  if (window.analytics) {
    window.analytics.sendEvent('sidepanel_open');
  }

  console.log('[SidePanel] Game log panel loaded');
})();
