# Preflop Auto-Play Feature - Implementation Plan

## Overview
This document outlines the implementation plan for adding preflop auto-play functionality to the PokerNow Chrome Extension. The feature will allow users to configure automated actions (fold, call, raise) based on their hole cards and position.

## Goals
1. Automate preflop decisions based on configurable hand ranges
2. Support position-aware strategy (UTG, MP, CO, BTN, SB, BB)
3. Provide intuitive UI for configuring ranges and actions
4. Ensure safety with user confirmation and override options
5. Integrate seamlessly with existing extension architecture

## Architecture Overview

### Current Extension Structure
- **inject.js** - Main game logic injected into PokerNow pages
  - Socket message parsing (`__pokerNowParseSocketMessage`)
  - Position detection (`getPositionName`)
  - Turn detection (`setupTurnDetection`)
  - Game state tracking (players, bets, cards, actions)
- **content.js** - Bridge between extension storage and page context
- **popup.html/js** - Settings UI
- **sidepanel.html/js** - Game log and AI assistant
- **chrome.storage.local** - Settings persistence

### New Components Needed

#### 1. Hand Evaluation Module
**Location**: `extension/hand-evaluator.js` (new file)

**Responsibilities**:
- Parse hole cards from game state
- Evaluate hand strength (pocket pairs, suited connectors, etc.)
- Match hands against configured ranges
- Support standard poker notation (AKs, QQ+, JTs-87s, etc.)

**Key Functions**:
```javascript
// Evaluate if hole cards match a range
function matchesRange(card1, card2, rangeString)

// Convert cards to hand notation (e.g., "Ah Kh" -> "AKs")
function cardsToHandNotation(card1, card2)

// Check if hand is in a preset range (e.g., "premium", "broadway", "suited-connectors")
function inPresetRange(hand, rangeName)
```

#### 2. Auto-Play Decision Engine
**Location**: `extension/autoplay-engine.js` (new file)

**Responsibilities**:
- Load configured ranges and actions from storage
- Determine appropriate action based on:
  - Hole cards
  - Position
  - Current bet size
  - Stack size (BB)
  - Opponents' actions
- Handle different scenarios (unopened pot, facing raise, facing 3-bet, etc.)

**Key Functions**:
```javascript
// Get action for current situation
function getAutoAction(gameState, settings)

// Validate action is safe to execute
function validateAction(action, gameState)

// Calculate raise size based on settings
function calculateRaiseSize(action, pot, currentBet, stack, settings)
```

#### 3. UI Components

##### Popup Enhancement
**Location**: `extension/popup.html` and `extension/popup.js` (modify)

Add new section:
- Toggle: "Enable Preflop Auto-Play"
- Button: "Configure Ranges" (opens settings page)
- Status: Show current auto-play mode (Off/Active/Paused)

##### Range Configuration Page
**Location**: `extension/autoplay-settings.html` (new file)

Features:
- Tab-based interface for each position (UTG, MP, CO, BTN, SB, BB)
- Visual hand grid (13x13) showing all possible starting hands
- Quick selection tools:
  - Preset ranges (Tight, TAG, LAG, Loose)
  - Hand categories (Premium, Broadway, Suited Connectors, Pocket Pairs)
  - Clear/Select All buttons
- Action assignment for each range:
  - Fold
  - Call/Limp
  - Raise (with size: 2BB, 2.5BB, 3BB, Pot, custom)
- Scenario-specific rules:
  - Unopened pot
  - Facing raise (fold, call, 3-bet)
  - Facing 3-bet (fold, call, 4-bet)
- Advanced options:
  - Stack size thresholds (act differently with short/deep stacks)
  - Opponent count adjustments
  - Confirmation mode (ask before acting)

##### Side Panel Integration
**Location**: `extension/sidepanel.html` (modify)

Add:
- Auto-play status indicator
- Current hand evaluation display (when auto-play is active)
- Planned action preview with countdown
- Override buttons (Skip Auto, Fold, Call, Raise)
- Action log (auto-play decisions history)

#### 4. Integration with inject.js

**Modifications to `extension/inject.js`**:

1. **Import new modules**:
```javascript
// Load hand evaluator and autoplay engine
// (These will be injected as separate scripts via content.js)
```

