// Popup script for PokerNow Sound Replacer

document.addEventListener('DOMContentLoaded', () => {
  const enableToggle = document.getElementById('enableToggle');
  const soundFile = document.getElementById('soundFile');
  const fileBtn = document.getElementById('fileBtn');
  const currentSound = document.getElementById('currentSound');
  const soundName = document.getElementById('soundName');
  const playBtn = document.getElementById('playBtn');
  const clearBtn = document.getElementById('clearBtn');
  const status = document.getElementById('status');

  let currentAudio = null;

  // Load saved settings
  chrome.storage.local.get(['customSound', 'soundFileName', 'enabled'], (result) => {
    enableToggle.checked = result.enabled !== false;
    
    if (result.customSound && result.soundFileName) {
      showCurrentSound(result.soundFileName);
    }
  });

  // Enable/Disable toggle
  enableToggle.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: enableToggle.checked }, () => {
      showStatus(enableToggle.checked ? 'Sound replacement enabled' : 'Sound replacement disabled', 'success');
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
      });
    };
    reader.onerror = () => {
      showStatus('Error reading file', 'error');
    };
    reader.readAsDataURL(file);
  });

  // Preview sound
  playBtn.addEventListener('click', () => {
    chrome.storage.local.get(['customSound'], (result) => {
      if (result.customSound) {
        // Stop any currently playing audio
        if (currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }
        
        currentAudio = new Audio(result.customSound);
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
