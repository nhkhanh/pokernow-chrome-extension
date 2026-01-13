# Autoplay Strategy Guide

This document explains how the preflop autoplay feature works and the factors it considers when making decisions.

## Overview

The autoplay engine makes preflop decisions based on:
- **Hand strength** - Your hole cards
- **Position** - Where you sit relative to the dealer
- **Scenario** - What action you're facing
- **Stack size** - Your chip stack in big blinds
- **Active players** - Number of players still in the hand
- **SPR** - Stack-to-Pot Ratio

## Decision Factors

### 1. Hand Evaluation

Your hole cards are converted to standard poker notation:
- `AKs` - Ace-King suited
- `AKo` - Ace-King offsuit
- `QQ` - Pocket Queens
- `JTs` - Jack-Ten suited

### 2. Position

Positions are normalized to 6 categories:
| Position | Description |
|----------|-------------|
| UTG | Under the Gun (first to act) |
| MP | Middle Position |
| CO | Cutoff (one before button) |
| BTN | Button (dealer) |
| SB | Small Blind |
| BB | Big Blind |

### 3. Scenarios

The engine detects what action you're facing:

| Scenario | Description |
|----------|-------------|
| `unopened` | No one has raised, pot is unopened |
| `facing-limp` | One or more players limped (called BB). When isolation raising, the extension automatically clicks the "Pot" button for optimal sizing. |
| `facing-raise` | Someone raised, you're deciding to call/3-bet/fold |
| `facing-3bet` | There was a re-raise and re-re-raise |

### 4. Stack Size (BB)

Your stack in big blinds affects decisions:
- **Short stack (<20 BB)**: Play tighter, push/fold mode
- **Normal (20-100 BB)**: Standard ranges apply
- **Deep stack (>100 BB)**: Can widen ranges slightly

### 5. Active Players (Gradient Approach)

The number of players determines the table type and range adjustments:

| Table Type | Players | Behavior |
|------------|---------|----------|
| **Heads-up** | 2 | Widest ranges - auto-play calls with playable hands |
| **Shorthanded** | 3 | Wide ranges - auto-play calls with playable hands |
| **Full Ring** | 4-6 | Standard - use configured ranges |
| **Multiway** | 7+ | Tightest - pause for marginal calls |

**Gradient Adjustments**:
- **Heads-up (2p)**: Widest range - calls with `HEADSUP_CALL_RANGE`
- **Shorthanded (3p)**: Wide range - calls with `SHORTHANDED_CALL_RANGE`
- **Multiway (7+p)**: Marginal calls pause for manual decision

**Configurable Ranges** (in [autoplay-engine.js](../extension/autoplay-engine.js#L16-L22)):
```javascript
// 3-handed range
SHORTHANDED_CALL_RANGE = '22+,A2s+,K2s+,Q2s+,J5s+,T6s+,96s+,86s+,75s+,65s,54s,A2o+,K5o+,Q7o+,J8o+,T8o+,98o'

// Heads-up range (even wider)
HEADSUP_CALL_RANGE = '22+,A2s+,K2s+,Q2s+,J4s+,T5s+,95s+,85s+,74s+,64s+,54s,A2o+,K4o+,Q6o+,J7o+,T8o+,97o+'
```

### 6. SPR (Stack-to-Pot Ratio)

SPR = Your Stack / Current Pot

| SPR | Implication |
|-----|-------------|
| < 3 | Pot committed - pause for manual decision |
| 3-10 | Medium SPR - standard play |
| > 10 | Deep SPR - more post-flop flexibility |

**Low SPR (<3)**: The engine pauses because you're essentially committed to the pot.

## Safety Pauses

The autoplay will pause and let you decide manually in these situations:

1. **Facing all-in** - Too important for auto-decision
2. **Low SPR (<3)** - Pot committed situation
3. **Short stack (<10 BB)** - Push/fold mode requires human judgment
4. **Large bet (>50% stack)** - Significant decision
5. **Multiway pot (4+ players)** - Marginal calls need human evaluation

## Action Priority

When evaluating your hand against configured ranges:

1. `4bet` - Four-bet (if facing 3-bet)
2. `3bet` - Three-bet (if facing raise)
3. `raise` - Open raise
4. `call` - Call the bet
5. `check` - Check (free option)
6. `fold` - Fold

**Important**: The engine will never fold when checking is free (toCall = 0).

## Range Configuration

Ranges are configured per position and scenario in the settings. Example structure:

```
Position: BTN (Button)
├── unopened
│   ├── raise: "22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 97s+, A9o+, KTo+, QTo+, JTo"
│   └── fold: everything else
├── facing-limp
│   ├── raise: "77+, A9s+, KTs+, QTs+, AJo+, KQo"
│   ├── call: "22-66, suited connectors"
│   └── fold: everything else
└── facing-raise
    ├── 3bet: "QQ+, AKs"
    ├── call: "99-JJ, AQs, AKo, KQs"
    └── fold: everything else
```

## Console Logging

When autoplay runs, it logs decisions to the console:

```
[AutoPlay] Hand: AKs, Position: BTN, Scenario: unopened, Stack: 85.0BB, Table: shorthanded (3p), SPR: 15.2
[AutoPlay] Decision: {action: "raise", amount: 250, reasoning: "AKs in BTN unopened: raise"}
```

Table types in logs: `headsup`, `shorthanded`, `fullring`, `multiway`

## Presets

Available strategy presets:

| Preset | Style | Description |
|--------|-------|-------------|
| Tight | Conservative | Only premium hands, rarely bluff |
| TAG | Tight-Aggressive | Solid starting hands, aggressive when playing |
| LAG | Loose-Aggressive | Wide range, lots of aggression |
| Loose | Speculative | Many hands, relies on post-flop skill |

## Execution

The following actions are auto-executed:
- **Fold** - Automatically executed
- **Check** - Automatically executed
- **Call** - Automatically executed
- **Raise** - Automatically executed, including:
  - **Isolation raises vs limps**: Clicks the "Pot" button for optimal sizing
  - **Other raises**: Uses calculated raise amount based on settings

This allows for full automation of preflop decisions when autoplay is enabled.

## Keyboard Shortcuts

- Auto-play can be cancelled by any user action
- The extension sends events that can be intercepted to cancel pending actions

## Tips for Configuration

1. **Start tight** - Use a tight preset and loosen gradually
2. **Position matters** - Play more hands in late position (BTN, CO)
3. **Adjust for opponents** - Tighten against tight players, exploit loose ones
4. **Review decisions** - Check console logs to see why actions were taken
5. **Override when needed** - The engine pauses in marginal spots for a reason