2. **Enhance turn detection** (line ~1729):
```javascript
if (isMyTurn && !wasMyTurn) {
  isMyTurnPending = true;

  // Check if auto-play is enabled and we're preflop
  if (autoPlayEnabled && status.isPreflop && socketMyId) {
    const myCards = getCurrentHoleCards();
    const myPosition = getCurrentPosition();

    // Get auto-action from engine
    const autoAction = getAutoAction({
      cards: myCards,
      position: myPosition,
      pot: status.pot,
      toCall: getCurrentBetToCall(),
      stack: getMyStack(),
      opponents: getActiveOpponents(),
      scenario: detectScenario(status) // unopened, facing-raise, facing-3bet
    }, autoPlaySettings);

    if (autoAction && autoAction.action !== 'none') {
      // Show preview in side panel
      dispatchAutoActionPreview(autoAction);

      // Wait for user confirmation or auto-execute after delay
      scheduleAutoAction(autoAction, autoPlaySettings.confirmationMode);
    }
  }

  sendToAI();
  // ... existing fallback sound code
}
```

3. **Add auto-action execution**:
```javascript
function scheduleAutoAction(action, needsConfirmation) {
  if (needsConfirmation) {
    // Show confirmation UI in side panel with 5-second countdown
    dispatchEvent(new CustomEvent('POKERNOW_AUTO_ACTION_CONFIRM', {
      detail: { action, countdown: 5000 }
    }));

    // User can override via side panel buttons
    autoActionTimer = setTimeout(() => {
      if (!autoActionCancelled) {
        executeAction(action);
      }
    }, 5000);
  } else {
    // Immediate execution (still with small delay for realism)
    autoActionTimer = setTimeout(() => {
      if (!autoActionCancelled) {
        executeAction(action);
      }
    }, 1000);
  }
}

function executeAction(action) {
  // Click the appropriate button in the PokerNow UI
  const buttonSelector = {
    'fold': '.decision-panel button[class*="fold"]',
    'call': '.decision-panel button[class*="call"]',
    'check': '.decision-panel button[class*="check"]',
    'raise': '.decision-panel button[class*="raise"]'
  }[action.type];

  const button = document.querySelector(buttonSelector);
  if (!button) {
    console.error('[AutoPlay] Action button not found:', action.type);
    return;
  }

  // For raise, need to set the amount first
  if (action.type === 'raise' && action.amount) {
    setRaiseAmount(action.amount);
  }

  // Click the button
  button.click();

  // Log the action
  console.log(`[AutoPlay] Executed: ${action.type}${action.amount ? ' ' + action.amount : ''}`);
  dispatchEvent(new CustomEvent('POKERNOW_AUTO_ACTION_EXECUTED', {
    detail: { action }
  }));
}

function setRaiseAmount(amount) {
  // Find and set the raise input field
  const raiseInput = document.querySelector('.decision-panel input[type="number"]');
  if (raiseInput) {
    raiseInput.value = amount;
    raiseInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function cancelAutoAction() {
  if (autoActionTimer) {
    clearTimeout(autoActionTimer);
    autoActionTimer = null;
  }
  autoActionCancelled = true;
  console.log('[AutoPlay] Action cancelled');
}
```

4. **Add helper functions**:
```javascript
function getCurrentHoleCards() {
  // Extract from socketPrevCards or DOM
  if (socketMyId && socketHandLog.length > 0) {
    // Parse from hand log: "Your cards: Ah Kc"
    const cardLine = socketHandLog.find(line => line.startsWith('Your cards:'));
    if (cardLine) {
      const cards = cardLine.replace('Your cards:', '').trim().split(' ');
      return cards;
    }
  }
  return null;
}

function getCurrentPosition() {
  // Use existing getPositionName function
  const status = getTableStatus();
  return status.players.find(p => p.isYou)?.position || '?';
}

function getCurrentBetToCall() {
  const status = getTableStatus();
  const myPlayer = status.players.find(p => p.isYou);
  const maxBet = Math.max(...status.players.map(p => p.betAmount));
  return myPlayer ? maxBet - myPlayer.betAmount : 0;
}

function getMyStack() {
  const status = getTableStatus();
  const myPlayer = status.players.find(p => p.isYou);
  return myPlayer ? parseFloat(myPlayer.stack) : 0;
}

function getActiveOpponents() {
  const status = getTableStatus();
  return status.players.filter(p => !p.isYou && !p.isFold && !p.isOffline);
}

function detectScenario(status) {
  // Determine if pot is unopened, facing raise, or facing 3-bet
  const actions = status.players
    .filter(p => !p.isYou && p.action && p.action !== 'SB' && p.action !== 'BB')
    .map(p => p.action);

  if (actions.length === 0) return 'unopened';

  const hasRaise = actions.some(a => a.includes('raise') || a.includes('bet'));
  const raiseCount = actions.filter(a => a.includes('raise') || a.includes('bet')).length;

  if (raiseCount >= 2) return 'facing-3bet';
  if (hasRaise) return 'facing-raise';
  if (actions.some(a => a.includes('call') || a.includes('limp'))) return 'facing-limp';

  return 'unopened';
}
```

