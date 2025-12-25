// PokerNow Sound Replacer - Injected into page context
(function() {
  'use strict';

  let customSoundDataUrl = null;
  let customSoundEnabled = true;
  let lastSoundTime = 0;
  let isMyTurnPending = false; // Flag: expecting "your turn" sound
  let audioUnlocked = false; // Track if audio has been unlocked via user interaction
  const DEBOUNCE_MS = 300;
  const TURN_SOUND_WINDOW_MS = 2000; // Window to catch sound after turn detected (increased)
  const SOUND_CHECK_DELAY_MS = 150; // Delay before fallback sound plays

  // Last action highlight tracking
  let previousPlayerStates = new Map(); // Map of playerName -> {action, betAmount, isFold}

  // Game state tracking for logging
  let lastTableCardCount = -1; // Track board cards to detect new game
  let lastDealerPosition = null; // Track dealer position to detect new hand
  let gameStartLogged = false; // Only log full status once per game
  let winnerLogged = false; // Track if winner was logged for current hand
  let bbPlayerName = null; // Track BB player for inferring check action
  let actionOrder = []; // Expected action order based on position
  let playersActedThisRound = new Set(); // Track who has acted in current betting round
  let streetHadBets = false; // Track if any bets were made on current street

  // Dispatch log event to side panel via content script
  function dispatchLogEvent(logType, message) {
    window.dispatchEvent(new CustomEvent('POKERNOW_GAME_LOG', {
      detail: { logType, message }
    }));
  }

  // Unlock audio on first user interaction (required by browsers)
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    console.log('[SoundReplacer] 🔓 Audio unlocked via user interaction');

    // Create our own AudioContext for fallback use
    if (!unlockedAudioContext) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          unlockedAudioContext = new AudioContextClass();
          console.log('[SoundReplacer] 🔊 Created AudioContext for fallback');
        }
      } catch (e) {
        console.error('[SoundReplacer] Failed to create AudioContext:', e);
      }
    }

    // Remove listeners after unlock
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  }
  document.addEventListener('click', unlockAudio);
  document.addEventListener('keydown', unlockAudio);
  document.addEventListener('touchstart', unlockAudio);

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

  // Store a reference to an unlocked AudioContext for playing sounds
  let unlockedAudioContext = null;

  // Play custom sound using AudioContext (preferred) or fallback to Audio element
  function playCustomSound(audioContext) {
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

    // Use provided AudioContext, stored context, or create new one
    const ctx = audioContext || unlockedAudioContext;

    if (ctx) {
      // Play via AudioContext (bypasses autoplay restrictions if context is unlocked)
      playViaAudioContext(ctx);
      return true;
    }

    // Fallback to Audio element (may fail if not unlocked)
    try {
      const audio = new OriginalAudio(customSoundDataUrl);
      audio.volume = 1.0;
      OriginalPlay.call(audio).catch(err => {
        console.error('[SoundReplacer] Play error:', err);
      });
      console.log('[SoundReplacer] ▶ Playing custom sound (Audio element)');
      return true;
    } catch (err) {
      console.error('[SoundReplacer] Error:', err);
      return false;
    }
  }

  // Play sound using AudioContext (works without user gesture if context is unlocked)
  function playViaAudioContext(ctx) {
    // Decode base64 data URL to ArrayBuffer
    const base64 = customSoundDataUrl.split(',')[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    ctx.decodeAudioData(bytes.buffer.slice(0), (buffer) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      console.log('[SoundReplacer] ▶ Playing custom sound (AudioContext)');
    }, (err) => {
      console.error('[SoundReplacer] decodeAudioData error:', err);
    });
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

  // Calculate action order based on dealer position and street
  function calculateActionOrder(status, isPreflop) {
    const dealerPosNum = parseInt(status.dealerPosition) || 0;

    // Get active players (not folded, not offline) sorted by distance from dealer
    const activePlayers = status.players
      .filter(p => !p.isFold && !p.isOffline)
      .map(p => ({
        ...p,
        distFromDealer: p.seat > dealerPosNum ? p.seat - dealerPosNum : p.seat + 100 - dealerPosNum
      }))
      .sort((a, b) => a.distFromDealer - b.distFromDealer);

    if (isPreflop) {
      // Preflop: action starts after BB (position 3+), then SB, then BB
      const sbIdx = activePlayers.findIndex(p => p.name === status.sbPlayer);
      const bbIdx = activePlayers.findIndex(p => p.name === status.bbPlayer);

      // Move players before and including BB to the end (they act last preflop)
      const afterBB = activePlayers.filter((p, i) => i > bbIdx);
      const sbBB = activePlayers.filter((p, i) => i <= bbIdx);
      return [...afterBB, ...sbBB].map(p => p.name);
    } else {
      // Postflop: action starts from first active player after dealer
      return activePlayers.map(p => p.name);
    }
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
    // Count how many players have the max bet (to distinguish raise vs call)
    const playersAtMaxBet = playerList.filter(p => p.betAmount === maxBet && maxBet > bbAmount).length;

    // Second pass: determine action types
    let raiserFound = false;
    playerList.forEach(p => {
      let action = '';

      // Check fold first - folded players with blinds still show bet amount
      if (p.isFold) {
        action = 'fold';
      } else if (p.rawAction) {
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
            // First player at max bet is raiser, rest are callers
            if (!raiserFound) {
              action = `raise ${p.betText}`;
              raiserFound = true;
            } else {
              action = `call ${p.betText}`;
            }
          } else if (p.betAmount > bbAmount && p.betAmount < maxBet) {
            action = `call ${p.betText}`;
          } else {
            action = `bet ${p.betText}`;
          }
        } else {
          // Postflop
          if (p.betAmount === maxBet && maxBet > 0) {
            if (!raiserFound) {
              action = `bet ${p.betText}`;
              raiserFound = true;
            } else {
              action = `call ${p.betText}`;
            }
          } else if (p.betAmount < maxBet) {
            action = `call ${p.betText}`;
          } else {
            action = `bet ${p.betText}`;
          }
        }
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

    // Store SB and BB player names for later use
    status.sbPlayer = sbPlayer;
    status.bbPlayer = bbPlayer;

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

    // Dispatch to side panel
    if (trigger === 'new game') {
      dispatchLogEvent('newgame', '--- NEW HAND ---');
      // Show SB and BB
      if (status.sbPlayer && status.bbPlayer) {
        dispatchLogEvent('status', `SB: ${status.sbPlayer} | BB: ${status.bbPlayer}`);
      }
      // Show active player stacks
      const activePlayers = status.players.filter(p => !p.isFold && !p.isOffline && p.stack);
      const stacksStr = activePlayers.map(p => `${p.name}: ${p.stack}`).join(' | ');
      dispatchLogEvent('status', stacksStr);
      const heroName = status.youPlayer || 'Unknown';
      dispatchLogEvent('status', `Hero (${heroName}): ${myCards.length > 0 ? myCards.join(' ') : 'hidden'}`);
    }
    dispatchLogEvent('pot', `Pot: ${status.pot}`);

    return status;
  }

  // Detect and log hand winners
  function checkForWinners() {
    if (winnerLogged) return;

    const winners = document.querySelectorAll('.table-player.winner');
    if (winners.length === 0) return;

    // Before logging winner, check for any missed folds
    const status = getTableStatus();
    for (const player of status.players) {
      if (player.isFold && !playersActedThisRound.has(player.name)) {
        // This player folded but wasn't logged
        if (player.isYou) {
          dispatchLogEvent('myaction', `${player.name}: FOLD`);
        } else {
          dispatchLogEvent('action', `${player.name}: FOLD`);
        }
        playersActedThisRound.add(player.name);
      }
    }

    // Get community cards that are part of winning hand (have 'up' class)
    const communityCards = [];
    document.querySelectorAll('.table-cards .card-container.up').forEach(cardEl => {
      const card = parseCard(cardEl);
      if (card) communityCards.push(card);
    });

    winners.forEach(winnerEl => {
      const nameEl = winnerEl.querySelector('.table-player-name a');
      const prizeEl = winnerEl.querySelector('.table-player-stack-prize .bb-value');
      const handEl = winnerEl.querySelector('.player-hand-message .name span');

      if (nameEl && prizeEl) {
        const name = nameEl.textContent.trim();
        const prize = prizeEl.textContent.trim().replace(/BB$/i, '').trim();
        const hand = handEl ? handEl.textContent.trim() : '';

        // Get winner's hole cards that are part of winning hand (have 'up' class)
        const holeCards = [];
        winnerEl.querySelectorAll('.table-player-cards .card-container.up').forEach(cardEl => {
          const card = parseCard(cardEl);
          if (card) holeCards.push(card);
        });

        // Combine hole cards and community cards for the winning 5
        const winningCards = [...holeCards, ...communityCards];
        const cardsStr = winningCards.length > 0 ? ` [${winningCards.join(' ')}]` : '';
        const handStr = hand ? ` with ${hand}` : '';

        dispatchLogEvent('winner', `${name} wins ${prize}BB${handStr}${cardsStr}`);
      }
    });

    winnerLogged = true;
  }

  // Detect and highlight the player who made the last action
  function highlightLastAction(status) {
    // Remove previous highlight
    const previousHighlight = document.querySelector('.table-player.last-action-highlight');
    if (previousHighlight) {
      previousHighlight.classList.remove('last-action-highlight');
    }

    // Find ALL players who just acted by comparing with previous state
    const actedPlayers = [];

    for (const player of status.players) {
      const prevState = previousPlayerStates.get(player.name);

      // Skip the player whose turn it is (they haven't acted yet)
      if (player.hasDecision) continue;

      if (!prevState) {
        // New player - check if they have an action
        if (player.action && player.action !== 'SB' && player.action !== 'BB') {
          actedPlayers.push(player);
        }
      } else {
        // Check if state changed
        const betChanged = prevState.betAmount !== player.betAmount;
        const foldChanged = prevState.isFold !== player.isFold;
        const isNewCheck = player.rawAction === 'check' && prevState.rawAction !== 'check';
        const turnJustEnded = prevState.hasDecision && !player.hasDecision;

        // Detect action if bet/fold changed, or if player just checked
        if (betChanged || foldChanged || isNewCheck) {
          // Fold takes priority - player just folded
          if (foldChanged && player.isFold) {
            actedPlayers.push({ ...player, action: 'fold' });
          } else if (player.action && player.action !== prevState.action) {
            // Skip SB/BB - these are blinds, not actions
            if (player.action !== 'SB' && player.action !== 'BB') {
              actedPlayers.push(player);
            }
          } else if (isNewCheck) {
            // Check action - rawAction changed but action might not have
            actedPlayers.push({ ...player, action: 'check' });
          }
        } else if (turnJustEnded && !player.isFold && player.betAmount === prevState.betAmount) {
          // Player's turn ended, they didn't fold or bet -> they checked
          // This catches cases where rawAction 'check' is missed
          actedPlayers.push({ ...player, action: 'check' });
        }
      }
    }

    // Update previous states for next comparison
    previousPlayerStates.clear();
    for (const player of status.players) {
      previousPlayerStates.set(player.name, {
        action: player.action,
        rawAction: player.rawAction,
        betAmount: player.betAmount,
        isFold: player.isFold,
        hasDecision: player.hasDecision
      });
    }

    // Apply highlight to the last player who acted
    const lastActedPlayer = actedPlayers[actedPlayers.length - 1];
    if (lastActedPlayer && lastActedPlayer.seat) {
      const playerEl = document.querySelector(`.table-player-${lastActedPlayer.seat}`);
      if (playerEl) {
        playerEl.classList.add('last-action-highlight');
      }
    }

    return actedPlayers;
  }

  // Log only the player action (minimal logging)
  function logPlayerAction(player, status) {
    // Skip if it's your own action (handled separately via myaction)
    // Skip SB/BB as they're not real actions
    if (!player || player.isYou || player.action === 'SB' || player.action === 'BB') {
      return;
    }

    // Check for any missed folds from players earlier in the action order
    const playerIndex = actionOrder.indexOf(player.name);
    if (playerIndex > 0) {
      for (let i = 0; i < playerIndex; i++) {
        const earlierPlayerName = actionOrder[i];
        if (!playersActedThisRound.has(earlierPlayerName)) {
          // Check if this player is now folded
          const earlierPlayer = status.players.find(p => p.name === earlierPlayerName);
          if (earlierPlayer && earlierPlayer.isFold && !earlierPlayer.isYou) {
            dispatchLogEvent('action', `${earlierPlayerName}: FOLD`);
            playersActedThisRound.add(earlierPlayerName);
          }
        }
      }
    }

    // Log this player's action
    const actionUpper = player.action.toUpperCase();
    dispatchLogEvent('action', `${player.name}: ${actionUpper}`);
    playersActedThisRound.add(player.name);

    // Track if any bets were made on this street
    if (actionUpper.includes('BET') || actionUpper.includes('RAISE') || actionUpper.includes('CALL')) {
      streetHadBets = true;
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
      const status = getTableStatus();

      // Capture hero's previous state BEFORE any processing updates previousPlayerStates
      const youPlayer = status.players.find(p => p.isYou);
      const heroPrevState = youPlayer ? previousPlayerStates.get(youPlayer.name) : null;
      // Capture if bets already happened before this mutation (to distinguish raise vs call)
      const streetHadBetsAtStart = streetHadBets;

      // Detect new game: board cards reset to 0 OR dealer position changed
      const currentTableCardCount = document.querySelectorAll('.table-cards .card-container').length;
      const currentDealerPos = status.dealerPosition;
      const dealerChanged = lastDealerPosition !== null && currentDealerPos !== lastDealerPosition;
      const cardsReset = lastTableCardCount > 0 && currentTableCardCount === 0;
      const isNewGame = cardsReset || (dealerChanged && currentTableCardCount === 0);
      const isNewStreet = currentTableCardCount > lastTableCardCount && currentTableCardCount > 0;

      if (isNewGame) {
        // Before clearing state, check for any missed folds from the previous hand
        for (const player of status.players) {
          const prevState = previousPlayerStates.get(player.name);
          if (prevState && player.isFold && !prevState.isFold && !player.isYou) {
            if (!playersActedThisRound.has(player.name)) {
              dispatchLogEvent('action', `${player.name}: FOLD`);
            }
          }
        }

        gameStartLogged = false;
        winnerLogged = false; // Reset winner tracking for new hand
        previousPlayerStates.clear(); // Reset player states for new game
        bbPlayerName = null; // Reset BB player tracking
        actionOrder = []; // Reset action order
        playersActedThisRound.clear(); // Reset acted players
        streetHadBets = false; // Reset bet tracking
      }

      // Log board cards when new street is dealt
      if (isNewStreet) {
        // Before logging the street, check for any missed actions
        // This happens when the last player's action and street deal are batched together
        // and bets get collected before we can detect the action

        // First, check for any missed folds (players who folded but weren't logged)
        for (const player of status.players) {
          const prevState = previousPlayerStates.get(player.name);
          if (prevState && player.isFold && !prevState.isFold && !player.isYou) {
            // Player folded but we didn't log it
            if (!playersActedThisRound.has(player.name)) {
              dispatchLogEvent('action', `${player.name}: FOLD`);
              playersActedThisRound.add(player.name);
            }
          }
        }

        // Find max bet from previous state (before collection)
        let maxPrevBet = 0;
        for (const [name, state] of previousPlayerStates) {
          if (state.betAmount > maxPrevBet) {
            maxPrevBet = state.betAmount;
          }
        }

        // Check for players whose calls might have been missed
        for (const player of status.players) {
          const prevState = previousPlayerStates.get(player.name);
          if (prevState && !player.isFold && !player.isYou) {
            const prevBet = prevState.betAmount;
            const prevAction = prevState.action;

            // Handle BB check (preflop only)
            if (prevAction === 'BB' && lastTableCardCount === 0) {
              // BB checked if max bet was 1BB (no raise)
              if (maxPrevBet === 1) {
                dispatchLogEvent('action', `${player.name}: CHECK`);
              }
              // BB called if there was a raise and they're still in
              else if (prevBet < maxPrevBet) {
                dispatchLogEvent('action', `${player.name}: CALL ${maxPrevBet}BB`);
              }
              continue;
            }

            // Skip SB
            if (prevAction === 'SB') continue;

            // Skip players who were already at the max bet (they were the raiser)
            if (prevBet === maxPrevBet) continue;

            // If they had a bet less than max, they must have called
            if (prevBet > 0 && prevBet < maxPrevBet) {
              dispatchLogEvent('action', `${player.name}: CALL ${maxPrevBet}BB`);
            }
          }
        }

        // Check for missed CHECKs on postflop streets (when no one bet)
        if (lastTableCardCount > 0 && !streetHadBets) {
          // Postflop street where everyone checked
          for (const playerName of actionOrder) {
            if (!playersActedThisRound.has(playerName)) {
              const player = status.players.find(p => p.name === playerName);
              if (player && !player.isFold) {
                if (player.isYou) {
                  dispatchLogEvent('myaction', `${playerName}: CHECK`);
                } else {
                  dispatchLogEvent('action', `${playerName}: CHECK`);
                }
                playersActedThisRound.add(playerName);
              }
            }
          }
        }

        const tableCards = getTableCards();
        const pot = getPotSize();
        let street = '';
        if (currentTableCardCount === 3) street = 'FLOP';
        else if (currentTableCardCount === 4) street = 'TURN';
        else if (currentTableCardCount === 5) street = 'RIVER';
        dispatchLogEvent('street', `${street}: ${tableCards.join(' ')} (Pot: ${pot})`);

        // Reset action tracking for new street (postflop order)
        actionOrder = calculateActionOrder(status, false);
        playersActedThisRound.clear();
        streetHadBets = false; // Reset bet tracking for new street
      }

      // Check for winners after street logging
      checkForWinners();

      lastTableCardCount = currentTableCardCount;
      lastDealerPosition = currentDealerPos;

      // Log full status only at game start, otherwise just log actions
      if (!gameStartLogged && currentTableCardCount === 0) {
        logTableStatus('new game');
        gameStartLogged = true;
        // Store BB player for later (to detect BB check before flop)
        bbPlayerName = status.bbPlayer;
        // Calculate preflop action order
        actionOrder = calculateActionOrder(status, true);
        playersActedThisRound.clear();
        // Initialize player states without highlighting
        for (const player of status.players) {
          previousPlayerStates.set(player.name, {
            action: player.action,
            rawAction: player.rawAction,
            betAmount: player.betAmount,
            isFold: player.isFold,
            hasDecision: player.hasDecision
          });
        }
      } else {
        // Highlight and log all actions
        const actedPlayers = highlightLastAction(status);
        for (const player of actedPlayers) {
          logPlayerAction(player, status);
        }
      }
      
      // Only trigger when turn STARTS (transitions from not-my-turn to my-turn)
      if (isMyTurn && !wasMyTurn) {
        dispatchLogEvent('turn', 'YOUR TURN');
        isMyTurnPending = true;

        // FALLBACK: Directly play custom sound after a short delay
        // Only works if audio was unlocked via user interaction
        setTimeout(() => {
          if (isMyTurnPending && customSoundEnabled && customSoundDataUrl && audioUnlocked) {
            console.log('[SoundReplacer] ⏰ Fallback: Playing custom sound directly');
            playCustomSound();
            isMyTurnPending = false;
          }
        }, SOUND_CHECK_DELAY_MS);

        // Reset flag after window expires
        setTimeout(() => {
          isMyTurnPending = false;
        }, TURN_SOUND_WINDOW_MS);
      } else if (!isMyTurn && wasMyTurn) {
        // Your turn just ended - use heroPrevState captured at start (before highlightLastAction updated it)
        if (youPlayer) {
          let action = '';
          // Check if hero folded
          if (youPlayer.isFold) {
            action = 'FOLD';
          }
          // If user is BB with 1BB bet and action is still "BB", they checked
          else if (youPlayer.action === 'BB' && youPlayer.betAmount === 1 && status.isPreflop) {
            action = 'CHECK';
          }
          // If hero has a bet, determine if it's a call or raise based on context
          if (!action && youPlayer.betAmount > 0) {
            // Check if this is higher than just posting blind
            const isSB = youPlayer.name === status.sbPlayer && youPlayer.betAmount === 0.5;
            const isBB = youPlayer.name === status.bbPlayer && youPlayer.betAmount === 1;
            if (!isSB && !isBB) {
              // Find the max bet on the street to determine correct call amount
              const maxBetOnStreet = Math.max(...status.players.map(p => p.betAmount));
              const callAmount = maxBetOnStreet > youPlayer.betAmount ? maxBetOnStreet : youPlayer.betAmount;

              // If someone already bet/raised this street, hero's bet is a call
              if (streetHadBetsAtStart) {
                action = `CALL ${callAmount}BB`;
              } else if (youPlayer.action && youPlayer.action.startsWith('raise')) {
                action = youPlayer.action.toUpperCase();
              } else {
                action = `CALL ${callAmount}BB`;
              }
            }
          }
          // Detect check from rawAction (only if no bet action)
          if (!action && youPlayer.rawAction === 'check') {
            action = 'CHECK';
          }
          // If still no action and street just changed, use heroPrevState (captured before updates)
          if (!action && isNewStreet && heroPrevState) {
            if (heroPrevState.betAmount > 0 && heroPrevState.action !== 'SB' && heroPrevState.action !== 'BB') {
              // Hero had a bet before collection - determine if it was a raise or call
              // If streetHadBetsAtStart is true, someone else already bet/raised, so hero called
              if (streetHadBetsAtStart) {
                action = `CALL ${heroPrevState.betAmount}BB`;
              } else if (heroPrevState.action && heroPrevState.action.startsWith('raise')) {
                action = heroPrevState.action.toUpperCase();
              } else {
                action = `CALL ${heroPrevState.betAmount}BB`;
              }
            }
          }
          if (action) {
            dispatchLogEvent('myaction', `${youPlayer.name}: ${action}`);
            playersActedThisRound.add(youPlayer.name);
            // Track if hero made a bet action
            if (action.includes('BET') || action.includes('RAISE') || action.includes('CALL')) {
              streetHadBets = true;
            }
          }
        }
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
    const initialStatus = getTableStatus();
    lastTableCardCount = document.querySelectorAll('.table-cards .card-container').length;
    lastDealerPosition = initialStatus.dealerPosition;

    // Log initial status as game start
    logTableStatus('initial');
    gameStartLogged = true;

    // Initialize previous states (don't highlight on initial load)
    for (const player of initialStatus.players) {
      previousPlayerStates.set(player.name, {
        action: player.action,
        rawAction: player.rawAction,
        betAmount: player.betAmount,
        isFold: player.isFold,
        hasDecision: player.hasDecision
      });
    }
  }

  // ============================================
  // INTERCEPT AND SELECTIVELY REPLACE SOUNDS
  // ============================================

  // Real-time check if it's my turn (for sound interception)
  function isCurrentlyMyTurn() {
    const myTurnElement = document.querySelector('.table-player.decision-current.you-player');
    return !!myTurnElement;
  }

  // Determine if we should replace the sound
  function shouldReplaceSound() {
    // Only replace when turn just started (pending flag), NOT for every action during my turn
    return customSoundEnabled && customSoundDataUrl && isMyTurnPending;
  }

  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OriginalAudioContext) {
    const origCreateBufferSource = OriginalAudioContext.prototype.createBufferSource;
    OriginalAudioContext.prototype.createBufferSource = function() {
      const audioCtx = this; // Capture the AudioContext
      // Store for later use (fallback mechanism)
      if (!unlockedAudioContext && audioCtx.state === 'running') {
        unlockedAudioContext = audioCtx;
        console.log('[SoundReplacer] 🔓 Stored unlocked AudioContext');
      }

      const source = origCreateBufferSource.call(this);
      const origStart = source.start.bind(source);

      source.start = function(...args) {
        const isMyTurn = isCurrentlyMyTurn();
        console.log('[SoundReplacer] AudioContext.start() called | isMyTurnPending:', isMyTurnPending, '| isCurrentlyMyTurn:', isMyTurn);

        // Only replace if it's my turn and replacement is enabled
        if (shouldReplaceSound()) {
          console.log('[SoundReplacer] ✅ Replacing YOUR TURN sound');
          playCustomSound(audioCtx); // Pass the AudioContext
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
    const isMyTurn = isCurrentlyMyTurn();
    console.log('[SoundReplacer] audio.play() called | isMyTurnPending:', isMyTurnPending, '| isCurrentlyMyTurn:', isMyTurn, '| src:', src);

    if (shouldReplaceSound()) {
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
