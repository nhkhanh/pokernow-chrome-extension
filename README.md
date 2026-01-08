# PokerNow Extension

A Chrome extension that replaces the "your turn" notification sound on PokerNow.club with a custom sound of your choice.

## Installation

1. Download and unzip the extension files
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked**
5. Select the `pokernow-sound-replacer` folder

## Usage

1. Click the extension icon in your Chrome toolbar
2. Toggle **Enable Sound Replacement** on/off as needed
3. Click **Select audio file** to upload your custom sound (supports MP3, WAV, OGG)
4. Use **Preview** to test your sound
5. Use **Remove** to clear the custom sound

## How It Works

The extension intercepts audio playback on PokerNow.club and replaces turn notification sounds with your uploaded audio. It uses multiple methods to catch sounds:

- Intercepts `Audio` constructor calls
- Overrides `HTMLAudioElement.prototype.play`
- Monitors DOM for audio elements
- Watches for turn indicator class changes

## Supported Sound Formats

- MP3 (.mp3)
- WAV (.wav)
- OGG (.ogg)
- Any audio format supported by Chrome

**Max file size:** 5MB

## Troubleshooting

**Sound not replaced?**
- Make sure the extension is enabled
- Refresh the PokerNow page after installing
- Check the browser console for debug messages (F12 → Console)

**Can't hear preview?**
- Check your browser volume settings
- Try a different audio file format

## Privacy

- Your audio file is stored locally in Chrome's extension storage
- No data is sent to external servers
- The extension only runs on pokernow.com

## License

MIT License - feel free to modify and share!