## Data Storage Schema

### chrome.storage.local structure

```javascript
{
  // Existing settings
  "customSound": "data:audio/...",
  "soundFileName": "custom.mp3",
  "enabled": true,
  "aiProvider": "gemini",
  "aiMode": "auto",
  "displayMode": "bb",

  // New auto-play settings
  "autoPlayEnabled": false,
  "autoPlaySettings": {
    "confirmationMode": true, // Ask before acting
    "confirmationDelay": 5000, // ms
    "actingDelay": 1000, // Delay to appear human (500-2000ms random)

    // Position-based ranges
    "ranges": {
      "UTG": {
        "unopened": {
          "raise": "QQ+,AKs,AKo", // Hand notation
          "call": "JJ,TT,AQs",
          "fold": "*" // Everything else
        },
        "facing-raise": {
          "3bet": "KK+,AKs",
          "call": "QQ,JJ,AKs,AKo",
          "fold": "*"
        },
        "facing-3bet": {
          "4bet": "AA,KK",
          "call": "AKs",
          "fold": "*"
        }
      },
      "MP": { /* similar structure */ },
      "CO": { /* similar structure */ },
      "BTN": { /* similar structure */ },
      "SB": { /* similar structure */ },
      "BB": { /* similar structure */ }
    },

    // Raise sizing
    "raiseSizing": {
      "unopened": 2.5, // BB
      "facing-limp": 3, // BB + 1 per limper
      "3bet": 3, // x previous raise
      "4bet": 2.5 // x previous 3bet
    },

    // Stack size adjustments
    "stackThresholds": {
      "short": 20, // BB - tighten ranges
      "deep": 100 // BB - widen ranges
    },

    // Presets (for quick selection)
    "preset": "TAG" // "tight", "TAG", "LAG", "loose", "custom"
  }
}
```

## Hand Range Notation

Support standard poker notation:
- **Specific hands**: `AKs` (suited), `AKo` (offsuit), `AK` (both)
- **Pairs**: `AA`, `QQ+` (QQ or better), `77-22` (range)
- **Suited**: `AKs`, `KQs-KJs` (range), `ATs+` (AT suited or better)
- **Offsuit**: `AKo`, `KQo-KTo`
- **Suited connectors**: `JTs-87s`, `T9s+`
- **Gappers**: `J9s-97s` (1-gap), `J8s-96s` (2-gap)
- **Wildcards**: `A*s` (any ace suited), `*` (all hands)
- **Combinations**: `QQ+,AKs,AKo,KQs` (comma-separated)

## Preset Ranges

### Tight (UTG-focused)
- **Raise**: AA-TT, AKs, AKo, AQs
- **Call**: 99-77, AJs, KQs
- **Fold**: Rest

### TAG (Tight-Aggressive)
- **Raise**: AA-77, AK, AQ, AJs+, KQs, KQo
- **Call**: 66-22, ATs, KJs
- **Fold**: Rest

### LAG (Loose-Aggressive)
- **Raise**: AA-22, AK-AT, KQ-KT, QJ-QT, JTs-65s, suited connectors
- **Call**: Suited aces, suited kings
- **Fold**: Weak offsuit

### Loose (Wide range)
- **Raise**: Most playable hands
- **Call**: Speculative hands
- **Fold**: True trash (72o, 83o, etc.)

## Safety Features

1. **Confirmation Mode**: Always enabled by default
   - Shows countdown (5s default, configurable 3-10s)
   - User can cancel or override action
   - Auto-cancels if game state changes (someone else acts)

2. **Stack Safety**:
   - Disable auto-play if stack < 10BB (requires manual play)
   - Warn if stack > 200BB (deep stack play differs)

3. **Opponent Count**:
   - Adjust ranges based on number of opponents
   - Tighten with more opponents

4. **Pause/Override**:
   - Keyboard shortcut (Alt+P) to toggle auto-play
   - Side panel button to pause for current hand
   - Auto-pause on unusual situations (all-in, weird bet sizing)

