// PokerNow Extension - Injected into page context
(function() {
  'use strict';

  console.log('[SoundReplacer] inject.js loading...');

  // ============================================
  // WEBSOCKET MESSAGE PARSING (called by ws-override.js)
  // ============================================

  // Parse Socket.IO message format - exposed globally for ws-override.js
  window.__pokerNowParseSocketMessage = function(data) {
    if (typeof data !== 'string') return;

    // Socket.IO uses prefix codes: 0=open, 2=ping, 3=pong, 4=message
    // Message format: 42["eventName", data] where 4=message, 2=event
    if (data.startsWith('42')) {
      try {
        const jsonStr = data.substring(2);
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed.length >= 1) {
          handleGameEvent(parsed[0], parsed[1]);
        }
      } catch (e) {
        // Not valid JSON, ignore
      }
    }
  }

  // Track socket-based game state
  let socketPlayers = {}; // playerId -> {name, stack}
  let socketSeats = {};   // playerId -> seat number (for ordering)
  let socketPrevPGS = {}; // Previous player game status
  let socketPrevTB = {};  // Previous table bets
  let socketHandNum = 0;  // Current hand number
  let socketPrevCards = 0; // Previous community card count
  let socketPrevCHB = 0;  // Previous current highest bet (to detect first bet vs call)
  let socketPrevRabbit = ''; // Previous rabbit cards (to avoid duplicate logs)
  let socketMyId = null;  // Current player's ID
  let socketHandLog = []; // Hand log collected from socket events (for AI)
  let socketSmallBlind = 0.5; // Small blind value
  let socketBigBlind = 1; // Big blind value for BB conversion
  let displayMode = 'bb'; // 'bb' or 'chips'
  let socketTurnStartTime = 0; // Timestamp when current player's turn started
  let socketCurrentTurnPlayer = null; // Player ID whose turn it is
  let socketCurrentTurnActionLogged = false; // Track if current turn player's action was logged
  let socketMyPosition = null; // My position from socket (UTG, MP, CO, BTN, SB, BB)

  // Format bet value based on displayMode setting
  function formatBet(chips) {
    if (displayMode === 'chips') {
      return chips;
    }
    // Convert to BB
    const bb = chips / socketBigBlind;
    // Show as integer if whole number, otherwise 1 decimal place
    return bb % 1 === 0 ? `${bb}BB` : `${bb.toFixed(1)}BB`;
  }

  // Calculate position name (BTN, SB, BB, UTG, MP, CO, HJ, etc.) for a player
  // Uses ALL seated players (not just active) to correctly determine positions
  function getPositionName(playerId, dealerId, sbId, _bbId, inHandPlayerIds) {
    if (!playerId) return '?';

    // Get ALL players at the table sorted by seat (not just in-hand players)
    // This ensures we correctly find dealer even if they folded
    const allSeatedPlayers = Object.keys(socketSeats)
      .filter(id => socketSeats[id] !== undefined)
      .sort((a, b) => (socketSeats[a] || 99) - (socketSeats[b] || 99));

    if (allSeatedPlayers.length === 0) return '?';

    // Find the dealer - use dealerId if provided, otherwise derive from SB
    let dealerSeat = null;
    if (dealerId && socketSeats[dealerId] !== undefined) {
      dealerSeat = socketSeats[dealerId];
    } else if (sbId && socketSeats[sbId] !== undefined) {
      // Dealer is the seat before SB (looking at ALL players, not just active)
      const sbSeat = socketSeats[sbId];
      const sbIdx = allSeatedPlayers.findIndex(id => socketSeats[id] === sbSeat);
      if (sbIdx !== -1) {
        const dealerIdx = sbIdx === 0 ? allSeatedPlayers.length - 1 : sbIdx - 1;
        dealerSeat = socketSeats[allSeatedPlayers[dealerIdx]];
      }
    }

    if (dealerSeat === null) return '?';

    // Now use only in-hand players for position assignment, but ordered from dealer
    const activePlayers = inHandPlayerIds
      .filter(id => socketSeats[id] !== undefined)
      .sort((a, b) => (socketSeats[a] || 99) - (socketSeats[b] || 99));

    if (activePlayers.length === 0) return '?';

    // Reorder active players starting from the first one AFTER dealer seat
    // Find first active player whose seat is > dealerSeat (or wrap around)
    let startIdx = activePlayers.findIndex(id => socketSeats[id] > dealerSeat);
    if (startIdx === -1) startIdx = 0; // All seats <= dealer, so first player is after dealer (wrapped)

    const orderedPlayers = [
      ...activePlayers.slice(startIdx),
      ...activePlayers.slice(0, startIdx)
    ];

    const numPlayers = orderedPlayers.length;
    const playerIdx = orderedPlayers.indexOf(playerId);
    if (playerIdx === -1) return '?';

    // Heads-up special case: first player is BTN (also SB), second is BB
    if (numPlayers === 2) {
      return playerIdx === 0 ? 'BTN' : 'BB';
    }

    // 3+ players: SB is first after dealer, BB is second, etc.
    // Position 0 = SB, 1 = BB, last = BTN, others are UTG onwards
    if (playerIdx === numPlayers - 1) return 'BTN';
    if (playerIdx === 0) return 'SB';
    if (playerIdx === 1) return 'BB';

    // Remaining positions between BB and BTN (UTG through CO)
    const posAfterBB = playerIdx - 2; // 0-indexed position after BB
    const numMiddle = numPlayers - 3; // Number of players between BB and BTN

    if (numMiddle <= 0) return '?';

    // Position names from earliest to latest (UTG -> CO)
    if (numMiddle === 1) {
      // 4 players: SB, BB, UTG, BTN
      return 'UTG';
    } else if (numMiddle === 2) {
      // 5 players: SB, BB, UTG, CO, BTN
      return posAfterBB === 0 ? 'UTG' : 'CO';
    } else if (numMiddle === 3) {
      // 6 players: SB, BB, UTG, MP, CO, BTN
      const names = ['UTG', 'MP', 'CO'];
      return names[posAfterBB] || '?';
    } else if (numMiddle === 4) {
      // 7 players: SB, BB, UTG, MP, HJ, CO, BTN
      const names = ['UTG', 'MP', 'HJ', 'CO'];
      return names[posAfterBB] || '?';
    } else if (numMiddle === 5) {
      // 8 players: SB, BB, UTG, UTG+1, MP, HJ, CO, BTN
      const names = ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'];
      return names[posAfterBB] || '?';
    } else {
      // 9+ players: SB, BB, UTG, UTG+1, MP, LJ, HJ, CO, BTN
      const names = ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'];
      return names[posAfterBB] || 'EP';
    }
  }

  // Get thinking time for a player and reset if it was their turn
  function getThinkingTime(playerId) {
    if (socketCurrentTurnPlayer !== playerId || socketTurnStartTime === 0) {
      return '';
    }
    const elapsed = Date.now() - socketTurnStartTime;
    const seconds = Math.round(elapsed / 1000);
    // Reset turn tracking
    socketTurnStartTime = 0;
    socketCurrentTurnPlayer = null;
    // Only show if > 0 seconds
    return seconds > 0 ? ` (${seconds}s)` : '';
  }

  // Format card codes to emoji suits (for AI text output)
  // Converts "Ah Kc" to "A♥ K♣", only in card contexts
  function formatCardsText(text) {
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
    return formatted;
  }

  // Dispatch socket log event to side panel
  // Set addToAILog=false to skip adding to AI hand log (e.g., for other players' turns)
  function dispatchSocketLog(logType, message, addToAILog = true) {
    window.dispatchEvent(new CustomEvent('POKERNOW_GAME_LOG', {
      detail: { logType, message }
    }));
    // Collect in socketHandLog for AI (with card formatting)
    if (addToAILog) {
      const formattedMsg = formatCardsText(message);
      if (logType === 'newgame') {
        socketHandLog = [formattedMsg];
      } else if (logType === 'myturn') {
        // Remove previous turn entries - only keep the latest/current turn
        socketHandLog = socketHandLog.filter(entry => !entry.endsWith("'s turn"));
        socketHandLog.push(formattedMsg);
      } else {
        socketHandLog.push(formattedMsg);
      }
    }
  }

  // Handle parsed game events from socket
  function handleGameEvent(eventName, data) {
    if (eventName === 'registered') {
      // Initial game state - extract full game info
      const gs = data.gameState;
      if (!gs) return;

      // Track current player ID and blinds
      socketMyId = data.currentPlayer?.id;
      socketSmallBlind = gs.smallBlind || 0.5;
      socketBigBlind = gs.bigBlind || 1;

      // Extract player info with stacks
      if (gs.players) {
        socketPlayers = {};
        for (const [id, p] of Object.entries(gs.players)) {
          socketPlayers[id] = { name: p.name, stack: p.stack };
        }
      }

      // Extract seat positions for ordering
      if (gs.seats) {
        socketSeats = {};
        for (const [seatNum, playerId] of gs.seats) {
          socketSeats[playerId] = seatNum;
        }
      }

      // Log game info with players sorted by seat
      if (gs.players) {
        const inGameIds = Object.entries(gs.players)
          .filter(([, p]) => p.status === 'inGame')
          .map(([id]) => id)
          .sort((a, b) => (socketSeats[a] || 99) - (socketSeats[b] || 99));
        const playerList = inGameIds.map(id => `${socketPlayers[id].name} (${formatBet(socketPlayers[id].stack)})`);

        console.log('[Socket] === GAME INFO ===');
        console.log(`[Socket] Blinds: ${gs.smallBlind}/${gs.bigBlind}`);
        console.log(`[Socket] Players: ${playerList.join(', ')}`);

        // Dispatch to side panel
        dispatchSocketLog('status', `=== GAME INFO ===`);
        dispatchSocketLog('info', `Blinds: ${gs.smallBlind}/${gs.bigBlind}`);
        dispatchSocketLog('info', `Players: ${playerList.join(', ')}`);
      }

      // Log current player's hole cards
      if (socketMyId && gs.pC?.[socketMyId]?.cards) {
        const myCards = gs.pC[socketMyId].cards
          .map(c => c.value)
          .filter(v => v)
          .join(' ');
        if (myCards) {
          console.log(`[Socket] Your cards: ${myCards}`);
          dispatchSocketLog('cards', `Your cards: ${myCards}`);
        }
      }

      // Log current hand state if in progress
      if (gs.gN) {
        socketHandNum = gs.gN;
        const dealer = gs.dealerID ? (socketPlayers[gs.dealerID]?.name || '?') : '?';
        const sb = gs.sBPI ? (socketPlayers[gs.sBPI]?.name || '?') : '?';
        const bb = gs.bBPI ? (socketPlayers[gs.bBPI]?.name || '?') : '?';
        console.log(`[Socket] Hand #${gs.gN} - Dealer: ${dealer}, SB: ${sb}, BB: ${bb}`);

        // Get in-hand player IDs for position calculation
        const inHandPlayerIds = gs.iHPI || [];

        // Dispatch hand info to side panel
        dispatchSocketLog('newgame', `Hand #${gs.gN} - Dealer: ${dealer}, SB: ${sb}, BB: ${bb}`);
        dispatchSocketLog('info', `Blinds: ${formatBet(gs.smallBlind)}/${formatBet(gs.bigBlind)}`);

        // Log player stacks sorted by seat
        const inHandPlayers = inHandPlayerIds.slice().sort((a, b) => (socketSeats[a] || 99) - (socketSeats[b] || 99));
        const stackList = inHandPlayers
          .map(id => socketPlayers[id])
          .filter(p => p)
          .map(p => `${p.name} (${formatBet(p.stack)})`);
        if (stackList.length > 0) {
          dispatchSocketLog('info', `Stacks: ${stackList.join(', ')}`);
        }

        // Calculate and log my position
        if (socketMyId) {
          const myPosition = getPositionName(socketMyId, gs.dealerID, gs.sBPI, gs.bBPI, inHandPlayerIds);
          socketMyPosition = myPosition; // Store for autoplay
          const myName = socketPlayers[socketMyId]?.name || '?';
          console.log(`[Socket] You: ${myName} (${myPosition})`);
          dispatchSocketLog('info', `You: ${myName} (${myPosition})`);
        }

        // Log who has folded
        if (gs.pGS) {
          const foldedPlayers = Object.entries(gs.pGS)
            .filter(([, status]) => status === 'fold')
            .map(([id]) => socketPlayers[id]?.name || id);
          if (foldedPlayers.length > 0) {
            for (const name of foldedPlayers) {
              dispatchSocketLog('action', `${name}: FOLD`);
            }
          }
        }

        // Log community cards if any
        if (gs.oTC?.['1']?.length > 0) {
          const cards = gs.oTC['1'];
          const streetName = cards.length === 3 ? 'FLOP' : cards.length === 4 ? 'TURN' : cards.length === 5 ? 'RIVER' : 'BOARD';
          const potStr = gs.pot > 0 ? ` (Pot: ${formatBet(gs.pot)})` : '';
          console.log(`[Socket] ${streetName}: ${cards.join(' ')}${potStr}`);
          dispatchSocketLog('street', `${streetName}: ${cards.join(' ')}${potStr}`);
          socketPrevCards = cards.length;
        }

        // Log current bets on the table
        if (gs.tB) {
          const bets = Object.entries(gs.tB)
            .filter(([, bet]) => typeof bet === 'number' && bet > 0)
            .map(([id, bet]) => `${socketPlayers[id]?.name || id}: ${formatBet(bet)}`)
            .join(', ');
          if (bets) {
            console.log(`[Socket] Current bets: ${bets}`);
            dispatchSocketLog('info', `Current bets: ${bets}`);
          }
        }

        // Log pot if any (and no community cards logged it already)
        if (gs.pot > 0 && (!gs.oTC?.['1'] || gs.oTC['1'].length === 0)) {
          console.log(`[Socket] Pot: ${formatBet(gs.pot)}`);
          dispatchSocketLog('info', `Pot: ${formatBet(gs.pot)}`);
        }

        // Log whose turn it is
        if (gs.pITT) {
          const turnName = socketPlayers[gs.pITT]?.name || gs.pITT;
          const isMyTurn = gs.pITT === socketMyId;
          console.log(`[Socket] TURN: ${turnName}'s turn`);
          dispatchSocketLog(isMyTurn ? 'myturn' : 'turn', `${turnName}'s turn`, isMyTurn);
          socketCurrentTurnPlayer = gs.pITT;
          socketTurnStartTime = Date.now();
        }
      }

      if (gs.pGS) {
        socketPrevPGS = { ...gs.pGS };
      }
      if (gs.tB) {
        socketPrevTB = { ...gs.tB };
      }
      if (gs.cHB) {
        socketPrevCHB = gs.cHB;
      }
      return;
    }

    // Handle direct action events
    if (eventName === 'action') {
      const actionType = data?.type;
      if (actionType === 'RUC') {
        console.log(`[Socket] 🐰 Rabbit hunting requested`);
      } else if (actionType === 'PLAYER_FOLD') {
        // Fold action - already handled via gC pGS changes
      } else if (actionType) {
        console.log(`[Socket] ACTION EVENT: ${actionType}`);
      }
      return;
    }

    if (eventName !== 'gC') return; // Only process game changes

    // Update player info if provided
    if (data.players) {
      for (const [id, p] of Object.entries(data.players)) {
        if (p.name) {
          socketPlayers[id] = { name: p.name, stack: p.stack ?? socketPlayers[id]?.stack };
        } else if (socketPlayers[id] && p.stack !== undefined) {
          socketPlayers[id].stack = p.stack;
        }
      }
    }

    // Update seat positions if provided
    if (data.seats) {
      for (const [seatNum, playerId] of data.seats) {
        socketSeats[playerId] = seatNum;
      }
    }

    const getName = (id) => socketPlayers[id]?.name || id;

    // Detect new hand
    if (data.gN && data.gN !== socketHandNum) {
      socketHandNum = data.gN;
      const dealer = data.dealerID ? getName(data.dealerID) : '?';
      const sb = data.sBPI ? getName(data.sBPI) : '?';
      const bb = data.bBPI ? getName(data.bBPI) : '?';

      // Log player stacks at hand start (only players in this hand via iHPI), sorted by seat
      const inHandPlayers = (data.iHPI || []).slice().sort((a, b) => (socketSeats[a] || 99) - (socketSeats[b] || 99));
      const playerList = inHandPlayers
        .map(id => socketPlayers[id])
        .filter(p => p)
        .map(p => `${p.name} (${formatBet(p.stack)})`);
      console.log(`[Socket] ===== HAND #${data.gN} =====`);
      console.log(`[Socket] Dealer: ${dealer}, SB: ${sb}, BB: ${bb}`);
      console.log(`[Socket] Stacks: ${playerList.join(', ')}`);

      // Calculate my position and name
      const myPosition = socketMyId ? getPositionName(socketMyId, data.dealerID, data.sBPI, data.bBPI, data.iHPI || []) : '?';
      socketMyPosition = myPosition; // Store for autoplay
      const myName = socketMyId ? (socketPlayers[socketMyId]?.name || '?') : '?';
      console.log(`[Socket] You: ${myName} (${myPosition})`);

      // Dispatch to side panel
      dispatchSocketLog('newgame', `Hand #${data.gN} - Dealer: ${dealer}, SB: ${sb}, BB: ${bb}`);
      dispatchSocketLog('info', `Blinds: ${formatBet(socketSmallBlind)}/${formatBet(socketBigBlind)}`);
      dispatchSocketLog('info', `Stacks: ${playerList.join(', ')}`);
      dispatchSocketLog('info', `You: ${myName} (${myPosition})`);

      // Log hole cards if provided
      if (data.pC) {
        for (const [id, cardInfo] of Object.entries(data.pC)) {
          if (cardInfo.cards) {
            const cards = cardInfo.cards.map(c => c.value).filter(v => v).join(' ');
            if (cards) {
              console.log(`[Socket] Your cards: ${cards}`);
              dispatchSocketLog('cards', `Your cards: ${cards}`);
              break; // Only log our own cards
            }
          }
        }
      }

      socketPrevPGS = {};
      socketPrevTB = {};
      socketPrevCards = 0;
      socketPrevCHB = 0; // Reset for new hand
      socketCurrentTurnPlayer = null; // Reset turn tracking for new hand
      socketCurrentTurnActionLogged = false;
    }

    // Detect community cards (street changes)
    if (data.oTC?.['1']) {
      const cards = data.oTC['1'];
      if (cards.length > socketPrevCards) {
        // Before logging street, check if previous turn player's action was missed
        // This handles cases like BB check preflop where the bet doesn't change
        if (socketCurrentTurnPlayer && !socketCurrentTurnActionLogged) {
          const prevTurnName = getName(socketCurrentTurnPlayer);
          const isMe = socketCurrentTurnPlayer === socketMyId;
          const thinkTime = getThinkingTime(socketCurrentTurnPlayer);
          console.log(`[Socket] ACTION: ${prevTurnName} CHECK${thinkTime} (inferred from street change)`);
          dispatchSocketLog(isMe ? 'myaction' : 'action', `${prevTurnName}: CHECK${thinkTime}`);
        }
        // Reset turn tracking for new street
        socketCurrentTurnPlayer = null;
        socketCurrentTurnActionLogged = false;

        const streetName = cards.length === 3 ? 'FLOP' : cards.length === 4 ? 'TURN' : cards.length === 5 ? 'RIVER' : 'CARDS';
        const potStr = data.pot ? ` (Pot: ${formatBet(data.pot)})` : '';
        console.log(`[Socket] ${streetName}: ${cards.join(' ')}${potStr}`);
        dispatchSocketLog('street', `${streetName}: ${cards.join(' ')}${potStr}`);
        socketPrevCards = cards.length;
        socketPrevCHB = 0; // Reset for new street - no bets yet
      }
    }

    // Detect player actions from pGS changes (fold) - process first to know all-in status
    if (data.pGS) {
      for (const [id, status] of Object.entries(data.pGS)) {
        const prevStatus = socketPrevPGS[id];
        if (status === 'fold' && prevStatus !== 'fold') {
          const name = getName(id);
          const isMe = id === socketMyId;
          const thinkTime = getThinkingTime(id);
          console.log(`[Socket] ACTION: ${name} FOLD${thinkTime}`);
          dispatchSocketLog(isMe ? 'myaction' : 'action', `${name}: FOLD${thinkTime}`);
          // Mark that current turn player's action was logged
          if (id === socketCurrentTurnPlayer) socketCurrentTurnActionLogged = true;
        }
        socketPrevPGS[id] = status;
      }
    }

    // Detect player actions from tB changes (bet/raise/call/check)
    if (data.tB) {
      for (const [id, bet] of Object.entries(data.tB)) {
        const prevBet = socketPrevTB[id];
        if (bet === '<D>') {
          // Bet cleared (street ended)
          delete socketPrevTB[id];
          continue;
        }
        const name = getName(id);
        const isMe = id === socketMyId;
        if (bet === 'check' && prevBet !== 'check') {
          const thinkTime = getThinkingTime(id);
          console.log(`[Socket] ACTION: ${name} CHECK${thinkTime}`);
          dispatchSocketLog(isMe ? 'myaction' : 'action', `${name}: CHECK${thinkTime}`);
          // Mark that current turn player's action was logged
          if (id === socketCurrentTurnPlayer) socketCurrentTurnActionLogged = true;
        } else if (typeof bet === 'number' && bet !== prevBet) {
          // Check if this is a blind post (only on new hand, gN present)
          const isBlindPost = data.gN && (data.sBPI === id || data.bBPI === id);
          if (isBlindPost) {
            // Skip blind posts - not player actions
            socketPrevTB[id] = bet;
            continue;
          }

          // Check if player just went all-in (pGS status is 'allIn')
          const isAllIn = data.pGS?.[id] === 'allIn' || socketPrevPGS[id] === 'allIn';
          const prevBetNum = typeof prevBet === 'number' ? prevBet : 0;
          const thinkTime = getThinkingTime(id);

          // Determine action type:
          // - ALL-IN: player's pGS status is 'allIn'
          // - RAISE: bet > previous highest bet (socketPrevCHB)
          // - BET: first bet on a postflop street (socketPrevCHB was 0)
          // - CALL: matching existing highest bet
          let actionStr;
          if (isAllIn) {
            actionStr = `ALL-IN ${formatBet(bet)}`;
          } else if (bet > socketPrevCHB && socketPrevCHB > 0) {
            actionStr = `RAISE ${formatBet(bet)}`;
          } else if (socketPrevCHB === 0 && prevBetNum === 0) {
            actionStr = `BET ${formatBet(bet)}`;
          } else {
            actionStr = `CALL ${formatBet(bet)}`;
          }
          console.log(`[Socket] ACTION: ${name} ${actionStr}${thinkTime}`);
          dispatchSocketLog(isMe ? 'myaction' : 'action', `${name}: ${actionStr}${thinkTime}`);
          // Mark that current turn player's action was logged
          if (id === socketCurrentTurnPlayer) socketCurrentTurnActionLogged = true;
        }
        socketPrevTB[id] = bet;
      }
    }

    // Update socketPrevCHB at the end of processing
    if (data.cHB !== undefined) {
      socketPrevCHB = data.cHB;
    }

    // Detect all-in showdown (cards revealed before river is dealt)
    // sNA "NSAAD" = No Showdown Action All-in Display
    if (data.sNA === 'NSAAD' && data.pC) {
      console.log(`[Socket] === ALL-IN SHOWDOWN ===`);
      dispatchSocketLog('showdown', '=== ALL-IN SHOWDOWN ===');
      for (const [id, cardInfo] of Object.entries(data.pC)) {
        if (cardInfo.cards && cardInfo.cards.some(c => c.showing)) {
          const cards = cardInfo.cards.map(c => c.value).filter(v => v).join(' ');
          const handName = cardInfo.name1 || '';
          const prob = cardInfo.prob1 ? ` ${cardInfo.prob1}%` : '';
          if (cards) {
            const showMsg = `${getName(id)} shows ${cards}${handName ? ` (${handName})` : ''}${prob}`;
            console.log(`[Socket] SHOW: ${showMsg}`);
            dispatchSocketLog('showdown', showMsg);
          }
        }
      }
    }

    // Detect showdown and winner
    if (data.gameResult && typeof data.gameResult === 'object' && data.gameResult !== '<D>') {
      // Check if this is a showdown (sNA contains 'S' at end = Showdown)
      const isShowdown = data.sNA && data.sNA.endsWith('S');

      // Log revealed cards at showdown (if not already shown via NSAAD)
      if (isShowdown && data.pC) {
        let hasNewCards = false;
        for (const [id, cardInfo] of Object.entries(data.pC)) {
          if (cardInfo.cards && cardInfo.cards.some(c => c.showing)) {
            hasNewCards = true;
            break;
          }
        }
        if (hasNewCards) {
          console.log(`[Socket] === SHOWDOWN ===`);
          dispatchSocketLog('showdown', '=== SHOWDOWN ===');
          for (const [id, cardInfo] of Object.entries(data.pC)) {
            if (cardInfo.cards && cardInfo.cards.some(c => c.showing)) {
              const cards = cardInfo.cards.map(c => c.value).filter(v => v).join(' ');
              const handName = cardInfo.name1 || '';
              if (cards) {
                const showMsg = `${getName(id)} shows ${cards}${handName ? ` (${handName})` : ''}`;
                console.log(`[Socket] SHOW: ${showMsg}`);
                dispatchSocketLog('showdown', showMsg);
              }
            }
          }
        }
      }

      // Log winner(s)
      for (const [id, result] of Object.entries(data.gameResult)) {
        if (result.gained) {
          // Check for hand cards in result (e.g., result['1'].hC for pot 1)
          let handCards = '';
          if (result['1']?.hC) {
            handCards = ` with ${result['1'].hC.join(' ')}`;
          }
          const winMsg = `${getName(id)} wins ${formatBet(result.gained)}${handCards}`;
          console.log(`[Socket] WINNER: ${winMsg}`);
          dispatchSocketLog('winner', winMsg);
        }
      }
    }

    // Detect rabbit hunting cards (rHC = Run Hunt Cards)
    if (data.rHC && typeof data.rHC === 'object' && data.rHC !== '<D>') {
      const rabbitCards = data.rHC['1'];
      if (rabbitCards && rabbitCards.length > 0) {
        const rabbitStr = rabbitCards.join(' ');
        if (rabbitStr !== socketPrevRabbit) {
          console.log(`[Socket] 🐰 RABBIT: ${rabbitStr}`);
          dispatchSocketLog('info', `🐰 RABBIT: ${rabbitStr}`);
          socketPrevRabbit = rabbitStr;
        }
      }
    } else if (data.rHC === '<D>') {
      socketPrevRabbit = ''; // Reset on clear
    }

    // Detect whose turn
    if (data.pITT && data.pITT !== null) {
      // Check if previous turn player's action was missed (they checked)
      // This can happen when turn changes without an explicit tB change
      if (socketCurrentTurnPlayer && socketCurrentTurnPlayer !== data.pITT && !socketCurrentTurnActionLogged) {
        const prevTurnName = getName(socketCurrentTurnPlayer);
        const isMe = socketCurrentTurnPlayer === socketMyId;
        const thinkTime = getThinkingTime(socketCurrentTurnPlayer);
        console.log(`[Socket] ACTION: ${prevTurnName} CHECK${thinkTime} (inferred from turn change)`);
        dispatchSocketLog(isMe ? 'myaction' : 'action', `${prevTurnName}: CHECK${thinkTime}`);
      }

      const turnName = getName(data.pITT);
      const isMyTurn = data.pITT === socketMyId;
      console.log(`[Socket] TURN: ${turnName}'s turn`);
      // Track turn start time for thinking time calculation
      socketCurrentTurnPlayer = data.pITT;
      socketTurnStartTime = Date.now();
      socketCurrentTurnActionLogged = false; // Reset for new turn
      // Only add to AI log when it's my turn (other players' turns are redundant - their action follows)
      dispatchSocketLog(isMyTurn ? 'myturn' : 'turn', `${turnName}'s turn`, isMyTurn);
    }
  }
  // ============================================

  let customSoundDataUrl = null;
  let defaultSoundUrl = null;
  let customSoundEnabled = true;
  let soundVolume = 1.0; // 0.0 to 1.0
  let aiProvider = 'gemini'; // 'gemini', 'claude', or 'chatgpt'
  let aiMode = 'auto'; // 'auto' or 'manual'
  let lastSoundTime = 0;
  let isMyTurnPending = false; // Flag: expecting "your turn" sound
  let audioUnlocked = false; // Track if audio has been unlocked via user interaction
  const DEBOUNCE_MS = 300;
  const TURN_SOUND_WINDOW_MS = 2000; // Window to catch sound after turn detected (increased)
  const SOUND_CHECK_DELAY_MS = 300; // Delay before fallback sound plays (after autoplay check at 200ms)

  // Auto-play settings
  let autoPlayEnabled = false;
  let autoPlaySettings = {};
  let autoActionTimer = null;
  let autoActionCancelled = false;
  let currentAutoAction = null;

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
  let handLog = []; // Collect log entries for the current hand (for Gemini)
  let allInPlayers = new Set(); // Track players who are all-in (can't act anymore)

  // Dispatch log event to side panel via content script
  // DISABLED: DOM-based logging disabled - socket events provide game info
  function dispatchLogEvent(logType, message) {
    // No-op: socket-based logging (dispatchSocketLog) handles side panel updates
    // Only collect in handLog for AI (if needed)
    if (logType === 'newgame') {
      handLog = [message];
    } else {
      handLog.push(message);
    }
  }

  // Send current hand log to AI for analysis (only in auto mode)
  function sendToAI() {
    if (aiMode !== 'auto') {
      console.log('[SoundReplacer] AI mode is manual - skipping automatic send');
      return;
    }
    if (socketHandLog.length === 0) return;
    const logText = socketHandLog.join('\n');
    window.dispatchEvent(new CustomEvent('POKERNOW_SEND_TO_AI', {
      detail: { provider: aiProvider, handLog: logText }
    }));
    console.log(`[SoundReplacer] 🤖 Sent hand log to ${aiProvider}`);
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

      /* Action type text colors */
      .table-player.last-action-check .table-player-bet-value,
      .table-player.last-action-check .table-player-status-icon {
        color: #9e9e9e !important;
      }

      .table-player.last-action-fold .table-player-bet-value,
      .table-player.last-action-fold .table-player-status-icon {
        color: #f44336 !important;
      }

      .table-player.last-action-call .table-player-bet-value,
      .table-player.last-action-call .table-player-status-icon {
        color: #2196f3 !important;
      }

      .table-player.last-action-raise .table-player-bet-value,
      .table-player.last-action-raise .table-player-status-icon {
        color: #4caf50 !important;
      }

      .ask-ai-button-container {
        margin-right: 8px;
        position: relative;
      }

      .ask-ai-button-container .tip {
        display: none !important;
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-top: 5px;
        white-space: nowrap;
        background: rgba(0, 0, 0, 0.8);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 16px;
        z-index: 100;
        color: white;
      }

      .ask-ai-button-container:hover .tip {
        display: block !important;
      }

      .ask-ai-button {
        font-weight: bold;
        text-indent: 0 !important;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: white !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center;
        justify-content: center;
      }

      .ask-ai-button:hover {
        background: linear-gradient(135deg, #764ba2 0%, #667eea 100%) !important;
      }

      .ask-ai-button svg {
        display: block;
        width: 32px;
        height: 32px;
        margin: 0;
      }
    `;
    document.head.appendChild(style);
    console.log('[SoundReplacer] 🎨 Last action highlight styles injected');
  }

  // Inject Ask AI button next to Sound button (for mobile view)
  function injectAskAIButton() {
    if (document.getElementById('pokernow-ask-ai-button')) return;

    const topRightButtons = document.querySelector('.top-right-buttons');
    if (!topRightButtons) {
      console.log('[SoundReplacer] .top-right-buttons not found, retrying...');
      setTimeout(injectAskAIButton, 1000);
      return;
    }

    const soundContainer = topRightButtons.querySelector('.sound-control-button-container');
    if (!soundContainer) {
      console.log('[SoundReplacer] .sound-control-button-container not found, retrying...');
      setTimeout(injectAskAIButton, 1000);
      return;
    }

    // Create Ask AI button container
    const askAIContainer = document.createElement('div');
    askAIContainer.className = 'ask-ai-button-container';

    const tipEl = document.createElement('p');
    tipEl.className = 'tip';
    tipEl.textContent = 'Ask AI for advice';

    const askAIButton = document.createElement('button');
    askAIButton.id = 'pokernow-ask-ai-button';
    askAIButton.className = 'button-1 dark-gray small-button action-button ask-ai-button';
    askAIButton.type = 'button';
    askAIButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>';

    askAIButton.addEventListener('click', () => {
      console.log('[SoundReplacer] 🤖 Ask AI button clicked');
      window.dispatchEvent(new CustomEvent('POKERNOW_MANUAL_AI_REQUEST'));
    });

    askAIContainer.appendChild(askAIButton);
    askAIContainer.appendChild(tipEl);

    // Insert before the sound button container
    topRightButtons.insertBefore(askAIContainer, soundContainer);

    console.log('[SoundReplacer] 🤖 Ask AI button injected');
  }

  // Listen for messages from content script
  window.addEventListener('POKERNOW_SOUND_SETTINGS', (e) => {
    customSoundDataUrl = e.detail.customSound;
    defaultSoundUrl = e.detail.defaultSound;
    customSoundEnabled = e.detail.enabled;
    soundVolume = (e.detail.volume !== undefined ? e.detail.volume : 100) / 100;
    aiProvider = e.detail.aiProvider || 'gemini';
    aiMode = e.detail.aiMode || 'auto';
    displayMode = e.detail.displayMode || 'bb';
    autoPlayEnabled = e.detail.autoPlayEnabled || false;
    autoPlaySettings = e.detail.autoPlaySettings || {};
    console.log('[SoundReplacer] Settings updated:', { hasSound: !!customSoundDataUrl, hasDefault: !!defaultSoundUrl, enabled: customSoundEnabled, volume: soundVolume, aiProvider, aiMode, displayMode, autoPlayEnabled });
  });

  // Listen for manual AI request from side panel
  window.addEventListener('POKERNOW_MANUAL_AI_REQUEST', () => {
    if (socketHandLog.length === 0) {
      console.log('[SoundReplacer] Manual AI request ignored - no hand log');
      return;
    }
    const logText = socketHandLog.join('\n');
    window.dispatchEvent(new CustomEvent('POKERNOW_SEND_TO_AI', {
      detail: { provider: aiProvider, handLog: logText }
    }));
    console.log(`[SoundReplacer] 🤖 Manual AI request sent to ${aiProvider}`);
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

    // Use custom sound if set, otherwise use default sound
    const soundUrl = customSoundDataUrl || defaultSoundUrl;
    const isDataUrl = soundUrl && soundUrl.startsWith('data:');

    if (!soundUrl) {
      console.log('[SoundReplacer] No sound available');
      return false;
    }

    // Use provided AudioContext, stored context, or create new one
    const ctx = audioContext || unlockedAudioContext;

    // For data URLs (custom uploaded sounds), use AudioContext for better compatibility
    if (ctx && isDataUrl) {
      playViaAudioContext(ctx, soundUrl);
      return true;
    }

    // For file URLs (default sound) or fallback, use Audio element
    try {
      const audio = new OriginalAudio(soundUrl);
      audio.volume = soundVolume;
      OriginalPlay.call(audio).catch(err => {
        console.error('[SoundReplacer] Play error:', err);
      });
      console.log('[SoundReplacer] ▶ Playing sound (Audio element):', isDataUrl ? 'custom' : 'default', 'volume:', soundVolume);
      return true;
    } catch (err) {
      console.error('[SoundReplacer] Error:', err);
      return false;
    }
  }

  // Play sound using AudioContext (works without user gesture if context is unlocked)
  function playViaAudioContext(ctx, dataUrl) {
    // Decode base64 data URL to ArrayBuffer
    const base64 = dataUrl.split(',')[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    ctx.decodeAudioData(bytes.buffer.slice(0), (buffer) => {
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      gainNode.gain.value = soundVolume;
      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(0);
      console.log('[SoundReplacer] ▶ Playing custom sound (AudioContext), volume:', soundVolume);
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

    // Second pass: determine action types
    let raiserFound = false;
    playerList.forEach(p => {
      let action = '';

      // Check fold first - folded players with blinds still show bet amount
      if (p.isFold) {
        action = 'fold';
      } else if (p.rawAction) {
        // Filter out status messages that aren't actions
        const rawLower = p.rawAction.toLowerCase();
        if (rawLower.includes('next hand') || rawLower.includes('offline') || rawLower.includes('away')) {
          action = ''; // Not an action, just status
        } else {
          action = rawLower;
        }
      } else if (p.betAmount > 0) {
        if (isPreflop) {
          if (p.name === sbPlayer && p.betAmount === 0.5) {
            action = 'SB';
          } else if (p.name === bbPlayer && p.betAmount === bbAmount) {
            action = 'BB';
          } else if (p.betAmount === bbAmount) {
            action = 'limp';
          } else if (p.betAmount > bbAmount) {
            // Any bet > 1BB: determine if raise or call
            // If player has max bet and is the first we see at max bet, they're the raiser
            // If player has less than max but >= 2BB, they raised and got re-raised
            if (p.betAmount === maxBet) {
              if (!raiserFound) {
                action = `raise ${p.betText}`;
                raiserFound = true;
              } else {
                action = `call ${p.betText}`;
              }
            } else if (p.betAmount >= 2) {
              // Player bet >= 2BB but someone else is higher - they raised and got re-raised
              action = `raise ${p.betText}`;
            } else {
              action = `call ${p.betText}`;
            }
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

  // Get table status (DOM-based logging disabled - socket provides game info)
  function logTableStatus() {
    return getTableStatus();
  }

  // Detect and log hand winners
  function checkForWinners() {
    if (winnerLogged) return;

    const winners = document.querySelectorAll('.table-player.winner');
    if (winners.length === 0) return;

    // Before logging winner, check for any missed folds
    // Only log folds for players who JUST folded (transitioned from not-fold to fold)
    // Don't re-log players who folded in previous streets
    const status = getTableStatus();
    for (const player of status.players) {
      // Skip all-in players
      if (allInPlayers.has(player.name)) continue;
      // Skip players who already acted
      if (playersActedThisRound.has(player.name)) continue;
      if (player.isFold) {
        const prevState = previousPlayerStates.get(player.name);
        // Only log if player just folded (wasn't folded before) or is a new player who's folded
        const justFolded = prevState ? !prevState.isFold : true;

        if (justFolded) {
          if (player.isYou) {
            dispatchLogEvent('myaction', `${player.name}: FOLD`);
          } else {
            dispatchLogEvent('action', `${player.name}: FOLD`);
          }
          playersActedThisRound.add(player.name);
        }
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
    // Remove previous highlight and action type classes
    const previousHighlight = document.querySelector('.table-player.last-action-highlight');
    if (previousHighlight) {
      previousHighlight.classList.remove('last-action-highlight');
      previousHighlight.classList.remove('last-action-check', 'last-action-fold', 'last-action-call', 'last-action-raise');
    }

    // Find ALL players who just acted by comparing with previous state
    const actedPlayers = [];

    for (const player of status.players) {
      const prevState = previousPlayerStates.get(player.name);

      // Skip the player whose turn it is (they haven't acted yet)
      if (player.hasDecision) continue;

      // Skip players who are already all-in from previous action (they can't act anymore)
      if (allInPlayers.has(player.name)) continue;

      // Check if player is now all-in (stack is 0 after betting)
      const stackValue = parseFloat(player.stack) || 0;
      const isAllIn = stackValue === 0 && player.betAmount > 0;

      if (!prevState) {
        // New player - check if they have an action
        if (player.action && player.action !== 'SB' && player.action !== 'BB') {
          if (isAllIn) {
            allInPlayers.add(player.name);
            actedPlayers.push({ ...player, action: `all-in ${player.betText}` });
          } else {
            actedPlayers.push(player);
          }
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
          } else if (betChanged && player.betAmount > prevState.betAmount) {
            // Bet increased - determine if it's a CALL or RAISE
            // Check if someone else already had a bet >= player's new bet (before this mutation)
            let someoneElseHadHigherBet = false;
            for (const [name, state] of previousPlayerStates) {
              if (name !== player.name && state.betAmount >= player.betAmount) {
                someoneElseHadHigherBet = true;
                break;
              }
            }

            // Track all-in
            if (isAllIn) {
              allInPlayers.add(player.name);
              actedPlayers.push({ ...player, action: `all-in ${player.betText}` });
            } else if (someoneElseHadHigherBet) {
              // Player matched someone else's bet = CALL
              actedPlayers.push({ ...player, action: `call ${player.betText}` });
            } else {
              // Player has the highest bet = RAISE/BET
              const actionType = status.isPreflop || streetHadBets ? 'raise' : 'bet';
              actedPlayers.push({ ...player, action: `${actionType} ${player.betText}` });
            }
          } else if (player.action && player.action !== prevState.action) {
            // Skip SB/BB - these are blinds, not actions
            if (player.action !== 'SB' && player.action !== 'BB') {
              actedPlayers.push(player);
            }
          } else if (isNewCheck && !isAllIn && !playersActedThisRound.has(player.name)) {
            // Check action - rawAction changed but action might not have
            // Skip if player is all-in (can't check) or already acted this round
            actedPlayers.push({ ...player, action: 'check' });
          }
        } else if (turnJustEnded && !player.isFold && player.betAmount === prevState.betAmount && !isAllIn && !playersActedThisRound.has(player.name)) {
          // Player's turn ended, they didn't fold or bet -> they checked
          // This catches cases where rawAction 'check' is missed
          // Skip if player is all-in (can't check) or already acted this round
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

        // Add action type class for text coloring
        const action = (lastActedPlayer.action || '').toLowerCase();
        if (action === 'check') {
          playerEl.classList.add('last-action-check');
        } else if (action === 'fold') {
          playerEl.classList.add('last-action-fold');
        } else if (action.startsWith('call') || action === 'limp') {
          playerEl.classList.add('last-action-call');
        } else if (action.startsWith('raise') || action.startsWith('bet') || action.startsWith('all-in')) {
          playerEl.classList.add('last-action-raise');
        }
      }
    }

    return actedPlayers;
  }

  // Log only the player action (minimal logging)
  function logPlayerAction(player, status) {
    // Skip if winner already logged (hand is over)
    if (winnerLogged) return;

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

  // ============================================
  // AUTO-PLAY FUNCTIONS
  // ============================================

  /**
   * Extract current hole cards from hand log
   * @returns {Array<string>|null} Array of two cards or null
   */
  function getCurrentHoleCards() {
    // Try to find cards from hand log first
    for (let i = handLog.length - 1; i >= 0; i--) {
      const entry = handLog[i];
      if (entry.message && entry.message.startsWith('Your cards:')) {
        const cardStr = entry.message.replace('Your cards:', '').trim();
        const cards = cardStr.split(' ').map(c => c.replace(/[♥♦♣♠]/g, (m) => {
          return {  '♥': 'h', '♦': 'd', '♣': 'c', '♠': 's' }[m] || m;
        }));
        if (cards.length === 2) {
          return cards;
        }
      }
    }

    // Fallback: extract from HTML (for mid-game joins)
    const youPlayer = document.querySelector('.you-player');
    if (youPlayer) {
      const cardContainers = youPlayer.querySelectorAll('.table-player-cards .card-container.flipped');
      const cards = [];
      for (const container of cardContainers) {
        const cardEl = container.querySelector('.card');
        if (cardEl) {
          const value = cardEl.querySelector('.value')?.textContent?.trim();
          // Get the last .suit element (not sub-suit)
          const suitEls = cardEl.querySelectorAll('.suit:not(.sub-suit)');
          const suit = suitEls.length > 0 ? suitEls[suitEls.length - 1]?.textContent?.trim() : null;
          if (value && suit) {
            cards.push(value + suit);
          }
        }
      }
      if (cards.length === 2) {
        return cards;
      }
    }

    return null;
  }

  /**
   * Get current position name
   * @returns {string} Position name (UTG, MP, CO, BTN, SB, BB)
   */
  function getCurrentPosition() {
    // Use socket-provided position if available (most accurate)
    if (socketMyPosition && socketMyPosition !== '?') {
      return socketMyPosition;
    }

    // Fallback to DOM-based calculation
    const status = getTableStatus();
    const myPlayer = status.players.find(p => p.isYou);
    if (!myPlayer) return '?';

    // Check if we're SB, BB, or BTN
    if (myPlayer.name === status.sbPlayer) return 'SB';
    if (myPlayer.name === status.bbPlayer) return 'BB';
    if (myPlayer.isDealer) return 'BTN';

    // Get active players (not folded at start of hand, not offline)
    const activePlayers = status.players.filter(p => !p.isOffline);
    if (activePlayers.length < 3) return '?';

    // Sort players by seat position relative to dealer
    const dealerPos = parseInt(status.dealerPosition) || 0;
    const sortedPlayers = [...activePlayers].map(p => ({
      ...p,
      distFromDealer: p.seat > dealerPos ? p.seat - dealerPos : p.seat + 100 - dealerPos
    })).sort((a, b) => a.distFromDealer - b.distFromDealer);

    // Find my index in sorted order (0=BTN, 1=SB, 2=BB, 3=UTG, etc.)
    const myIndex = sortedPlayers.findIndex(p => p.isYou);
    const numPlayers = sortedPlayers.length;

    // Position names based on distance from BTN
    // 0=BTN, 1=SB, 2=BB, 3+=positions before BTN
    if (myIndex === 0) return 'BTN';
    if (myIndex === 1) return 'SB';
    if (myIndex === 2) return 'BB';

    // Remaining positions: UTG, UTG+1, MP, HJ, CO
    const positionsBeforeBtn = numPlayers - 3; // Exclude BTN, SB, BB
    const posFromUtg = myIndex - 3; // 0 = UTG, 1 = UTG+1, etc.

    if (positionsBeforeBtn <= 1) {
      return 'UTG';
    } else if (positionsBeforeBtn === 2) {
      return posFromUtg === 0 ? 'UTG' : 'CO';
    } else if (positionsBeforeBtn === 3) {
      return ['UTG', 'MP', 'CO'][posFromUtg] || 'MP';
    } else if (positionsBeforeBtn === 4) {
      return ['UTG', 'MP', 'HJ', 'CO'][posFromUtg] || 'MP';
    } else {
      // 5+ positions before BTN
      if (posFromUtg === 0) return 'UTG';
      if (posFromUtg === 1) return 'UTG+1';
      if (posFromUtg === positionsBeforeBtn - 1) return 'CO';
      if (posFromUtg === positionsBeforeBtn - 2) return 'HJ';
      return 'MP';
    }
  }

  /**
   * Get big blind amount from game state
   * @returns {number} Big blind amount
   */
  function getBigBlind() {
    // Try to read from blind display (format: "SB / BB" e.g., "2 / 5")
    const blindValue = document.querySelector('.blind-value');
    if (blindValue) {
      const normalValues = blindValue.querySelectorAll('.chips-value .normal-value');
      if (normalValues.length >= 2) {
        // Second value is big blind
        const bb = parseFloat(normalValues[1].textContent.replace(/,/g, ''));
        if (bb > 0) return bb;
      }
    }

    // Try to parse from hand log
    for (let i = 0; i < handLog.length; i++) {
      const entry = handLog[i];
      if (entry.message && entry.message.includes('posts a big blind of')) {
        const match = entry.message.match(/big blind of ([\d,]+)/);
        if (match) {
          return parseFloat(match[1].replace(/,/g, ''));
        }
      }
    }

    // Calculate from stack and stackBB if available
    const stack = getMyStack();
    const stackBB = getMyStackBB();
    if (stack > 0 && stackBB > 0) {
      return Math.round(stack / stackBB);
    }

    return 100; // Default fallback
  }

  /**
   * Get amount needed to call
   * @returns {number} Amount to call
   */
  function getCurrentBetToCall() {
    const status = getTableStatus();
    const myPlayer = status.players.find(p => p.isYou);
    if (!myPlayer) return 0;

    const maxBet = Math.max(...status.players.map(p => parseFloat(p.betAmount) || 0));
    const myBet = parseFloat(myPlayer.betAmount) || 0;
    return Math.max(0, maxBet - myBet);
  }

  /**
   * Get my current stack in chips
   * @returns {number} Stack amount in chips
   */
  function getMyStack() {
    const youPlayer = document.querySelector('.you-player');
    if (!youPlayer) return 0;
    const normalValue = youPlayer.querySelector('.table-player-stack .normal-value');
    if (normalValue) {
      return parseFloat(normalValue.textContent.replace(/,/g, '')) || 0;
    }
    return 0;
  }

  /**
   * Get my current stack in BB
   * @returns {number} Stack amount in big blinds
   */
  function getMyStackBB() {
    const youPlayer = document.querySelector('.you-player');
    if (!youPlayer) return 0;
    const bbValue = youPlayer.querySelector('.table-player-stack .bb-value');
    if (bbValue) {
      // Parse "100BB" or "58.4BB" -> 100 or 58.4
      return parseFloat(bbValue.textContent.replace(/[,BB]/gi, '')) || 0;
    }
    return 0;
  }

  /**
   * Get current highest bet on table
   * @returns {number} Highest bet amount
   */
  function getCurrentBet() {
    const status = getTableStatus();
    return Math.max(...status.players.map(p => parseFloat(p.betAmount) || 0));
  }

  /**
   * Check if we're in preflop
   * @returns {boolean} True if preflop
   */
  function isPreflop() {
    const tableCards = document.querySelectorAll('.table-cards .card-container');
    return tableCards.length === 0;
  }

  /**
   * Check if facing an all-in
   * @returns {boolean} True if any opponent is all-in
   */
  function isFacingAllIn() {
    const status = getTableStatus();
    return status.players.some(p => !p.isYou && p.isAllIn);
  }

  /**
   * Execute auto-play action
   * @param {Object} action - Action to execute
   */
  function executeAutoAction(action) {
    if (!action || autoActionCancelled) {
      console.log('[AutoPlay] Action cancelled or invalid');
      return;
    }

    const status = getTableStatus();
    if (!isCurrentlyMyTurn()) {
      console.log('[AutoPlay] Not our turn anymore, aborting action');
      return;
    }

    console.log(`[AutoPlay] Executing action: ${action.action}${action.amount ? ' ' + action.amount : ''}`);

    // Find the action buttons container
    const actionButtons = document.querySelector('.game-decisions-ctn .action-buttons');
    if (!actionButtons) {
      console.error('[AutoPlay] Action buttons not found');
      return;
    }

    // Execute based on action type
    switch (action.action) {
      case 'fold': {
        const foldBtn = actionButtons.querySelector('button.fold');
        if (foldBtn && !foldBtn.disabled) {
          foldBtn.click();
          console.log('[AutoPlay] ✓ Fold executed');
          dispatchSocketLog('autoplay', `✅ Auto-FOLD executed`);
        } else {
          console.error('[AutoPlay] Fold button not found or disabled');
        }
        break;
      }

      case 'call':
      case 'check': {
        // Try check first, then call
        const checkBtn = actionButtons.querySelector('button.check');
        const callBtn = actionButtons.querySelector('button.call');
        if (checkBtn && !checkBtn.disabled) {
          checkBtn.click();
          console.log('[AutoPlay] ✓ Check executed');
          dispatchSocketLog('autoplay', `✅ Auto-CHECK executed`);
        } else if (callBtn && !callBtn.disabled) {
          callBtn.click();
          console.log('[AutoPlay] ✓ Call executed');
          dispatchSocketLog('autoplay', `✅ Auto-CALL executed`);
        } else {
          console.error('[AutoPlay] Check/Call button not found or disabled');
        }
        break;
      }

      case 'raise': {
        if (!action.amount) {
          console.error('[AutoPlay] Raise amount not specified');
          return;
        }

        // Click raise button first to open the raise panel
        const raiseBtn = actionButtons.querySelector('button.raise');
        if (!raiseBtn || raiseBtn.disabled) {
          console.error('[AutoPlay] Raise button not found or disabled');
          return;
        }

        raiseBtn.click();

        // Wait for raise panel to appear, then handle based on scenario
        setTimeout(() => {
          // Check if this is an isolation raise facing limps
          const isFacingLimp = action.scenario === 'facing-limp';

          if (isFacingLimp) {
            // For facing limps, click the pot button for isolation raise
            console.log('[AutoPlay] Facing limp - looking for pot button');

            // Try multiple selectors for pot button
            const potBtn = document.querySelector(
              '.game-decisions-ctn button.pot, ' +
              '.game-decisions-ctn .raise-values button:has-text("Pot"), ' +
              '.game-decisions-ctn .raise-value-pot, ' +
              '.game-decisions-ctn button[data-value="pot"], ' +
              '.game-decisions-ctn .quick-bets button.pot'
            ) || Array.from(document.querySelectorAll('.game-decisions-ctn button')).find(btn =>
              btn.textContent.trim().toLowerCase() === 'pot' ||
              btn.textContent.trim().toLowerCase() === '1x pot' ||
              btn.classList.contains('pot')
            );

            if (potBtn && !potBtn.disabled) {
              potBtn.click();
              console.log('[AutoPlay] ✓ Pot button clicked for isolation raise');
              dispatchSocketLog('autoplay', `✅ Auto-RAISE (Pot) executed vs limp`);

              // Wait a bit then confirm
              setTimeout(() => {
                const confirmBtn = document.querySelector('.game-decisions-ctn button.raise-confirm, .game-decisions-ctn button.bet-confirm, .game-decisions-ctn .action-buttons button.raise');
                if (confirmBtn && !confirmBtn.disabled) {
                  confirmBtn.click();
                  console.log('[AutoPlay] ✓ Raise confirmed');
                } else {
                  console.error('[AutoPlay] Raise confirm button not found');
                }
              }, 100);
            } else {
              console.log('[AutoPlay] Pot button not found, falling back to manual amount');
              // Fallback to manual entry
              const raiseInput = document.querySelector('.game-decisions-ctn input[type="text"], .game-decisions-ctn input[type="number"]');
              if (raiseInput) {
                raiseInput.value = Math.round(action.amount);
                raiseInput.dispatchEvent(new Event('input', { bubbles: true }));
                raiseInput.dispatchEvent(new Event('change', { bubbles: true }));

                setTimeout(() => {
                  const confirmBtn = document.querySelector('.game-decisions-ctn button.raise-confirm, .game-decisions-ctn button.bet-confirm, .game-decisions-ctn .action-buttons button.raise');
                  if (confirmBtn && !confirmBtn.disabled) {
                    confirmBtn.click();
                    console.log(`[AutoPlay] ✓ Raise ${action.amount} executed (fallback)`);
                    dispatchSocketLog('autoplay', `✅ Auto-RAISE ${action.amount} executed`);
                  }
                }, 100);
              }
            }
          } else {
            // For other scenarios, use manual amount entry
            const raiseInput = document.querySelector('.game-decisions-ctn input[type="text"], .game-decisions-ctn input[type="number"]');
            if (!raiseInput) {
              console.error('[AutoPlay] Raise input not found');
              return;
            }

            // Set the raise amount
            raiseInput.value = Math.round(action.amount);
            raiseInput.dispatchEvent(new Event('input', { bubbles: true }));
            raiseInput.dispatchEvent(new Event('change', { bubbles: true }));

            // Find and click the confirm raise button
            setTimeout(() => {
              const confirmBtn = document.querySelector('.game-decisions-ctn button.raise-confirm, .game-decisions-ctn button.bet-confirm, .game-decisions-ctn .action-buttons button.raise');
              if (confirmBtn && !confirmBtn.disabled) {
                confirmBtn.click();
                console.log(`[AutoPlay] ✓ Raise ${action.amount} executed`);
                dispatchSocketLog('autoplay', `✅ Auto-RAISE ${action.amount} executed`);
              } else {
                console.error('[AutoPlay] Raise confirm button not found');
              }
            }, 100);
          }
        }, 200);
        break;
      }

      default:
        console.error(`[AutoPlay] Unknown action: ${action.action}`);
    }

    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent('POKERNOW_AUTO_ACTION_EXECUTED', {
      detail: { action }
    }));
  }

  /**
   * Schedule auto-play action with optional confirmation
   * @param {Object} action - Action to schedule
   */
  function scheduleAutoAction(action) {
    if (!action || action.action === 'pause') {
      console.log(`[AutoPlay] Action paused: ${action?.reason || 'unknown'}`);
      return;
    }

    // Cancel any existing timer
    if (autoActionTimer) {
      clearTimeout(autoActionTimer);
      autoActionTimer = null;
    }

    autoActionCancelled = false;
    currentAutoAction = action;

    const confirmationMode = autoPlaySettings.confirmationMode !== false;
    const delay = confirmationMode ? (autoPlaySettings.confirmationDelay || 5000) : (autoPlaySettings.actingDelay || 1000);

    console.log(`[AutoPlay] Scheduling ${action.action} in ${delay}ms (confirmation: ${confirmationMode})`);

    // Dispatch event for UI to show countdown
    if (confirmationMode) {
      window.dispatchEvent(new CustomEvent('POKERNOW_AUTO_ACTION_PREVIEW', {
        detail: { action, delay }
      }));
    }

    // Schedule execution
    autoActionTimer = setTimeout(() => {
      if (!autoActionCancelled && currentAutoAction === action) {
        executeAutoAction(action);
      }
      autoActionTimer = null;
      currentAutoAction = null;
    }, delay);
  }

  /**
   * Cancel scheduled auto-play action
   */
  function cancelAutoAction() {
    if (autoActionTimer) {
      clearTimeout(autoActionTimer);
      autoActionTimer = null;
    }
    autoActionCancelled = true;
    currentAutoAction = null;
    console.log('[AutoPlay] Action cancelled');
  }

  /**
   * Handle auto-play decision on my turn
   * @returns {boolean} True if autoplay handled the action, false otherwise
   */
  function handleAutoPlay() {
    if (!autoPlayEnabled || !autoPlaySettings || !window.AutoPlayEngine) {
      return false;
    }

    // Only auto-play preflop
    if (!isPreflop()) {
      console.log('[AutoPlay] Not preflop, skipping');
      return false;
    }

    // Get hole cards
    const cards = getCurrentHoleCards();
    if (!cards || cards.length !== 2) {
      console.log('[AutoPlay] Could not extract hole cards');
      return false;
    }

    // Build game state
    const bigBlind = getBigBlind();
    const stack = getMyStack();
    const stackBB = getMyStackBB();
    const toCall = getCurrentBetToCall();
    const currentBet = getCurrentBet();
    const pot = parseFloat(document.querySelector('.pot-container .pot-amount')?.textContent.replace(/,/g, '') || '0');

    const tableStatus = getTableStatus();
    const activePlayers = tableStatus.players.filter(p => !p.isFold && !p.isOffline).length;
    const spr = pot > 0 ? stack / pot : 999; // Stack-to-Pot Ratio

    const gameState = {
      cards: cards,
      position: getCurrentPosition(),
      pot: pot,
      toCall: toCall,
      stack: stack,
      stackBB: stackBB,
      bigBlind: bigBlind,
      currentBet: currentBet,
      isMyTurn: isCurrentlyMyTurn(),
      isAllIn: isFacingAllIn(),
      players: tableStatus.players,
      activePlayers: activePlayers,
      spr: spr
    };

    console.log('[AutoPlay] Game state:', gameState);

    // Get auto-action from engine
    const autoAction = window.AutoPlayEngine.getAutoAction(gameState, autoPlaySettings);

    if (autoAction && autoAction.action !== 'pause') {
      console.log('[AutoPlay] Decision:', autoAction);

      // Log to Game Log
      const tableType = window.AutoPlayEngine.getTableType(activePlayers);
      dispatchSocketLog('autoplay', `🤖 ${autoAction.hand} in ${autoAction.position} (${tableType}) → ${autoAction.action.toUpperCase()}`);

      // Only auto-execute FOLD and CHECK actions (low-risk actions)
      if (autoAction.action === 'fold' || autoAction.action === 'check') {
        scheduleAutoAction(autoAction);
        // Suppress turn sound when autoplay is handling the action
        isMyTurnPending = false;
        return true;
      } else {
        // Log non-fold/check actions but don't auto-execute
        console.log(`[AutoPlay] ${autoAction.action.toUpperCase()} detected but not auto-executing (only fold/check is auto-played)`);
        dispatchSocketLog('autoplay', `⏸️ ${autoAction.action.toUpperCase()} requires manual action`);
        return false;
      }
    } else if (autoAction && autoAction.action === 'pause') {
      // Log pause reason to Game Log
      console.log(`[AutoPlay] Paused: ${autoAction.reason}`);
      dispatchSocketLog('autoplay', `⏸️ Paused: ${autoAction.reason}`);
      return false;
    } else {
      console.log('[AutoPlay] No action determined - turn sound and AI will trigger');
      return false;
    }
  }

  // Listen for cancel auto-play event
  window.addEventListener('POKERNOW_CANCEL_AUTO_ACTION', () => {
    cancelAutoAction();
  });

  // ============================================
  // END AUTO-PLAY FUNCTIONS
  // ============================================

  // Detect when it's my turn by watching for UI changes
  function setupTurnDetection() {
    // Inject highlight styles
    injectHighlightStyles();
    // Inject Ask AI button next to Sound button
    injectAskAIButton();

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
      // Capture max bet from previous states (before they get updated)
      let maxPrevBet = 0;
      for (const [, state] of previousPlayerStates) {
        if (state.betAmount > maxPrevBet) {
          maxPrevBet = state.betAmount;
        }
      }

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
          // Skip all-in players
          if (allInPlayers.has(player.name)) continue;
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
        allInPlayers.clear(); // Reset all-in tracking for new hand
      }

      // Prepare street info if new street is dealt (but don't log yet)
      let newStreetInfo = null;
      if (isNewStreet) {
        // Before logging the street, check for any missed actions
        // This happens when the last player's action and street deal are batched together
        // and bets get collected before we can detect the action

        // First, check for any missed folds (players who folded but weren't logged)
        for (const player of status.players) {
          // Skip all-in players
          if (allInPlayers.has(player.name)) continue;
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

            // Skip all-in players (already logged their action)
            if (allInPlayers.has(player.name)) continue;

            // Handle BB check (preflop only)
            if (prevAction === 'BB' && lastTableCardCount === 0) {
              // Skip if already acted
              if (playersActedThisRound.has(player.name)) continue;
              // BB checked if max bet was 1BB (no raise)
              if (maxPrevBet === 1) {
                dispatchLogEvent('action', `${player.name}: CHECK`);
                playersActedThisRound.add(player.name);
              }
              // BB called if there was a raise and they're still in
              else if (prevBet < maxPrevBet) {
                dispatchLogEvent('action', `${player.name}: CALL ${maxPrevBet}BB`);
                playersActedThisRound.add(player.name);
              }
              continue;
            }

            // Skip SB
            if (prevAction === 'SB') continue;

            // Skip players who raised/bet (they're the aggressor, not a caller)
            const isAggressor = prevAction && (prevAction.startsWith('raise') || prevAction.startsWith('bet') || prevAction.startsWith('all-in'));
            if (isAggressor) continue;

            // Skip players who already acted this round
            if (playersActedThisRound.has(player.name)) continue;

            // If they had a bet at max level but weren't the aggressor, they called
            if (prevBet === maxPrevBet && maxPrevBet > 0) {
              dispatchLogEvent('action', `${player.name}: CALL ${maxPrevBet}BB`);
              playersActedThisRound.add(player.name);
              continue;
            }

            // If they had a bet less than max, they must have called
            if (prevBet > 0 && prevBet < maxPrevBet) {
              dispatchLogEvent('action', `${player.name}: CALL ${maxPrevBet}BB`);
              playersActedThisRound.add(player.name);
            }
          }
        }

        // Check for missed CHECKs on postflop streets (when no one bet)
        if (lastTableCardCount > 0 && !streetHadBets) {
          // Postflop street where everyone checked
          for (const playerName of actionOrder) {
            // Skip all-in players (they can't check)
            if (allInPlayers.has(playerName)) continue;
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

        // Store street info to log AFTER current actions are detected
        const tableCards = getTableCards();
        const pot = getPotSize();
        let street = '';
        if (currentTableCardCount === 3) street = 'FLOP';
        else if (currentTableCardCount === 4) street = 'TURN';
        else if (currentTableCardCount === 5) street = 'RIVER';
        newStreetInfo = { street, tableCards, pot };
      }

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
        // Highlight and log all actions BEFORE logging the street
        // This ensures actions from the previous street are logged before the new street
        const actedPlayers = highlightLastAction(status);

        // Sort acted players by action order (position) before logging
        // This ensures actions are logged in correct poker order, not detection order
        actedPlayers.sort((a, b) => {
          const aIndex = actionOrder.indexOf(a.name);
          const bIndex = actionOrder.indexOf(b.name);
          // Players not in actionOrder go to the end
          if (aIndex === -1 && bIndex === -1) return 0;
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });

        for (const player of actedPlayers) {
          logPlayerAction(player, status);
        }
      }

      // NOW log the street change (after actions from previous street are logged)
      if (newStreetInfo) {
        dispatchLogEvent('street', `${newStreetInfo.street}: ${newStreetInfo.tableCards.join(' ')} (Pot: ${newStreetInfo.pot})`);

        // Reset action tracking for new street (postflop order)
        actionOrder = calculateActionOrder(status, false);
        playersActedThisRound.clear();
        streetHadBets = false; // Reset bet tracking for new street
      }

      // Check for winners after logging actions
      checkForWinners();
      
      // Only trigger when turn STARTS (transitions from not-my-turn to my-turn)
      // Also trigger on new street if it's my turn (handles case where turn ends and starts in same batch)
      const turnJustStarted = isMyTurn && !wasMyTurn;
      const newStreetMyTurn = isNewStreet && isMyTurn && wasMyTurn; // Turn "continued" across street boundary
      if (turnJustStarted || newStreetMyTurn) {
        if (newStreetMyTurn) {
          console.log('[SoundReplacer] Turn detected on new street (turn continued across street boundary)');
        }

        // Check if autoplay might handle this action (suppress sound if so)
        const autoplayMightHandle = autoPlayEnabled && autoPlaySettings && window.AutoPlayEngine && isPreflop();

        // Only set pending (to allow sound) if autoplay won't handle
        if (!autoplayMightHandle) {
          isMyTurnPending = true;
        }

        // Handle auto-play if enabled, then send to AI if autoplay didn't handle it
        setTimeout(() => {
          const autoplayHandled = handleAutoPlay();
          // Only send to AI if autoplay didn't handle the action
          if (!autoplayHandled) {
            // If autoplay didn't handle, enable sound now (if not already enabled)
            if (autoplayMightHandle) {
              isMyTurnPending = true;
              // Trigger fallback sound since we suppressed it initially
              if (customSoundEnabled && (customSoundDataUrl || defaultSoundUrl) && audioUnlocked) {
                console.log('[SoundReplacer] ⏰ Fallback: Playing custom sound (autoplay declined)');
                playCustomSound();
                isMyTurnPending = false;
              }
            }
            sendToAI();
          }
        }, 200); // Small delay to ensure game state is fully updated

        // FALLBACK: Directly play custom sound after a short delay (only if autoplay not checking)
        // Only works if audio was unlocked via user interaction
        if (!autoplayMightHandle) {
          setTimeout(() => {
            if (isMyTurnPending && customSoundEnabled && (customSoundDataUrl || defaultSoundUrl) && audioUnlocked) {
              console.log('[SoundReplacer] ⏰ Fallback: Playing custom sound directly');
              playCustomSound();
              isMyTurnPending = false;
            }
          }, SOUND_CHECK_DELAY_MS);
        }

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
                // No one bet this street, hero is betting (not calling)
                action = `BET ${youPlayer.betAmount}BB`;
              }
            }
          }
          // Detect check from rawAction (only if no bet action)
          if (!action && youPlayer.rawAction === 'check') {
            action = 'CHECK';
          }
          // If still no action and street just changed, use heroPrevState (captured before updates)
          if (!action && isNewStreet && heroPrevState) {
            // Hero was BB facing a raise - they must have called
            if (heroPrevState.action === 'BB' && maxPrevBet > 1) {
              action = `CALL ${maxPrevBet}BB`;
            } else if (heroPrevState.betAmount > 0 && heroPrevState.action !== 'SB' && heroPrevState.action !== 'BB') {
              // Hero had a bet before collection - determine if it was a raise or call
              // If streetHadBetsAtStart is true, someone else already bet/raised, so hero called
              if (streetHadBetsAtStart) {
                action = `CALL ${heroPrevState.betAmount}BB`;
              } else if (heroPrevState.action && heroPrevState.action.startsWith('raise')) {
                action = heroPrevState.action.toUpperCase();
              } else {
                action = `CALL ${heroPrevState.betAmount}BB`;
              }
            } else if (streetHadBetsAtStart && maxPrevBet > 0) {
              // Fallback: Hero's bet wasn't captured but someone bet and hero didn't fold
              // They must have called the max bet
              action = `CALL ${maxPrevBet}BB`;
            }
          }
          if (action) {
            // Before logging hero's action, check for missed folds from earlier players
            const heroIndex = actionOrder.indexOf(youPlayer.name);
            if (heroIndex > 0) {
              for (let i = 0; i < heroIndex; i++) {
                const earlierPlayerName = actionOrder[i];
                if (!playersActedThisRound.has(earlierPlayerName)) {
                  const earlierPlayer = status.players.find(p => p.name === earlierPlayerName);
                  if (earlierPlayer && earlierPlayer.isFold) {
                    dispatchLogEvent('action', `${earlierPlayerName}: FOLD`);
                    playersActedThisRound.add(earlierPlayerName);
                  }
                }
              }
            }

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
    return customSoundEnabled && (customSoundDataUrl || defaultSoundUrl) && isMyTurnPending;
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
