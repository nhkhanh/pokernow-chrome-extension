// Auto-Play Decision Engine for Preflop Auto-Play
// Determines appropriate action based on game state and configured ranges

(function() {
  'use strict';

  /**
   * Detect the current scenario based on opponent actions
   * @param {Object} gameState - Current game state
   * @returns {string} Scenario type: "unopened", "facing-limp", "facing-raise", "facing-3bet"
   */
  function detectScenario(gameState) {
    const { players, myPosition } = gameState;

    // Get actions from players who acted before us
    const previousActions = [];
    let foundMe = false;

    for (const player of players) {
      if (player.isYou) {
        foundMe = true;
        break;
      }

      if (!player.isFold && !player.isOffline && player.action) {
        // Skip blinds unless they raised
        if (player.action === 'SB' || player.action === 'BB') {
          continue;
        }
        previousActions.push(player.action.toLowerCase());
      }
    }

    // Count raises/bets
    const raiseCount = previousActions.filter(a =>
      a.includes('raise') || a.includes('bet') || a.includes('all-in')
    ).length;

    const limpCount = previousActions.filter(a =>
      a.includes('call') || a.includes('limp')
    ).length;

    // Determine scenario
    if (raiseCount >= 2) return 'facing-3bet';
    if (raiseCount === 1) return 'facing-raise';
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
    if (pos.includes('UTG') || pos === 'EP' || pos === 'EARLY') return 'UTG';
    if (pos.includes('MP') || pos === 'MIDDLE') return 'MP';
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
   * Check if action should be paused for safety
   * @param {Object} gameState - Current game state
   * @returns {Object} { shouldPause: boolean, reason: string }
   */
  function checkSafetyPause(gameState) {
    const { stackBB, toCall, stack, isAllIn } = gameState;

    // Don't auto-play if facing an all-in
    if (isAllIn) {
      return { shouldPause: true, reason: 'Facing all-in' };
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

    const { cards, position, stackBB, pot, toCall, bigBlind, currentBet } = gameState;

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

    console.log(`[AutoPlay] Hand: ${hand}, Position: ${normalizedPosition}, Scenario: ${scenario}, Stack: ${stackBB.toFixed(1)}BB`);

    // Get range configuration for this position and scenario
    const ranges = settings.ranges || {};
    console.log('[AutoPlay] Available ranges:', Object.keys(ranges));

    const positionRanges = ranges[normalizedPosition];

    if (!positionRanges) {
      console.log(`[AutoPlay] No ranges configured for position ${normalizedPosition}. Available: ${Object.keys(ranges).join(', ') || 'none'}`);
      return null;
    }

    console.log(`[AutoPlay] ${normalizedPosition} scenarios:`, Object.keys(positionRanges));

    const scenarioRange = positionRanges[scenario];
    if (!scenarioRange) {
      console.log(`[AutoPlay] No range configured for scenario ${scenario}. Available: ${Object.keys(positionRanges).join(', ') || 'none'}`);
      return null;
    }

    console.log(`[AutoPlay] ${scenario} actions:`, Object.keys(scenarioRange));

    // Get action from range
    let action = getActionFromRange(hand, scenarioRange);

    if (!action || action === 'fold') {
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
    checkSafetyPause,
    getAutoAction,
    validateAction
  };

  console.log('[AutoPlayEngine] Module loaded');
})();
