# Chrome Web Store Listing Documentation

## Store Listing Tab

### Name
```
PokerNow Extension
```

### Short Description (132 chars max)
```
Enhance your PokerNow experience with custom turn sounds, AI assistant integration, and real-time hand tracking.
```

### Full Description
```
🎰 PokerNow Extension - Level Up Your Online Poker Game

Enhance your PokerNow.club experience with powerful features designed for serious players.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔔 CUSTOM TURN SOUNDS
Never miss your turn again! Replace the default notification with your own custom audio file. Upload any MP3, WAV, or OGG file to personalize your alerts.

🤖 AI ASSISTANT INTEGRATION
Get real-time poker analysis with your favorite AI:
  • Google Gemini
  • Claude (Anthropic)
  • ChatGPT (OpenAI)

Two modes available:
  ▸ Automatic Mode - AI automatically analyzes the hand when it's your turn
  ▸ Manual Mode - Use the ⭐ Ask AI button on the table for on-demand analysis

The AI provides a GTO mixed strategy table with recommended actions, expected values, and frequencies.

💰 FLEXIBLE BET DISPLAY
View bets in the format that works best for you:
  • Big Blinds (BB) - Perfect for tournament and cash game strategy
  • Chips - Traditional chip count display

📋 REAL-TIME HAND TRACKING
Side panel displays live game logs including:
  • Player actions with timing
  • Hand history
  • Board cards as they're dealt

✨ LAST ACTION HIGHLIGHT
Visual highlights show who just acted with color-coded actions:
  ⬤ Gray for Check
  🔴 Red for Fold
  🔵 Blue for Call
  🟢 Green for Raise/Bet

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Easy to use - Just install and play
✓ Customizable settings via popup
✓ Works with all PokerNow game types
✓ Lightweight and fast

📬 Feedback: https://forms.gle/8fiu7vaZzZLoWzJEA

⚠️ Note: This extension only works on pokernow.com. AI features require you to have an active session with your chosen AI provider.
```

### Category
```
Games
```

### Language
```
English
```

---

## Privacy Practices Tab

### Single Purpose Description
```
Enhance PokerNow.club gameplay with custom turn notifications, AI poker assistant integration, and real-time hand tracking.
```

### Permission Justifications

#### Host Permissions
```
pokernow.com: Required to inject scripts that detect game events, replace turn notification sounds, and display hand tracking information.

gemini.google.com, claude.ai, chatgpt.com: Required to send game state information to AI assistants when the user enables AI integration for poker advice.

google-analytics.com: Required for anonymous usage analytics to improve the extension.
```

#### Remote Code
```
This extension does not use remote code. All JavaScript is bundled within the extension package.
```

#### scripting
```
Required to inject content scripts into PokerNow.club pages to intercept game events, replace audio notifications, and track hand history.
```

#### sidePanel
```
Displays real-time hand history and game logs in a side panel, allowing users to review actions without leaving the poker table.
```

#### storage
```
Stores user preferences including custom notification sound files, AI assistant selection, and display mode settings (BB vs chips).
```

#### tabs
```
Required to detect when the user opens PokerNow.club or AI assistant tabs, enabling communication between the poker game and AI services.
```

#### webNavigation
```
Monitors page navigation on PokerNow.club to properly initialize the extension when users join or switch poker tables.
```

### Data Usage Certification

Check the certification box confirming compliance with Developer Program Policies.

If using Google Analytics:
- Does your extension collect user data? **Yes**
- Data types: User activity (anonymous usage analytics)
- Purpose: Analytics to improve the extension
- Requires: Privacy policy URL

If NOT using analytics:
- Does your extension collect user data? **No**

---

## Assets Required

### Screenshots (at least 1 required)
- Size: 1280x800 or 640x400 pixels
- Suggested screenshots:
  1. Popup settings panel
  2. PokerNow table with extension active
  3. Side panel showing hand history
  4. AI assistant integration in action

### Icons (included in package)
- 16x16: icon16.png
- 48x48: icon48.png
- 128x128: icon128.png

### Promotional Tile (optional but recommended)
- Small: 440x280 pixels

---

## Build Commands

### Create ZIP for upload
```powershell
cd d:/khanh/pokernow-chrome-extension
.\build.ps1
```

Output: `dist/pokernow-extension-v{version}.zip`

---

## Version History

### v1.1.0
- Color-coded action highlights (check=gray, fold=red, call=blue, raise/bet=green)
- Color-coded actions in side panel log
- Ask AI button for quick access
- Feedback form link in popup
- GTO mixed strategy table format for AI responses
- Fix "Extension context invalidated" error
- Semver versioning

### v1.0.0 (Initial Release)
- Custom turn sound replacement
- AI assistant integration (Gemini, Claude, ChatGPT)
- Bet display in BB or chips
- Real-time hand tracking side panel
- Last action highlight with golden glow
