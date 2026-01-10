// Popup script for PokerNow Extension

document.addEventListener('DOMContentLoaded', () => {
  const enableToggle = document.getElementById('enableToggle');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  const aiProvider = document.getElementById('aiProvider');
  const aiModeRow = document.getElementById('aiModeRow');
  const aiMode = document.getElementById('aiMode');
  const displayMode = document.getElementById('displayMode');
  const soundFile = document.getElementById('soundFile');
  const fileBtn = document.getElementById('fileBtn');
  const currentSound = document.getElementById('currentSound');
  const soundName = document.getElementById('soundName');
  const playBtn = document.getElementById('playBtn');
  const clearBtn = document.getElementById('clearBtn');
  const status = document.getElementById('status');

  let currentAudio = null;

  // Track popup open
  if (window.analytics) {
    window.analytics.trackPopupOpen();
  }

  // Update AI mode row visibility (always visible now)
  function updateAiModeVisibility() {
    aiModeRow.style.display = 'flex';
  }

  // Load saved settings
  chrome.storage.local.get(['customSound', 'soundFileName', 'enabled', 'volume', 'aiProvider', 'aiMode', 'displayMode'], (result) => {
    enableToggle.checked = result.enabled !== false;
    const volume = result.volume !== undefined ? result.volume : 100;
    volumeSlider.value = volume;
    volumeValue.textContent = volume + '%';
    aiProvider.value = result.aiProvider || 'gemini';
    aiMode.value = result.aiMode || 'auto';
    displayMode.value = result.displayMode || 'bb';
    updateAiModeVisibility();

    if (result.customSound && result.soundFileName) {
      showCurrentSound(result.soundFileName);
    }
  });

  // Enable/Disable toggle
  enableToggle.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: enableToggle.checked }, () => {
      showStatus(enableToggle.checked ? 'Sound replacement enabled' : 'Sound replacement disabled', 'success');
      if (window.analytics) {
        window.analytics.trackSettingsChange('enabled', enableToggle.checked);
      }
    });
  });

  // Volume slider
  volumeSlider.addEventListener('input', () => {
    const volume = volumeSlider.value;
    volumeValue.textContent = volume + '%';

    // Update volume for currently playing preview if any
    if (currentAudio) {
      currentAudio.volume = volume / 100;
    }
  });

  volumeSlider.addEventListener('change', () => {
    const volume = parseInt(volumeSlider.value);
    chrome.storage.local.set({ volume: volume }, () => {
      showStatus(`Volume set to ${volume}%`, 'success');
      if (window.analytics) {
        window.analytics.trackSettingsChange('volume', volume);
      }
    });
  });

  // AI Provider dropdown
  aiProvider.addEventListener('change', () => {
    chrome.storage.local.set({ aiProvider: aiProvider.value }, () => {
      const messages = {
        'gemini': 'Using Gemini AI',
        'claude': 'Using Claude AI',
        'chatgpt': 'Using ChatGPT'
      };
      showStatus(messages[aiProvider.value], 'success');
      updateAiModeVisibility();
      if (window.analytics) {
        window.analytics.trackSettingsChange('ai_provider', aiProvider.value);
      }
    });
  });

  // AI Mode dropdown
  aiMode.addEventListener('change', () => {
    chrome.storage.local.set({ aiMode: aiMode.value }, () => {
      const messages = {
        'auto': 'AI will analyze automatically on your turn',
        'manual': 'Click "Ask AI" in side panel for analysis'
      };
      showStatus(messages[aiMode.value], 'success');
      if (window.analytics) {
        window.analytics.trackSettingsChange('ai_mode', aiMode.value);
      }
    });
  });

  // Display Mode dropdown
  displayMode.addEventListener('change', () => {
    chrome.storage.local.set({ displayMode: displayMode.value }, () => {
      const messages = {
        'bb': 'Showing bet values in BB',
        'chips': 'Showing bet values in chips'
      };
      showStatus(messages[displayMode.value], 'success');
      if (window.analytics) {
        window.analytics.trackSettingsChange('display_mode', displayMode.value);
      }
    });
  });

  // File selection
  soundFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('audio/')) {
      showStatus('Please select a valid audio file', 'error');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showStatus('File too large. Max size: 5MB', 'error');
      return;
    }

    // Read file as data URL
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      
      // Save to storage
      chrome.storage.local.set({
        customSound: dataUrl,
        soundFileName: file.name
      }, () => {
        showCurrentSound(file.name);
        showStatus('Sound uploaded successfully!', 'success');
        if (window.analytics) {
          window.analytics.trackSoundUpload();
        }
      });
    };
    reader.onerror = () => {
      showStatus('Error reading file', 'error');
    };
    reader.readAsDataURL(file);
  });

  // Preview sound
  playBtn.addEventListener('click', () => {
    chrome.storage.local.get(['customSound', 'volume'], (result) => {
      if (result.customSound) {
        // Stop any currently playing audio
        if (currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }

        currentAudio = new Audio(result.customSound);
        currentAudio.volume = (result.volume !== undefined ? result.volume : 100) / 100;
        currentAudio.play().catch(err => {
          showStatus('Error playing sound', 'error');
          console.error(err);
        });
      }
    });
  });

  // Clear sound
  clearBtn.addEventListener('click', () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    
    chrome.storage.local.remove(['customSound', 'soundFileName'], () => {
      hideCurrentSound();
      showStatus('Sound removed', 'success');
      if (window.analytics) {
        window.analytics.trackSoundRemoved();
      }
    });
  });

  function showCurrentSound(fileName) {
    soundName.textContent = fileName;
    currentSound.style.display = 'block';
    fileBtn.classList.add('has-file');
    fileBtn.textContent = '📁 Click to change audio file';
  }

  function hideCurrentSound() {
    currentSound.style.display = 'none';
    fileBtn.classList.remove('has-file');
    fileBtn.textContent = '📁 Click to select audio file (.mp3, .wav, .ogg)';
  }

  function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;
    
    setTimeout(() => {
      status.className = 'status';
    }, 3000);
  }
});