5. **Action Validation**:
   - Verify button exists before clicking
   - Check if it's actually our turn
   - Validate bet amount is within min/max
   - Log all auto-actions for review

6. **Logging & Analytics**:
   - Track all auto-play decisions
   - Show statistics (hands played, actions taken, success rate)
   - Export hand history

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create hand-evaluator.js with hand notation parsing
- [ ] Create autoplay-engine.js with decision logic
- [ ] Add basic storage schema
- [ ] Modify inject.js to detect preflop and extract hole cards
- [ ] Add auto-action execution (button clicking)

### Phase 2: UI - Basic Settings (Week 1-2)
- [ ] Add toggle to popup.html for enabling auto-play
- [ ] Create simple range configuration page
- [ ] Add position tabs (UTG, MP, CO, BTN, SB, BB)
- [ ] Implement text-based range input (notation)
- [ ] Add preset range buttons (Tight, TAG, LAG, Loose)

### Phase 3: UI - Advanced Configuration (Week 2-3)
- [ ] Build visual hand grid (13x13 matrix)
- [ ] Add click-to-select/deselect hands
- [ ] Implement drag selection
- [ ] Add scenario tabs (unopened, facing-raise, facing-3bet)
- [ ] Create raise sizing controls
- [ ] Add stack threshold settings

### Phase 4: Safety & Confirmation (Week 3)
- [ ] Implement confirmation mode UI in side panel
- [ ] Add countdown timer display
- [ ] Create override buttons (Cancel, Fold, Call, Raise)
- [ ] Add keyboard shortcuts
- [ ] Implement auto-pause conditions
- [ ] Add action validation

### Phase 5: Testing & Refinement (Week 4)
- [ ] Test all hand range notations
- [ ] Verify position detection accuracy
- [ ] Test scenario detection (unopened, facing-raise, etc.)
- [ ] Validate button clicking across different UI states
- [ ] Test edge cases (disconnection, time bank, straddle, etc.)
- [ ] Performance testing (ensure no lag)

### Phase 6: Advanced Features (Week 5+)
- [ ] Add hand history export
- [ ] Create statistics dashboard
- [ ] Implement range visualization (heat maps)
- [ ] Add GTO-based preset ranges
- [ ] Support for advanced scenarios (4-bet, 5-bet, squeeze)
- [ ] Multi-table support consideration

## Technical Considerations

### DOM Selectors (PokerNow UI)
```javascript
// Decision buttons
'.decision-panel button[class*="fold"]'
'.decision-panel button[class*="call"]'
'.decision-panel button[class*="check"]'
'.decision-panel button[class*="raise"]'

// Raise input
'.decision-panel input[type="number"]'

// Bet slider (alternative raise input)
'.decision-panel input[type="range"]'

// Action confirmation button
'.decision-panel button[class*="confirm"]'
```

Note: These selectors may change with PokerNow updates. Need to add fallback detection and error handling.

### Performance
- Hand evaluation should be < 10ms
- Decision logic should be < 50ms
- Total delay from turn detection to action should be < confirmation delay
- No blocking operations during game play

### Browser Compatibility
- Chrome 90+ (Manifest V3 requirement)
- AudioContext and modern ES6+ features already in use
- No additional polyfills needed

### Security & Ethics
- Auto-play should be clearly disclosed to users
- Not intended for real-money games (educational/recreational only)
- Add disclaimer in settings page
- Consider adding rate limiting to prevent bot-like behavior
- Ensure compliance with PokerNow terms of service

## Testing Plan

### Unit Tests
- Hand notation parser (all formats)
- Range matching (edge cases)
- Position detection
- Scenario detection
- Raise size calculations

### Integration Tests
- Turn detection triggers auto-play
- Auto-action execution clicks correct button
- Confirmation mode works correctly
- Override buttons cancel scheduled action
- Settings persist across sessions

### Manual Testing Scenarios
1. **Unopened pot**:
   - Premium hand (AA) -> Should raise
   - Medium hand (AJs) -> Should raise/call based on position
   - Trash hand (72o) -> Should fold

2. **Facing raise**:
   - Premium hand (KK) -> Should 3-bet
   - Good hand (AQs) -> Should call/3-bet based on position
   - Marginal hand (88) -> Should call/fold based on position
   - Trash hand -> Should fold

3. **Facing 3-bet**:
   - AA/KK -> Should 4-bet/call
   - AK -> Should call
   - QQ/JJ -> Should call/fold based on position
   - Rest -> Should fold

