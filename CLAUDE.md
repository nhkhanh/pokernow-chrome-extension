# PokerNow Chrome Extension

## Project Overview
Chrome extension for PokerNow.club that provides:
1. **Custom sound replacement** - Replace the default "your turn" notification sound with a custom audio file
2. **Last action highlight** - Visual highlight (pulsing golden glow) on the player who made the last action

## Tech Stack
- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks)
- Content script + page script injection pattern

## File Structure
```
/extension/           - Chrome extension files (for publishing)
  manifest.json       - Extension configuration
  content.js          - Content script that bridges extension storage to page context
  inject.js           - Main script injected into PokerNow pages (contains all game logic)
  popup.html/popup.js - Extension popup UI for settings
  background.js       - Service worker for extension
  sidepanel.*         - Side panel UI
  *-content.js        - AI assistant integration scripts
  analytics.js        - Google Analytics integration
  *.mp3               - Default notification sounds
  icon*.png           - Extension icons
/assets/              - Chrome Web Store listing assets
README.md             - Project documentation
LICENSE               - MIT license
PRIVACY_POLICY.md     - Privacy policy
STORE_LISTING.md      - Chrome Web Store listing info
```

## Sample HTML Files
The `/samples/` folder contains saved HTML from PokerNow pages for testing DOM parsing:
- `your-turn-with-call-raise-fold.html` - Player's turn with call/raise/fold options
- Use these to understand PokerNow DOM structure and test selectors

## Key Architecture

### extension/inject.js
- `getTableStatus()` - Parses PokerNow DOM to extract game state (players, actions, pot, cards)
- `highlightLastAction()` - Detects and highlights the player who just acted
- `setupTurnDetection()` - MutationObserver watching for class changes on `.table-player` elements
- Audio interception via `AudioContext.createBufferSource` and `HTMLAudioElement.prototype.play`

### PokerNow DOM Selectors
- `.table-player` - Player container
- `.table-player-{N}` - Player by seat number
- `.you-player` - Current user
- `.decision-current` - Player whose turn it is
- `.fold` - Folded player
- `.table-player-bet-value` - Bet amount display
- `.table-player-status-icon` - Shows "Fold", "Check", etc.

## Development Notes
- Extension uses CustomEvent messages between content script and injected script
- Settings stored via `chrome.storage.local`
- Console logs prefixed with `[SoundReplacer]` for debugging

## Git
- Remote: https://nhkhanh@github.com/nhkhanh/pokernow-chrome-extension.git
- Do not include Claude Code attribution in commits
- Do not git commit until user explicitly says so
