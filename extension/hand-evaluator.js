// Hand Evaluator Module for Preflop Auto-Play
// Evaluates hole cards and matches them against configured ranges

(function() {
  'use strict';

  // Card ranks in order (deuce to ace)
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

  /**
   * Parse a single card string (e.g., "Ah", "Kc", "2d")
   * @param {string} cardStr - Card string
   * @returns {{rank: string, suit: string}} Parsed card
   */
  function parseCard(cardStr) {
    if (!cardStr || cardStr.length < 2) return null;
    const rank = cardStr[0].toUpperCase();
    const suit = cardStr[1].toLowerCase();
    return { rank, suit };
  }

  /**
   * Convert two cards to hand notation (e.g., "Ah Kh" -> "AKs", "Ah Kc" -> "AKo")
   * @param {string} card1 - First card (e.g., "Ah")
   * @param {string} card2 - Second card (e.g., "Kh")
   * @returns {string} Hand notation (e.g., "AKs", "AKo", "AA")
   */
  function cardsToHandNotation(card1, card2) {
    const c1 = parseCard(card1);
    const c2 = parseCard(card2);

    if (!c1 || !c2) return null;

    const rank1 = c1.rank;
    const rank2 = c2.rank;
    const value1 = RANK_VALUES[rank1];
    const value2 = RANK_VALUES[rank2];

    // Pocket pair
    if (rank1 === rank2) {
      return rank1 + rank1;
    }

    // Order by rank (higher first)
    const highRank = value1 > value2 ? rank1 : rank2;
    const lowRank = value1 > value2 ? rank2 : rank1;

    // Check if suited
    const suited = c1.suit === c2.suit;
    const suffix = suited ? 's' : 'o';

    return highRank + lowRank + suffix;
  }

  /**
   * Parse a range string into individual hand specifications
   * Examples: "AA", "QQ+", "AKs", "JTs-87s", "A*s"
   * @param {string} rangeStr - Range string (e.g., "QQ+,AKs,AKo")
   * @returns {Array<string>} Array of hand specifications
   */
  function parseRangeString(rangeStr) {
    if (!rangeStr || rangeStr.trim() === '') return [];

    // Split by comma and clean up
    return rangeStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }

  /**
   * Expand a hand specification to all matching hands
   * @param {string} spec - Hand spec (e.g., "QQ+", "AKs", "JTs-87s")
   * @returns {Set<string>} Set of all hands matching the spec
   */
  function expandHandSpec(spec) {
    const hands = new Set();

    // Wildcard: matches all hands
    if (spec === '*') {
      // Generate all possible hands
      for (let i = RANKS.length - 1; i >= 0; i--) {
        for (let j = i; j >= 0; j--) {
          if (i === j) {
            hands.add(RANKS[i] + RANKS[i]);
          } else {
            hands.add(RANKS[i] + RANKS[j] + 's');
            hands.add(RANKS[i] + RANKS[j] + 'o');
          }
        }
      }
      return hands;
    }

    // Range with dash (e.g., "JTs-87s", "QQ-99")
    if (spec.includes('-')) {
      const [start, end] = spec.split('-');
      const startRank1 = start[0];
      const startRank2 = start[1];
      const endRank1 = end[0];
      const endRank2 = end[1];
      const suited = start.endsWith('s');
      const offsuit = start.endsWith('o');
      const suffix = suited ? 's' : (offsuit ? 'o' : '');

      // Pocket pairs (e.g., "QQ-99")
      if (startRank1 === startRank2 && endRank1 === endRank2) {
        const startValue = RANK_VALUES[startRank1];
        const endValue = RANK_VALUES[endRank1];
        const high = Math.max(startValue, endValue);
        const low = Math.min(startValue, endValue);

        for (let v = high; v >= low; v--) {
          const rank = Object.keys(RANK_VALUES).find(k => RANK_VALUES[k] === v);
          hands.add(rank + rank);
        }
      } else {
        // Non-pairs (e.g., "JTs-87s")
        const startValue1 = RANK_VALUES[startRank1];
        const startValue2 = RANK_VALUES[startRank2];
        const endValue1 = RANK_VALUES[endRank1];
        const endValue2 = RANK_VALUES[endRank2];

        const gap = startValue1 - startValue2;

        for (let v1 = startValue1; v1 >= endValue1; v1--) {
          const v2 = v1 - gap;
          if (v2 >= 2 && v2 <= 14) {
            const rank1 = Object.keys(RANK_VALUES).find(k => RANK_VALUES[k] === v1);
            const rank2 = Object.keys(RANK_VALUES).find(k => RANK_VALUES[k] === v2);
            if (suited) {
              hands.add(rank1 + rank2 + 's');
            } else if (offsuit) {
              hands.add(rank1 + rank2 + 'o');
            } else {
              hands.add(rank1 + rank2 + 's');
              hands.add(rank1 + rank2 + 'o');
            }
          }
        }
      }
      return hands;
    }

    // Plus notation (e.g., "QQ+", "ATs+")
    if (spec.endsWith('+')) {
      const baseSpec = spec.slice(0, -1);
      const rank1 = baseSpec[0];
      const rank2 = baseSpec[1];
      const suited = baseSpec.endsWith('s');
      const offsuit = baseSpec.endsWith('o');

      // Pocket pairs (e.g., "QQ+")
      if (rank1 === rank2) {
        const startValue = RANK_VALUES[rank1];
        for (let v = startValue; v <= 14; v++) {
          const rank = Object.keys(RANK_VALUES).find(k => RANK_VALUES[k] === v);
          hands.add(rank + rank);
        }
      } else {
        // Non-pairs (e.g., "ATs+", "KQo+")
        const value1 = RANK_VALUES[rank1];
        const startValue2 = RANK_VALUES[suited || offsuit ? rank2 : baseSpec[1]];

        for (let v2 = startValue2; v2 <= value1 - 1; v2++) {
          const rank2Val = Object.keys(RANK_VALUES).find(k => RANK_VALUES[k] === v2);
          if (suited) {
            hands.add(rank1 + rank2Val + 's');
          } else if (offsuit) {
            hands.add(rank1 + rank2Val + 'o');
          } else {
            hands.add(rank1 + rank2Val + 's');
            hands.add(rank1 + rank2Val + 'o');
          }
        }
      }
      return hands;
    }

    // Wildcard with rank (e.g., "A*s", "K*o")
    if (spec.includes('*')) {
      const rank1 = spec[0];
      const suited = spec.endsWith('s');
      const offsuit = spec.endsWith('o');
      const value1 = RANK_VALUES[rank1];

      for (let v2 = 2; v2 < value1; v2++) {
        const rank2 = Object.keys(RANK_VALUES).find(k => RANK_VALUES[k] === v2);
        if (suited) {
          hands.add(rank1 + rank2 + 's');
        } else if (offsuit) {
          hands.add(rank1 + rank2 + 'o');
        } else {
          hands.add(rank1 + rank2 + 's');
          hands.add(rank1 + rank2 + 'o');
        }
      }
      return hands;
    }

    // Specific hand (e.g., "AKs", "AKo", "AK", "AA")
    const rank1 = spec[0];
    const rank2 = spec[1];

    if (spec.length === 2) {
      // Pocket pair or both suited and offsuit
      if (rank1 === rank2) {
        hands.add(spec);
      } else {
        hands.add(spec + 's');
        hands.add(spec + 'o');
      }
    } else {
      // Specific with suitedness
      hands.add(spec);
    }

    return hands;
  }

  /**
   * Check if a hand matches a range
   * @param {string} hand - Hand notation (e.g., "AKs")
   * @param {string} rangeStr - Range string (e.g., "QQ+,AKs,AKo")
   * @returns {boolean} True if hand is in range
   */
  function matchesRange(hand, rangeStr) {
    if (!hand || !rangeStr) return false;

    const specs = parseRangeString(rangeStr);

    for (const spec of specs) {
      const expandedHands = expandHandSpec(spec);
      if (expandedHands.has(hand)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if cards match a range
   * @param {string} card1 - First card (e.g., "Ah")
   * @param {string} card2 - Second card (e.g., "Kh")
   * @param {string} rangeStr - Range string (e.g., "QQ+,AKs,AKo")
   * @returns {boolean} True if cards are in range
   */
  function cardsMatchRange(card1, card2, rangeStr) {
    const hand = cardsToHandNotation(card1, card2);
    if (!hand) return false;
    return matchesRange(hand, rangeStr);
  }

  /**
   * Get preset ranges
   * @param {string} preset - Preset name ("tight", "TAG", "LAG", "loose")
   * @param {string} position - Position ("UTG", "MP", "CO", "BTN", "SB", "BB")
   * @returns {Object} Range configuration
   */
  function getPresetRange(preset, position) {
    const presets = {
      tight: {
        UTG: {
          unopened: { raise: 'QQ+,AKs,AKo', call: 'JJ,AQs', fold: '*' },
          'facing-raise': { '3bet': 'KK+,AKs', call: 'QQ,JJ,AKo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'AKs', fold: '*' }
        },
        MP: {
          unopened: { raise: 'TT+,AQs+,AKo', call: '99,88,AJs,KQs', fold: '*' },
          'facing-raise': { '3bet': 'KK+,AKs', call: 'QQ,JJ,AQs,AKo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'AKs', fold: '*' }
        },
        CO: {
          unopened: { raise: '99+,AJs+,KQs,AQo+', call: '77,88,ATs,KJs', fold: '*' },
          'facing-raise': { '3bet': 'KK+,AKs,AKo', call: 'QQ,JJ,AQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'AKs,QQ', fold: '*' }
        },
        BTN: {
          unopened: { raise: '77+,A9s+,KTs+,QTs+,JTs,T9s,98s,AJo+,KQo', call: '22-66,A2s-A8s,K9s,Q9s', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ,TT,AQs,AJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'QQ,AKs', fold: '*' }
        },
        SB: {
          unopened: { raise: '77+,A9s+,KTs+,QTs+,AJo+,KQo', call: '22-66,A2s-A8s', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ,TT,AQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'QQ,AKs', fold: '*' }
        },
        BB: {
          unopened: { raise: '77+,A9s+,KTs+,QTs+,AJo+,KQo', call: '*', fold: '' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ-77,AJs+,KQs,AQo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'QQ,AKs', fold: '*' }
        }
      },
      TAG: {
        UTG: {
          unopened: { raise: 'TT+,AJs+,KQs,AQo+', call: '99,88,ATs', fold: '*' },
          'facing-raise': { '3bet': 'KK+,AKs', call: 'QQ,JJ,AKo,AQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'QQ,AKs', fold: '*' }
        },
        MP: {
          unopened: { raise: '88+,ATs+,KTs+,QJs,AJo+,KQo', call: '77,66,A9s,KJs', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ,TT,AQs,AJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ', fold: '*' }
        },
        CO: {
          unopened: { raise: '66+,A8s+,K9s+,Q9s+,J9s+,T9s,98s,ATo+,KJo+,QJo', call: '22-55,A2s-A7s', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo,JJ', call: 'TT,99,AQs,AJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ', fold: '*' }
        },
        BTN: {
          unopened: { raise: '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A8o+,KTo+,QTo+,JTo', call: '', fold: '' },
          'facing-raise': { '3bet': 'JJ+,AJs+,KQs,AQo+', call: 'TT-77,ATs,KJs,QJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' }
        },
        SB: {
          unopened: { raise: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,98s,87s,76s,A9o+,KTo+,QTo+,JTo', call: '', fold: '' },
          'facing-raise': { '3bet': 'JJ+,AJs+,KQs,AQo+', call: 'TT-66,ATs,KJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ', fold: '*' }
        },
        BB: {
          unopened: { raise: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,97s+,87s,76s,65s,A7o+,K9o+,Q9o+,J9o+,T9o', call: '*', fold: '' },
          'facing-raise': { '3bet': 'TT+,AJs+,KQs,AQo+', call: '22-99,A2s+,K9s+,Q9s+,J9s+,T9s,AJo,KQo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' }
        }
      },
      LAG: {
        UTG: {
          unopened: { raise: '88+,A9s+,KTs+,QTs+,JTs,AJo+,KQo', call: '77,66,A8s,KJs', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ-88,AQs,AJs,KQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,AKo', fold: '*' }
        },
        MP: {
          unopened: { raise: '66+,A7s+,K9s+,Q9s+,J9s+,T9s,98s,ATo+,KJo+,QJo', call: '22-55,A2s-A6s', fold: '*' },
          'facing-raise': { '3bet': 'JJ+,AKs,AKo', call: 'TT-77,AQs,AJs,KQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' }
        },
        CO: {
          unopened: { raise: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,87s,76s,A7o+,KTo+,QTo+,JTo', call: '', fold: '' },
          'facing-raise': { '3bet': 'TT+,AJs+,KQs,AQo+', call: '99-22,A8s+,KJs+,QJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,AKo,AQs', fold: '*' }
        },
        BTN: {
          unopened: { raise: '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,86s+,75s+,65s,54s,A2o+,K8o+,Q9o+,J9o+,T9o', call: '', fold: '' },
          'facing-raise': { '3bet': 'TT+,A9s+,KTs+,QJs,AJo+', call: '99-22,A2s-A8s,K9s,KJs,QTs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,TT,AKo,AQs', fold: '*' }
        },
        SB: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J5s+,T6s+,96s+,86s+,75s+,65s,54s,A2o+,K7o+,Q8o+,J9o+,T9o', call: '', fold: '' },
          'facing-raise': { '3bet': 'TT+,A9s+,KTs+,QJs,AJo+', call: '99-22,A2s-A8s,K8s+,Q9s+,J9s+', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,TT,AKo', fold: '*' }
        },
        BB: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J2s+,T4s+,95s+,85s+,75s+,64s+,54s,A2o+,K5o+,Q7o+,J8o+,T8o+,98o', call: '*', fold: '' },
          'facing-raise': { '3bet': '99+,A8s+,KTs+,QTs+,JTs,AJo+,KQo', call: '22-88,A2s-A7s,K5s+,Q8s+,J8s+,T8s+,98s,ATo,KJo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,TT,AKo,AQs', fold: '*' }
        }
      },
      loose: {
        UTG: {
          unopened: { raise: '66+,A8s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+,QJo', call: '22-55,A2s-A7s,KTs', fold: '*' },
          'facing-raise': { '3bet': 'JJ+,AKs,AKo', call: 'TT-66,AJs+,KQs,AQo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' }
        },
        MP: {
          unopened: { raise: '22+,A5s+,K8s+,Q8s+,J8s+,T8s+,98s,87s,A9o+,KTo+,QTo+,JTo', call: 'A2s-A4s', fold: '*' },
          'facing-raise': { '3bet': 'TT+,AJs+,KQs,AQo+', call: '99-22,A8s+,KJs+,QJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' }
        },
        CO: {
          unopened: { raise: '22+,A2s+,K4s+,Q6s+,J7s+,T7s+,97s+,87s,76s,65s,A5o+,K9o+,Q9o+,J9o+,T9o', call: '', fold: '' },
          'facing-raise': { '3bet': '99+,A9s+,KTs+,QJs,AJo+,KQo', call: '88-22,A2s-A8s,K9s,KJs,QTs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,TT,AKo,AQs', fold: '*' }
        },
        BTN: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J3s+,T5s+,95s+,85s+,75s+,64s+,54s,A2o+,K6o+,Q8o+,J8o+,T8o+,98o', call: '', fold: '' },
          'facing-raise': { '3bet': '88+,A7s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+', call: '77-22,A2s-A6s,K5s+,Q7s+,J7s+,T7s+,97s+,87s', fold: '*' },
          'facing-3bet': { '4bet': 'KK+,AKs', call: 'QQ,JJ,TT,AKo,AQs', fold: '*' }
        },
        SB: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J2s+,T3s+,94s+,84s+,74s+,64s+,53s+,A2o+,K4o+,Q6o+,J7o+,T8o+,98o', call: '', fold: '' },
          'facing-raise': { '3bet': '88+,A7s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+', call: '77-22,A2s-A6s,K4s+,Q6s+,J6s+,T6s+,96s+', fold: '*' },
          'facing-3bet': { '4bet': 'KK+,AKs', call: 'QQ,JJ,TT,AKo,AQs', fold: '*' }
        },
        BB: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,53s+,43s,A2o+,K2o+,Q4o+,J6o+,T7o+,97o+,87o', call: '*', fold: '' },
          'facing-raise': { '3bet': '77+,A5s+,K8s+,Q9s+,J9s+,T9s,A9o+,KTo+,QJo', call: '22-66,A2s-A4s,K2s-K7s,Q2s-Q8s,J5s+,T6s+,96s+,86s+,75s+,65s,A2o-A8o,K8o+,Q9o+,J9o+,T9o', fold: '*' },
          'facing-3bet': { '4bet': 'KK+,AKs', call: 'QQ,JJ,TT,99,AKo,AQs,AJs', fold: '*' }
        }
      }
    };

    const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
    const normalizedPosition = positions.includes(position) ? position : 'MP';

    return presets[preset]?.[normalizedPosition] || presets.TAG.MP;
  }

  // Export functions to global scope
  window.HandEvaluator = {
    parseCard,
    cardsToHandNotation,
    parseRangeString,
    expandHandSpec,
    matchesRange,
    cardsMatchRange,
    getPresetRange
  };

  console.log('[HandEvaluator] Module loaded');
})();