4. **Edge cases**:
   - Multiple limpers
   - Short stack (< 20BB)
   - Deep stack (> 100BB)
   - Heads-up
   - All-in situation (should not auto-act)

### Regression Tests
- Ensure existing features still work:
  - Sound replacement
  - Last action highlight
  - AI assistant
  - Game logging

## User Documentation

### Help Section (to be added to sidepanel or settings)

#### Getting Started
1. Enable "Preflop Auto-Play" in extension popup
2. Click "Configure Ranges" to set your strategy
3. Choose a preset (Tight/TAG/LAG) or customize ranges
4. Save settings and return to game
5. Auto-play will activate on your preflop turns

#### Configuring Ranges
- **Position tabs**: Select different ranges for each position
- **Scenario tabs**: Configure unopened, facing-raise, facing-3bet
- **Hand grid**: Click hands to select/deselect
- **Notation input**: Use poker notation (e.g., `QQ+,AKs,AKo`)
- **Action buttons**: Assign Raise/Call/Fold to each range

#### During Play
- **Confirmation mode**: You'll see a countdown before auto-action
- **Override buttons**: Cancel or choose different action
- **Pause auto-play**: Click pause in side panel or press Alt+P
- **Manual override**: You can always act manually before timer expires

#### Safety Features
- Confirmation delay (default 5 seconds)
- Auto-pause on unusual situations
- Keyboard shortcuts for quick override
- Action logging for review

## Future Enhancements

### V2 Features
1. **Postflop auto-play** (continuation betting, check-raising)
2. **Opponent profiling** (adjust strategy based on opponent tendencies)
3. **ICM calculations** (for tournament play)
4. **Range vs. range equity** (using hand evaluators)
5. **Bankroll tracking**
6. **Session statistics** (VPIP, PFR, 3-bet %, etc.)
7. **Cloud sync** (sync settings across devices)
8. **Import/export ranges** (share with community)

### Advanced Strategy Features
1. **Polarized vs. merged ranges**
2. **Blocker considerations** (holding Ax reduces opponent AA combos)
3. **Dynamic adjustments** (based on table dynamics)
4. **Exploitative play** (deviate from GTO based on opponent reads)
5. **Multi-street planning** (preflop decision affects postflop plan)

## Risk Mitigation

### Technical Risks
1. **PokerNow UI changes**: Selectors break
   - Mitigation: Add multiple selector fallbacks, monitor for errors

2. **Performance issues**: Extension slows down game
   - Mitigation: Optimize algorithms, test on slower devices

3. **Race conditions**: Turn detection vs. UI updates
   - Mitigation: Add state validation before action execution

### User Experience Risks
1. **Accidental actions**: User didn't want to auto-play
   - Mitigation: Confirmation mode always on by default

2. **Incorrect decisions**: Range configuration mistakes
   - Mitigation: Provide tested presets, visual validation

3. **Over-reliance**: Users don't learn poker strategy
   - Mitigation: Show explanation of why action was taken

### Compliance Risks
1. **Terms of Service violation**: PokerNow may prohibit automation
   - Mitigation: Review ToS, add disclaimer, consider reaching out to PokerNow

2. **Unfair advantage**: Using against unknowing opponents
   - Mitigation: Clearly label as training/practice tool

## Success Metrics

### Adoption
- % of users who enable auto-play
- % who configure custom ranges vs. use presets
- Average session time with auto-play enabled

### Reliability
- Auto-play success rate (action executed vs. failed)
- User override rate (how often users cancel auto-action)
- Error rate (exceptions, crashes)

### Performance
- Decision latency (ms from turn to action)
- Memory usage increase
- CPU impact

## Conclusion

This implementation plan provides a comprehensive roadmap for adding preflop auto-play to the PokerNow Chrome Extension. The phased approach ensures:

1. **Core functionality first**: Get basic auto-play working
2. **User-friendly UI**: Make it easy to configure
3. **Safety built-in**: Confirmation and override options
4. **Scalable architecture**: Easy to extend to postflop later

Key success factors:
- Reliable turn detection and action execution
- Intuitive range configuration interface
- Safety features that prevent mistakes
- Performance that doesn't impact game play
- Clear documentation and user guidance

Estimated total implementation time: 4-5 weeks for full feature set, 1-2 weeks for MVP (basic auto-play with text-based range configuration and confirmation mode).
