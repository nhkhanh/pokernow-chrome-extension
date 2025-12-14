// PokerNow Sound Replacer - Injected into page context
(function() {
  'use strict';

  let customSoundDataUrl = null;
  let customSoundEnabled = true;
  let lastSoundTime = 0;
  let isMyTurnPending = false; // Flag: expecting "your turn" sound
  const DEBOUNCE_MS = 300;
  const TURN_SOUND_WINDOW_MS = 1000; // Window to catch sound after turn detected

  // Last action highlight tracking
  let previousPlayerStates = new Map(); // Map of playerName -> {action, betAmount, isFold}
  let lastActionPlayerSeat = null;

  // Inject CSS for last action highlight
  function injectHighlightStyles() {
    if (document.getElementById('pokernow-last-action-styles')) return;

    const style = document.createElement('style');
    style.id = 'pokernow-last-action-styles';
    style.textContent = `
      .table-player.last-action-highlight {
        box-shadow: 0 0 20px 8px rgba(255, 215, 0, 0.8) !important;
        border-radius: 8px;
        animation: lastActionPulse 1.5s ease-in-out infinite;
      }

      @keyframes lastActionPulse {
        0%, 100% { box-shadow: 0 0 20px 8px rgba(255, 215, 0, 0.8); }
        50% { box-shadow: 0 0 30px 12px rgba(255, 215, 0, 1); }
      }
    `;
    document.head.appendChild(style);
    console.log('[SoundReplacer] 🎨 Last action highlight styles injected');
  }

  // Listen for messages from content script
  window.addEventListener('POKERNOW_SOUND_SETTINGS', (e) => {
    customSoundDataUrl = e.detail.customSound;
    customSoundEnabled = e.detail.enabled;
    console.log('[SoundReplacer] Settings updated:', { hasSound: !!customSoundDataUrl, enabled: customSoundEnabled });
  });

  // Store original Audio for playing our sound
  const OriginalAudio = window.Audio;
  const OriginalPlay = HTMLAudioElement.prototype.play;

  // Play custom sound with debounce
  function playCustomSound() {
    const now = Date.now();
    if (now - lastSoundTime < DEBOUNCE_MS) {
      console.log('[SoundReplacer] Debounced');
      return true;
    }
    lastSoundTime = now;

    if (!customSoundDataUrl) {
      console.log('[SoundReplacer] No custom sound set');
      return false;
    }
    
    try {
      const audio = new OriginalAudio(customSoundDataUrl);
      audio.volume = 1.0;
      OriginalPlay.call(audio).catch(err => {
        console.error('[SoundReplacer] Play error:', err);
      });
      console.log('[SoundReplacer] ▶ Playing custom sound!');
      return true;
    } catch (err) {
      console.error('[SoundReplacer] Error:', err);
      return false;
    }
  }

  // Parse a card element to get its value
  function parseCard(cardContainer) {
    if (!cardContainer) return null;
    
    // Get suit from container class (card-h, card-d, card-s, card-c)
    const classes = Array.from(cardContainer.classList);
    let suit = '';
    if (classes.includes('card-h')) suit = '♥';
    else if (classes.includes('card-d')) suit = '♦';
    else if (classes.includes('card-s')) suit = '♠';
    else if (classes.includes('card-c')) suit = '♣';
    
    // Get value from card-s-X class (e.g., card-s-A, card-s-K, card-s-10)
    const valueClass = classes.find(c => c.startsWith('card-s-'));
    let value = '';
    if (valueClass) {
      value = valueClass.replace('card-s-', '');
    }
    
    // Fallback: try to get from inner .value element
    if (!value) {
      const valueEl = cardContainer.querySelector('.value');
      if (valueEl) value = valueEl.textContent.trim();
    }
    
    if (!value || !suit) return null;
    return value + suit;
  }

  // Get my hole cards
  function getMyCards() {
    const myPlayer = document.querySelector('.table-player.you-player');
    if (!myPlayer) return [];
    
    const cardContainers = myPlayer.querySelectorAll('.table-player-cards .card-container');
    const cards = [];
    cardContainers.forEach(container => {
      const card = parseCard(container);
      if (card) cards.push(card);
    });
    return cards;
  }

  // Get community cards
  function getTableCards() {
    const tableCardsContainer = document.querySelector('.table-cards');
    if (!tableCardsContainer) return [];
    
    const cardContainers = tableCardsContainer.querySelectorAll('.card-container');
    const cards = [];
    cardContainers.forEach(container => {
      const card = parseCard(container);
      if (card) cards.push(card);
    });
    return cards;
  }

  // Get pot size
  function getPotSize() {
    let result = '';
    
    // Main pot
    const mainPotEl = document.querySelector('.table-pot-size .main-value .bb-value');
    if (mainPotEl) {
      result = mainPotEl.textContent.trim();
    }
    
    // Total pot (if there are side pots)
    const totalPotEl = document.querySelector('.table-pot-size .add-on .bb-value');
    if (totalPotEl) {
      const total = totalPotEl.textContent.trim();
      if (total && total !== result) {
        result += ` (total: ${total})`;
      }
    }
    
    return result || 'unknown';
  }

  // Get dealer position
  function getDealerPosition() {
    const dealerBtn = document.querySelector('.dealer-button-ctn');
    if (dealerBtn) {
      const classes = Array.from(dealerBtn.classList);
      const posClass = classes.find(c => c.startsWith('dealer-position-'));
      if (posClass) {
        return posClass.replace('dealer-position-', '');
      }
    }
    return null;
  }

  // Get table status for logging
  function getTableStatus() {
    const players = document.querySelectorAll('.table-player');
    const dealerPos = getDealerPosition();
    const tableCards = document.querySelectorAll('.table-cards .card-container');
    const isPreflop = tableCards.length === 0;
    
    const status = {
      players: [],
      currentTurn: null,
      youPlayer: null,
      isYourTurn: false,
      pot: getPotSize(),
      dealerPosition: dealerPos,
      isPreflop: isPreflop
    };

    // First pass: collect all players with their seat numbers
    const playerList = [];
    players.forEach(player => {
      const nameEl = player.querySelector('.table-player-name a');
      const name = nameEl ? nameEl.textContent.trim() : 'Unknown';
      const classes = Array.from(player.classList);
      
      // Get seat number from class (table-player-1, table-player-3, etc.)
      const seatClass = classes.find(c => c.match(/^table-player-\d+$/));
      const seatNum = seatClass ? parseInt(seatClass.replace('table-player-', '')) : 0;
      
      // Get stack
      const stackBB = player.querySelector('.table-player-stack .bb-value');
      const stackNormal = player.querySelector('.table-player-stack .normal-value');
      let stack = '';
      if (stackBB) {
        stack = stackBB.textContent.trim();
      } else if (stackNormal) {
        stack = stackNormal.textContent.trim();
      }

      // Get bet amount
      const betEl = player.querySelector('.table-player-bet-value');
      const statusIcon = player.querySelector('.table-player-status-icon');
      let betAmount = 0;
      let betText = '';
      let rawAction = '';
      
      if (betEl) {
        const bbValue = betEl.querySelector('.bb-value');
        if (bbValue) {
          betText = bbValue.textContent.trim();
          // Parse the number from "0.5BB" or "1BB"
          betAmount = parseFloat(betText.replace('BB', ''));
        } else {
          rawAction = betEl.textContent.trim(); // "check" etc
        }
      } else if (statusIcon) {
        rawAction = statusIcon.textContent.trim(); // "Fold", "Away (Offline)"
      }

      playerList.push({
        name: name,
        seat: seatNum,
        stack: stack,
        betAmount: betAmount,
        betText: betText,
        rawAction: rawAction,
        isYou: classes.includes('you-player'),
        hasDecision: classes.includes('decision-current'),
        isFold: classes.includes('fold'),
        isOffline: classes.includes('offline'),
        isDealer: seatNum === parseInt(dealerPos)
      });
    });

    // Sort by seat to find SB/BB positions
    const sortedByPosition = [...playerList].sort((a, b) => a.seat - b.seat);
    const dealerPosNum = parseInt(dealerPos) || 0;
    
    // Find active players (not folded, not offline) after dealer
    const activePlayers = sortedByPosition.filter(p => !p.isFold || p.betAmount > 0);
    
    // Find SB and BB (first two positions after dealer that are active)
    let sbPlayer = null;
    let bbPlayer = null;
    
    if (isPreflop && activePlayers.length >= 2) {
      // Sort active players by distance from dealer
      const afterDealer = activePlayers.map(p => ({
        ...p,
        distFromDealer: p.seat > dealerPosNum ? p.seat - dealerPosNum : p.seat + 100 - dealerPosNum
      })).sort((a, b) => a.distFromDealer - b.distFromDealer);
      
      sbPlayer = afterDealer[0]?.name;
      bbPlayer = afterDealer[1]?.name;
    }

    // Find max bet for determining raises
    const maxBet = Math.max(...playerList.map(p => p.betAmount), 0);
    const bbAmount = 1; // Standard BB

    // Second pass: determine action types
    playerList.forEach(p => {
      let action = '';
      
      if (p.rawAction) {
        action = p.rawAction.toLowerCase();
      } else if (p.betAmount > 0) {
        if (isPreflop) {
          if (p.name === sbPlayer && p.betAmount === 0.5) {
            action = 'SB';
          } else if (p.name === bbPlayer && p.betAmount === bbAmount) {
            action = 'BB';
          } else if (p.betAmount === bbAmount) {
            action = 'limp';
          } else if (p.betAmount > bbAmount && p.betAmount === maxBet) {
            action = `raise ${p.betText}`;
          } else if (p.betAmount > bbAmount && p.betAmount < maxBet) {
            action = `call ${p.betText}`;
          } else {
            action = `bet ${p.betText}`;
          }
        } else {
          // Postflop
          if (p.betAmount === maxBet && maxBet > 0) {
            action = `bet ${p.betText}`;
          } else if (p.betAmount < maxBet) {
            action = `call ${p.betText}`;
          } else {
            action = `bet ${p.betText}`;
          }
        }
      } else if (p.isFold) {
        action = 'fold';
      }

      status.players.push({
        ...p,
        action: action
      });

      if (p.hasDecision) {
        status.currentTurn = p.name;
      }
      if (p.isYou) {
        status.youPlayer = p.name;
      }
      if (p.isYou && p.hasDecision) {
        status.isYourTurn = true;
      }
    });

    return status;
  }

  // Log table status
  function logTableStatus(trigger) {
    const status = getTableStatus();
    const myCards = getMyCards();
    const tableCards = getTableCards();
    
    // Determine street
    let street = 'preflop';
    if (tableCards.length === 3) street = 'flop';
    else if (tableCards.length === 4) street = 'turn';
    else if (tableCards.length === 5) street = 'river';
    
    console.log(`[SoundReplacer] ═══════════════════════════════════════════════════`);
    console.log(`[SoundReplacer] 📊 Table Status (${trigger})`);
    console.log(`[SoundReplacer] ═══════════════════════════════════════════════════`);
    console.log(`[SoundReplacer] 💰 Pot: ${status.pot}`);
    console.log(`[SoundReplacer] 🃏 My Cards: ${myCards.length > 0 ? myCards.join(' ') : 'hidden/none'}`);
    console.log(`[SoundReplacer] 🎴 Board: ${tableCards.length > 0 ? tableCards.join(' ') : '(none)'} [${street}]`);
    console.log(`[SoundReplacer] 👤 You: ${status.youPlayer || 'Not found'}`);
    console.log(`[SoundReplacer] 🎯 Current Turn: ${status.currentTurn || 'None'}`);
    console.log(`[SoundReplacer] ⚡ Is Your Turn: ${status.isYourTurn ? '✅ YES' : '❌ NO'}`);
    console.log(`[SoundReplacer] ───────────────────────────────────────────────────`);
    console.log(`[SoundReplacer] 👥 Players:`);
    status.players.forEach(p => {
      let markers = '';
      if (p.isYou) markers += '👤';
      if (p.hasDecision) markers += '🎯';
      if (p.isDealer) markers += '🔘';
      if (p.isOffline) markers += '💤';
      
      let actionStr = p.action ? `[${p.action}]` : '';
      
      console.log(`[SoundReplacer]   ${markers.padEnd(6)} ${p.name.padEnd(10)} | ${p.stack.padEnd(12)} | ${actionStr}`);
    });
    console.log(`[SoundReplacer] ═══════════════════════════════════════════════════`);
    return status;
  }

  // Detect and highlight the player who made the last action
  function highlightLastAction(status) {
    // Remove previous highlight
    const previousHighlight = document.querySelector('.table-player.last-action-highlight');
    if (previousHighlight) {
      previousHighlight.classList.remove('last-action-highlight');
    }

    // Find who just acted by comparing with previous state
    let lastActedPlayer = null;

    for (const player of status.players) {
      const prevState = previousPlayerStates.get(player.name);

      // Skip the player whose turn it is (they haven't acted yet)
      if (player.hasDecision) continue;

      if (!prevState) {
        // New player - check if they have an action
        if (player.action && player.action !== 'SB' && player.action !== 'BB') {
          lastActedPlayer = player;
        }
      } else {
        // Check if action changed
        const actionChanged = prevState.action !== player.action;
        const betChanged = prevState.betAmount !== player.betAmount;
        const foldChanged = prevState.isFold !== player.isFold;

        if (actionChanged || betChanged || foldChanged) {
          // This player just acted
          if (player.action && player.action !== prevState.action) {
            lastActedPlayer = player;
          }
        }
      }
    }

    // Update previous states for next comparison
    previousPlayerStates.clear();
    for (const player of status.players) {
      previousPlayerStates.set(player.name, {
        action: player.action,
        betAmount: player.betAmount,
        isFold: player.isFold
      });
    }

    // Apply highlight to the player who just acted
    if (lastActedPlayer && lastActedPlayer.seat) {
      const playerEl = document.querySelector(`.table-player-${lastActedPlayer.seat}`);
      if (playerEl) {
        playerEl.classList.add('last-action-highlight');
        lastActionPlayerSeat = lastActedPlayer.seat;
        console.log(`[SoundReplacer] 🔆 Highlighting last action: ${lastActedPlayer.name} [${lastActedPlayer.action}]`);
      }
    }
  }

  // Detect when it's my turn by watching for UI changes
  function setupTurnDetection() {
    // Inject highlight styles
    injectHighlightStyles();

    let wasMyTurn = false;

    // Check if it's currently my turn
    function checkIfMyTurn() {
      // Your turn = has both "decision-current" AND "you-player" classes
      const myTurnElement = document.querySelector('.table-player.decision-current.you-player');
      return !!myTurnElement;
    }

    // Method 1: MutationObserver for class changes
    const observer = new MutationObserver((mutations) => {
      // Check if any mutation involves decision-current class
      let shouldCheck = false;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target;
          if (target.classList && target.classList.contains('table-player')) {
            shouldCheck = true;
            break;
          }
        }
      }

      if (!shouldCheck) return;

      const isMyTurn = checkIfMyTurn();

      // Log status on any player change
      const status = logTableStatus('mutation');

      // Highlight the player who just made an action
      highlightLastAction(status);
      
      // Only trigger when turn STARTS (transitions from not-my-turn to my-turn)
      if (isMyTurn && !wasMyTurn) {
        console.log('[SoundReplacer] 🎯🎯🎯 MY TURN STARTED! 🎯🎯🎯');
        isMyTurnPending = true;
        // Reset flag after window expires
        setTimeout(() => {
          if (isMyTurnPending) {
            console.log('[SoundReplacer] Turn window expired, no sound was triggered');
          }
          isMyTurnPending = false;
        }, TURN_SOUND_WINDOW_MS);
      } else if (!isMyTurn && wasMyTurn) {
        console.log('[SoundReplacer] My turn ended');
      }
      
      wasMyTurn = isMyTurn;
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });

    // Initial check
    wasMyTurn = checkIfMyTurn();
    const initialStatus = logTableStatus('initial');

    // Initialize previous states (don't highlight on initial load)
    for (const player of initialStatus.players) {
      previousPlayerStates.set(player.name, {
        action: player.action,
        betAmount: player.betAmount,
        isFold: player.isFold
      });
    }
  }

  // ============================================
  // INTERCEPT AND SELECTIVELY REPLACE SOUNDS
  // ============================================
  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OriginalAudioContext) {
    const origCreateBufferSource = OriginalAudioContext.prototype.createBufferSource;
    OriginalAudioContext.prototype.createBufferSource = function() {
      const source = origCreateBufferSource.call(this);
      const origStart = source.start.bind(source);
      
      source.start = function(...args) {
        console.log('[SoundReplacer] AudioContext.start() called | isMyTurnPending:', isMyTurnPending);
        
        // Only replace if it's my turn and replacement is enabled
        if (customSoundEnabled && customSoundDataUrl && isMyTurnPending) {
          console.log('[SoundReplacer] ✅ Replacing YOUR TURN sound');
          playCustomSound();
          isMyTurnPending = false; // Reset flag
          return; // Don't play original
        }
        
        // Otherwise play original sound
        console.log('[SoundReplacer] ➡️ Playing original sound (not your turn)');
        return origStart(...args);
      };
      
      return source;
    };
  }

  // Also intercept HTMLAudioElement just in case
  HTMLAudioElement.prototype.play = function() {
    const src = this.src || this.currentSrc || '';
    console.log('[SoundReplacer] audio.play() called | isMyTurnPending:', isMyTurnPending, '| src:', src);
    
    if (customSoundEnabled && customSoundDataUrl && isMyTurnPending) {
      console.log('[SoundReplacer] ✅ Replacing YOUR TURN audio.play()');
      playCustomSound();
      isMyTurnPending = false;
      return Promise.resolve();
    }
    return OriginalPlay.apply(this, arguments);
  };

  // Start turn detection when DOM is ready
  if (document.body) {
    setupTurnDetection();
  } else {
    document.addEventListener('DOMContentLoaded', setupTurnDetection);
  }

  console.log('[SoundReplacer] ✓ Page script loaded - waiting for your turn');
})();
