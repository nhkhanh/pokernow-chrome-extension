// Auto-Play Decision Engine for Preflop Auto-Play
// Determines appropriate action based on game state and configured ranges

(function() {
  'use strict';

  // ============================================
  // CONFIGURABLE RANGES
  // ============================================

  /**
   * Range for widening in short-handed (2-3 players) situations.
   * When a hand would normally fold but matches this range, it calls instead.
   * This is a very wide range suitable for heads-up and 3-handed play.
   */
  const SHORTHANDED_CALL_RANGE = '22+,A2s+,K2s+,Q2s+,J5s+,T6s+,96s+,86s+,75s+,65s,54s,A2o+,K5o+,Q7o+,J8o+,T8o+,98o';

  /**
   * Range for heads-up only (even wider than shorthanded)
   * Currently same as shorthanded, can be customized for more aggressive HU play
   */
  const HEADSUP_CALL_RANGE = '22+,A2s+,K2s+,Q2s+,J4s+,T5s+,95s+,85s+,74s+,64s+,54s,A2o+,K4o+,Q6o+,J7o+,T8o+,97o+';

  // ============================================

  /**
   * Detect the current scenario based on opponent actions
   * @param {Object} gameState - Current game state
   * @returns {string} Scenario type: "unopened", "facing-limp", "facing-raise", "facing-3bet"
   */
  function detectScenario(gameState) {
    const { players, toCall, currentBet } = gameState;

    // Collect all opponent actions (excluding our own)
    const opponentActions = [];

    for (const player of players) {
      if (player.isYou) continue;
      if (player.isFold || player.isOffline) continue;

      if (player.action) {
        const actionLower = player.action.toLowerCase();

        // Skip pure blind postings (SB/BB with no further action)
        if (actionLower === 'sb' || actionLower === 'bb') {
          continue;
        }

        // Skip small bets that are just blind postings (e.g., "bet 0.4bb" for SB)
        if (actionLower.includes('bet')) {
          const betSize = extractBetSize(actionLower);
          if (betSize <= 1) {
            continue; // Skip blind postings
          }
        }

        opponentActions.push(actionLower);
      }
    }

    console.log('[AutoPlay] Opponent actions:', opponentActions);

    // Helper to extract bet size in BB from action string like "bet 2.5bb" or "raise 6bb"
    function extractBetSize(action) {
      const match = action.match(/(\d+\.?\d*)\s*bb/i);
      return match ? parseFloat(match[1]) : 0;
    }

    // Count raises/bets (only count bets > 1BB as raises, since ≤1BB is likely blind/limp)
    const raiseCount = opponentActions.filter(a => {
      if (a.includes('all-in')) return true;
      if (a.includes('raise')) return true;
      if (a.includes('bet')) {
        const betSize = extractBetSize(a);
        return betSize > 1; // Only count bets > 1BB as raises
      }
      return false;
    }).length;

    const limpCount = opponentActions.filter(a =>
      a.includes('call') || a.includes('limp')
    ).length;

    console.log('[AutoPlay] Raise count:', raiseCount, 'Limp count:', limpCount, 'currentBet:', currentBet);

    // Also check if facing a raise based on bet amounts (backup check)
    // If currentBet > 1BB and we have to call, there's been a raise
    const facingRaiseBySizing = currentBet > 1;

    // Determine scenario
    if (raiseCount >= 2) return 'facing-3bet';
    if (raiseCount === 1 || facingRaiseBySizing) return 'facing-raise';
    if (limpCount > 0) return 'facing-limp';
    return 'unopened';
  }

  /**
   * Normalize position name to standard format
   * @param {string} position - Position from game state
   * @returns {string} Normalized position (UTG, MP, CO, BTN, SB, BB)
   */
  function normalizePosition(position) {
    if (!position) return 'MP';

    const pos = position.toUpperCase();

    // Map various position names to standard ones
    // Check specific positions first before checking includes()
    if (pos === 'UTG' || pos === 'EP' || pos === 'EARLY') return 'UTG';
    if (pos.includes('UTG+') || pos.includes('MP') || pos === 'MIDDLE') return 'MP'; // UTG+1, UTG+2 are MP
    if (pos.includes('CO') || pos === 'CUT' || pos === 'CUTOFF') return 'CO';
    if (pos.includes('BTN') || pos.includes('BUTTON') || pos === 'D') return 'BTN';
    if (pos.includes('SB') || pos === 'SMALL') return 'SB';
    if (pos.includes('BB') || pos === 'BIG') return 'BB';

    // Default to MP for unknown positions
    return 'MP';
  }

  /**
   * Calculate raise size based on settings and scenario
   * @param {string} scenario - Current scenario
   * @param {Object} gameState - Game state
   * @param {Object} settings - Auto-play settings
   * @returns {number} Raise size in chips
   */
  function calculateRaiseSize(scenario, gameState, settings) {
    const { pot, toCall, bigBlind, currentBet } = gameState;
    const raiseSizing = settings.raiseSizing || {};

    let sizeBB;

    switch (scenario) {
      case 'unopened':
        sizeBB = raiseSizing.unopened || 2.5;
        return sizeBB * bigBlind;

      case 'facing-limp':
        // Base size + 1BB per limper
        const baseSizeBB = raiseSizing['facing-limp'] || 3;
        const limperCount = Math.max(1, Math.floor(pot / bigBlind) - 1.5); // Rough estimate
        sizeBB = baseSizeBB + limperCount;
        return sizeBB * bigBlind;

      case 'facing-raise':
        // 3-bet: typically 3x the raise
        const raiseMultiplier = raiseSizing['3bet'] || 3;
        return currentBet * raiseMultiplier;

      case 'facing-3bet':
        // 4-bet: typically 2.5x the 3-bet
        const fourBetMultiplier = raiseSizing['4bet'] || 2.5;
        return currentBet * fourBetMultiplier;

      default:
        return 2.5 * bigBlind;
    }
  }

  /**
   * Get the appropriate action from range configuration
   * @param {string} hand - Hand notation (e.g., "AKs")
   * @param {Object} rangeConfig - Range configuration for position and scenario
   * @returns {string|null} Action: "raise", "3bet", "4bet", "call", "check", "fold", or null
   */
  function getActionFromRange(hand, rangeConfig) {
    if (!rangeConfig || !hand) return null;

    // Check each action in priority order
    const actionPriority = ['4bet', '3bet', 'raise', 'call', 'check', 'fold'];

    for (const action of actionPriority) {
      if (rangeConfig[action] && window.HandEvaluator) {
        if (window.HandEvaluator.matchesRange(hand, rangeConfig[action])) {
          return action;
        }
      }
    }

    // Default to fold if no match
    return 'fold';
  }

  /**
   * Adjust ranges based on stack size
   * @param {number} stackBB - Stack in big blinds
   * @param {Object} settings - Auto-play settings
   * @returns {string|null} Adjustment: "tighten", "widen", or null
   */
  function getStackAdjustment(stackBB, settings) {
    const thresholds = settings.stackThresholds || { short: 20, deep: 100 };

    if (stackBB < thresholds.short) {
      return 'tighten'; // Play tighter with short stack
    } else if (stackBB > thresholds.deep) {
      return 'widen'; // Can play more hands with deep stack
    }

    return null;
  }

  /**
   * Get table type based on number of active players
   * @param {number} activePlayers - Number of active players
   * @returns {string} Table type: "headsup", "shorthanded", "fullring", "multiway"
   */
  function getTableType(activePlayers) {
    if (activePlayers <= 2) return 'headsup';
    if (activePlayers === 3) return 'shorthanded';
    if (activePlayers <= 6) return 'fullring';
    return 'multiway'; // 7+ players
  }

  /**
   * Check if we should tighten ranges based on multiway pot
   * @param {number} activePlayers - Number of active players
   * @returns {boolean} True if we should play tighter
   */
  function shouldTightenForMultiway(activePlayers) {
    // Tighten ranges when 4+ players are active (multiway pot)
    return activePlayers >= 4;
  }

  /**
   * Check if we should widen ranges for short-handed play
   * @param {number} activePlayers - Number of active players
   * @returns {boolean} True if we should play wider
   */
  function shouldWidenForShorthanded(activePlayers) {
    return activePlayers <= 3;
  }

  /**
   * Check if action should be paused for safety
   * @param {Object} gameState - Current game state
   * @returns {Object} { shouldPause: boolean, reason: string }
   */
  function checkSafetyPause(gameState) {
    const { stackBB, toCall, stack, isAllIn, spr } = gameState;

    // Don't auto-play if facing an all-in
    if (isAllIn) {
      return { shouldPause: true, reason: 'Facing all-in' };
    }

    // Check SPR caution (low SPR = pot committed)
    if (spr !== undefined && spr < 3) {
      return { shouldPause: true, reason: `Low SPR (${spr.toFixed(1)}) - pot committed` };
    }

    // Don't auto-play with very short stack
    if (stackBB < 10) {
      return { shouldPause: true, reason: 'Stack too short (< 10BB)' };
    }

    // Don't auto-play if bet is unusually large
    if (toCall > stack * 0.5) {
      return { shouldPause: true, reason: 'Bet too large (> 50% of stack)' };
    }

    return { shouldPause: false, reason: null };
  }

  /**
   * Get auto-play action based on game state and settings
   * @param {Object} gameState - Current game state
   * @param {Object} settings - Auto-play settings
   * @returns {Object|null} Action object or null
   */
  function getAutoAction(gameState, settings) {
    console.log('[AutoPlay] getAutoAction called, settings:', settings);

    if (!gameState || !settings) {
      console.log('[AutoPlay] Early exit - gameState:', !!gameState, 'settings:', !!settings);
      return null;
    }

    // Safety check
    const safetyCheck = checkSafetyPause(gameState);
    if (safetyCheck.shouldPause) {
      console.log(`[AutoPlay] Paused: ${safetyCheck.reason}`);
      return {
        action: 'pause',
        reason: safetyCheck.reason
      };
    }

    const { cards, position, stackBB, pot, toCall, bigBlind, currentBet, activePlayers, spr } = gameState;

    // Validate we have cards
    if (!cards || cards.length !== 2) {
      console.log('[AutoPlay] No hole cards detected');
      return null;
    }

    // Convert cards to hand notation
    const hand = window.HandEvaluator?.cardsToHandNotation(cards[0], cards[1]);
    if (!hand) {
      console.log('[AutoPlay] Could not parse hand notation');
      return null;
    }

    // Normalize position
    const normalizedPosition = normalizePosition(position);

    // Detect scenario
    const scenario = detectScenario(gameState);

    // Determine table type for gradient adjustments
    const tableType = getTableType(activePlayers);

    console.log(`[AutoPlay] Hand: ${hand}, Position: ${normalizedPosition}, Scenario: ${scenario}, Stack: ${stackBB.toFixed(1)}BB, Table: ${tableType} (${activePlayers || '?'}p), SPR: ${spr ? spr.toFixed(1) : '?'}`);

    // Get range configuration for this position and scenario
    const ranges = settings.ranges || {};
    const positionRanges = ranges[normalizedPosition];

    if (!positionRanges) {
      console.log(`[AutoPlay] No ranges configured for position ${normalizedPosition}`);
      return null;
    }

    const scenarioRange = positionRanges[scenario];
    if (!scenarioRange) {
      console.log(`[AutoPlay] No range configured for scenario ${scenario}`);
      return null;
    }

    // Get action from range
    let action = getActionFromRange(hand, scenarioRange);

    // Gradient adjustment based on table type:
    // - headsup/shorthanded (2-3p): Widen - auto-play more actions including calls
    // - fullring (4-6p): Standard - use configured ranges
    // - multiway (7+p): Tighten - pause for marginal calls
    if (tableType === 'multiway') {
      // Multiway pot: pause for marginal calls to let human decide
      if (action === 'call') {
        console.log(`[AutoPlay] Multiway pot (${activePlayers} players) - pausing for marginal call`);
        return {
          action: 'pause',
          reason: `Multiway pot (${activePlayers} players) - manual decision needed`,
          hand: hand,
          position: normalizedPosition,
          scenario: scenario,
          tableType: tableType
        };
      }
    } else if (tableType === 'headsup') {
      // Heads-up: widest range, very aggressive
      if (action === 'fold' && toCall > 0) {
        const isPlayableHeadsup = window.HandEvaluator?.matchesRange(hand, HEADSUP_CALL_RANGE);
        if (isPlayableHeadsup) {
          console.log(`[AutoPlay] Heads-up - widening range, calling with ${hand}`);
          action = 'call';
        }
      }
    } else if (tableType === 'shorthanded') {
      // 3-handed: wide but slightly tighter than heads-up
      if (action === 'fold' && toCall > 0) {
        const isPlayableShorthanded = window.HandEvaluator?.matchesRange(hand, SHORTHANDED_CALL_RANGE);
        if (isPlayableShorthanded) {
          console.log(`[AutoPlay] Shorthanded (3p) - widening range, calling with ${hand}`);
          action = 'call';
        }
      }
    }

    if (!action || action === 'fold') {
      // Never fold when we can check for free
      if (toCall === 0) {
        console.log('[AutoPlay] Can check for free - checking instead of folding');
        return {
          action: 'check',
          hand: hand,
          position: normalizedPosition,
          scenario: scenario,
          reasoning: `${hand} in ${normalizedPosition}: check (free)`
        };
      }
      return {
        action: 'fold',
        hand: hand,
        position: normalizedPosition,
        scenario: scenario
      };
    }

    // Map 3bet/4bet to raise
    const actionType = (action === '3bet' || action === '4bet') ? 'raise' : action;

    // Calculate raise amount if needed
    let amount = null;
    if (actionType === 'raise') {
      amount = calculateRaiseSize(scenario, gameState, settings);

      // Validate raise size
      if (amount < currentBet * 2) {
        amount = currentBet * 2; // Minimum raise is 2x current bet
      }
      if (amount > gameState.stack) {
        amount = gameState.stack; // Can't raise more than stack
      }
    }

    return {
      action: actionType,
      amount: amount,
      hand: hand,
      position: normalizedPosition,
      scenario: scenario,
      reasoning: `${hand} in ${normalizedPosition} ${scenario}: ${action}`
    };
  }

  /**
   * Validate that an action can be executed safely
   * @param {Object} action - Action to validate
   * @param {Object} gameState - Current game state
   * @returns {Object} { valid: boolean, error: string }
   */
  function validateAction(action, gameState) {
    if (!action || action.action === 'pause') {
      return { valid: false, error: 'Action paused' };
    }

    // Check if it's still our turn
    if (!gameState.isMyTurn) {
      return { valid: false, error: 'Not our turn anymore' };
    }

    // Validate raise amount
    if (action.action === 'raise') {
      if (!action.amount || action.amount <= 0) {
        return { valid: false, error: 'Invalid raise amount' };
      }
      if (action.amount > gameState.stack) {
        return { valid: false, error: 'Raise amount exceeds stack' };
      }
    }

    return { valid: true, error: null };
  }

  // Export functions to global scope
  window.AutoPlayEngine = {
    detectScenario,
    normalizePosition,
    calculateRaiseSize,
    getActionFromRange,
    getStackAdjustment,
    getTableType,
    shouldTightenForMultiway,
    shouldWidenForShorthanded,
    checkSafetyPause,
    getAutoAction,
    validateAction
  };

  console.log('[AutoPlayEngine] Module loaded');
})();
