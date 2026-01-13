// Auto-Play Settings Page Script

document.addEventListener('DOMContentLoaded', () => {
  const presetBtns = document.querySelectorAll('.preset-btn');
  const confirmationMode = document.getElementById('confirmationMode');
  const confirmationDelay = document.getElementById('confirmationDelay');
  const confirmationDelayRow = document.getElementById('confirmationDelayRow');
  const actingDelay = document.getElementById('actingDelay');
  const unopenedSize = document.getElementById('unopenedSize');
  const limpSize = document.getElementById('limpSize');
  const threeBetSize = document.getElementById('threeBetSize');
  const fourBetSize = document.getElementById('fourBetSize');
  const shortStackThreshold = document.getElementById('shortStackThreshold');
  const deepStackThreshold = document.getElementById('deepStackThreshold');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const status = document.getElementById('status');

  let currentPreset = 'TAG';

  // Update confirmation delay row visibility
  function updateConfirmationDelayVisibility() {
    confirmationDelayRow.style.display = confirmationMode.checked ? 'flex' : 'none';
  }

  // Load current settings
  chrome.storage.local.get(['autoPlaySettings'], (result) => {
    if (result.autoPlaySettings) {
      const settings = result.autoPlaySettings;

      // Set preset
      currentPreset = settings.preset || 'TAG';
      presetBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === currentPreset);
      });

      // Set safety settings
      confirmationMode.checked = settings.confirmationMode !== false;
      confirmationDelay.value = (settings.confirmationDelay || 5000) / 1000;
      actingDelay.value = settings.actingDelay || 1000;

      // Set raise sizing
      if (settings.raiseSizing) {
        unopenedSize.value = settings.raiseSizing.unopened || 2.5;
        limpSize.value = settings.raiseSizing['facing-limp'] || 3;
        threeBetSize.value = settings.raiseSizing['3bet'] || 3;
        fourBetSize.value = settings.raiseSizing['4bet'] || 2.5;
      }

      // Set stack thresholds
      if (settings.stackThresholds) {
        shortStackThreshold.value = settings.stackThresholds.short || 20;
        deepStackThreshold.value = settings.stackThresholds.deep || 100;
      }

      updateConfirmationDelayVisibility();
    }
  });

  // Preset selection
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPreset = btn.dataset.preset;
    });
  });

  // Confirmation mode toggle
  confirmationMode.addEventListener('change', updateConfirmationDelayVisibility);

  // Save settings
  saveBtn.addEventListener('click', () => {
    // Build settings object
    const settings = {
      preset: currentPreset,
      confirmationMode: confirmationMode.checked,
      confirmationDelay: parseInt(confirmationDelay.value) * 1000,
      actingDelay: parseInt(actingDelay.value),
      raiseSizing: {
        unopened: parseFloat(unopenedSize.value),
        'facing-limp': parseFloat(limpSize.value),
        '3bet': parseFloat(threeBetSize.value),
        '4bet': parseFloat(fourBetSize.value)
      },
      stackThresholds: {
        short: parseInt(shortStackThreshold.value),
        deep: parseInt(deepStackThreshold.value)
      }
    };

    // Load hand-evaluator to get preset ranges
    // We'll generate ranges based on the selected preset
    chrome.storage.local.get(['autoPlaySettings'], (result) => {
      const currentSettings = result.autoPlaySettings || {};

      // Generate ranges for each position based on preset
      settings.ranges = {
        UTG: generatePresetRange(currentPreset, 'UTG'),
        MP: generatePresetRange(currentPreset, 'MP'),
        CO: generatePresetRange(currentPreset, 'CO'),
        BTN: generatePresetRange(currentPreset, 'BTN'),
        SB: generatePresetRange(currentPreset, 'SB'),
        BB: generatePresetRange(currentPreset, 'BB')
      };

      // Save to storage
      chrome.storage.local.set({ autoPlaySettings: settings }, () => {
        showStatus('Settings saved successfully!', 'success');

        // Close tab after short delay
        setTimeout(() => {
          window.close();
        }, 1500);
      });
    });
  });

  // Cancel button
  cancelBtn.addEventListener('click', () => {
    window.close();
  });

  // Generate preset ranges for a position
  function generatePresetRange(preset, position) {
    const presets = {
      tight: {
        UTG: {
          unopened: { raise: 'QQ+,AKs,AKo', call: 'JJ,AQs', fold: '*' },
          'facing-limp': { raise: 'QQ+,AKs,AKo', call: 'JJ,TT,AQs', fold: '*' },
          'facing-raise': { '3bet': 'KK+,AKs', call: 'QQ,JJ,AKo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'AKs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        MP: {
          unopened: { raise: 'TT+,AQs+,AKo', call: '99,88,AJs,KQs', fold: '*' },
          'facing-limp': { raise: 'TT+,AQs+,AKo', call: '99,88,AJs,KQs', fold: '*' },
          'facing-raise': { '3bet': 'KK+,AKs', call: 'QQ,JJ,AQs,AKo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'AKs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        CO: {
          unopened: { raise: '99+,AJs+,KQs,AQo+', call: '77,88,ATs,KJs', fold: '*' },
          'facing-limp': { raise: 'TT+,AJs+,KQs,AQo+', call: '99,88,77,ATs,KJs,QJs', fold: '*' },
          'facing-raise': { '3bet': 'KK+,AKs,AKo', call: 'QQ,JJ,AQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'AKs,QQ', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        BTN: {
          unopened: { raise: '77+,A9s+,KTs+,QTs+,JTs,T9s,98s,AJo+,KQo', call: '22-66,A2s-A8s,K9s,Q9s', fold: '*' },
          'facing-limp': { raise: '88+,ATs+,KTs+,QTs+,AJo+,KQo', call: '22-77,A2s-A9s,K9s,Q9s,J9s,T9s,98s', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ,TT,AQs,AJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'QQ,AKs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        SB: {
          unopened: { raise: '77+,A9s+,KTs+,QTs+,AJo+,KQo', call: '22-66,A2s-A8s', fold: '*' },
          'facing-limp': { raise: '99+,ATs+,KTs+,QTs+,AJo+,KQo', call: '22-88,A2s-A9s,K9s,Q9s,J9s', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ,TT,AQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'QQ,AKs', fold: '*' },
          'sb-complete': { call: '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,87s,76s,A7o+,K9o+,Q9o+,JTo', fold: '*' }
        },
        BB: {
          unopened: { raise: '77+,A9s+,KTs+,QTs+,AJo+,KQo', call: '*', fold: '' },
          'facing-limp': { raise: '88+,ATs+,KTs+,AJo+,KQo', call: '22-77,A2s-A9s,K5s+,Q8s+,J8s+,T8s+,98s,87s', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ-77,AJs+,KQs,AQo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'QQ,AKs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        }
      },
      TAG: {
        UTG: {
          unopened: { raise: 'TT+,AJs+,KQs,AQo+', call: '99,88,ATs', fold: '*' },
          'facing-limp': { raise: 'TT+,AJs+,KQs,AQo+', call: '99,88,77,ATs,KJs', fold: '*' },
          'facing-raise': { '3bet': 'KK+,AKs', call: 'QQ,JJ,AKo,AQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK', call: 'QQ,AKs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        MP: {
          unopened: { raise: '88+,ATs+,KTs+,QJs,AJo+,KQo', call: '77,66,A9s,KJs', fold: '*' },
          'facing-limp': { raise: '99+,ATs+,KTs+,QJs,AJo+,KQo', call: '22-88,A5s-A9s,K9s,Q9s,J9s,T9s', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ,TT,AQs,AJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        CO: {
          unopened: { raise: '66+,A8s+,K9s+,Q9s+,J9s+,T9s,98s,ATo+,KJo+,QJo', call: '22-55,A2s-A7s', fold: '*' },
          'facing-limp': { raise: '77+,A9s+,KTs+,QTs+,JTs,ATo+,KJo+,QJo', call: '22-66,A2s-A8s,K9s,Q9s,J9s,T9s,98s,87s', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo,JJ', call: 'TT,99,AQs,AJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        BTN: {
          unopened: { raise: '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A8o+,KTo+,QTo+,JTo', call: '', fold: '' },
          'facing-limp': { raise: '66+,A8s+,KTs+,QTs+,JTs,T9s,A9o+,KJo+,QJo', call: '22-55,A2s-A7s,K5s-K9s,Q8s,J8s,T8s,98s,87s,76s', fold: '*' },
          'facing-raise': { '3bet': 'JJ+,AJs+,KQs,AQo+', call: 'TT-77,ATs,KJs,QJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        SB: {
          unopened: { raise: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,98s,87s,76s,A9o+,KTo+,QTo+,JTo', call: '', fold: '' },
          'facing-limp': { raise: '77+,A9s+,KTs+,QTs+,JTs,ATo+,KJo+,QJo', call: '22-66,A2s-A8s,K8s,Q9s,J9s,T9s,98s,87s', fold: '*' },
          'facing-raise': { '3bet': 'JJ+,AJs+,KQs,AQo+', call: 'TT-66,ATs,KJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ', fold: '*' },
          'sb-complete': { call: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,97s+,87s,76s,65s,A5o+,K8o+,Q9o+,J9o+,T9o', fold: '*' }
        },
        BB: {
          unopened: { raise: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,97s+,87s,76s,65s,A7o+,K9o+,Q9o+,J9o+,T9o', call: '*', fold: '' },
          'facing-limp': { raise: '77+,A8s+,KTs+,QTs+,ATo+,KJo+', call: '22-66,A2s-A7s,K5s-K9s,Q7s+,J7s+,T7s+,97s+,87s,76s,65s', fold: '*' },
          'facing-raise': { '3bet': 'TT+,AJs+,KQs,AQo+', call: '22-99,A2s+,K9s+,Q9s+,J9s+,T9s,AJo,KQo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        }
      },
      LAG: {
        UTG: {
          unopened: { raise: '88+,A9s+,KTs+,QTs+,JTs,AJo+,KQo', call: '77,66,A8s,KJs', fold: '*' },
          'facing-limp': { raise: '88+,A9s+,KTs+,QTs+,JTs,AJo+,KQo', call: '77,66,55,A8s,A7s,KJs,QJs', fold: '*' },
          'facing-raise': { '3bet': 'QQ+,AKs,AKo', call: 'JJ-88,AQs,AJs,KQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,AKo', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        MP: {
          unopened: { raise: '66+,A7s+,K9s+,Q9s+,J9s+,T9s,98s,ATo+,KJo+,QJo', call: '22-55,A2s-A6s', fold: '*' },
          'facing-limp': { raise: '66+,A8s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+,QJo', call: '22-55,A2s-A7s,K8s,Q8s,J8s,T8s,98s,87s', fold: '*' },
          'facing-raise': { '3bet': 'JJ+,AKs,AKo', call: 'TT-77,AQs,AJs,KQs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        CO: {
          unopened: { raise: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,87s,76s,A7o+,KTo+,QTo+,JTo', call: '', fold: '' },
          'facing-limp': { raise: '55+,A5s+,K8s+,Q9s+,J9s+,T9s,98s,A9o+,KTo+,QTo+,JTo', call: '22-44,A2s-A4s,K5s-K7s,Q7s,J7s,T7s,97s,87s,76s,65s', fold: '*' },
          'facing-raise': { '3bet': 'TT+,AJs+,KQs,AQo+', call: '99-22,A8s+,KJs+,QJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,AKo,AQs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        BTN: {
          unopened: { raise: '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,86s+,75s+,65s,54s,A2o+,K8o+,Q9o+,J9o+,T9o', call: '', fold: '' },
          'facing-limp': { raise: '44+,A4s+,K7s+,Q8s+,J8s+,T8s+,98s,87s,A7o+,KTo+,QTo+,JTo', call: '22-33,A2s-A3s,K2s-K6s,Q5s-Q7s,J6s,T6s,96s,86s,76s,65s,54s', fold: '*' },
          'facing-raise': { '3bet': 'TT+,A9s+,KTs+,QJs,AJo+', call: '99-22,A2s-A8s,K9s,KJs,QTs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,TT,AKo,AQs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        SB: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J5s+,T6s+,96s+,86s+,75s+,65s,54s,A2o+,K7o+,Q8o+,J9o+,T9o', call: '', fold: '' },
          'facing-limp': { raise: '55+,A5s+,K8s+,Q9s+,J9s+,T9s,98s,A8o+,KTo+,QTo+,JTo', call: '22-44,A2s-A4s,K4s-K7s,Q6s-Q8s,J7s,T7s,97s,87s,76s,65s', fold: '*' },
          'facing-raise': { '3bet': 'TT+,A9s+,KTs+,QJs,AJo+', call: '99-22,A2s-A8s,K8s+,Q9s+,J9s+', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,TT,AKo', fold: '*' },
          'sb-complete': { call: '22+,A2s+,K2s+,Q2s+,J4s+,T5s+,95s+,85s+,74s+,64s+,54s,A2o+,K5o+,Q7o+,J8o+,T8o+,98o', fold: '*' }
        },
        BB: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J2s+,T4s+,95s+,85s+,75s+,64s+,54s,A2o+,K5o+,Q7o+,J8o+,T8o+,98o', call: '*', fold: '' },
          'facing-limp': { raise: '55+,A5s+,K8s+,Q9s+,J9s+,T9s,98s,A8o+,KTo+,QJo', call: '22-44,A2s-A4s,K2s-K7s,Q5s-Q8s,J6s+,T6s+,96s+,86s+,76s,65s,54s', fold: '*' },
          'facing-raise': { '3bet': '99+,A8s+,KTs+,QTs+,JTs,AJo+,KQo', call: '22-88,A2s-A7s,K5s+,Q8s+,J8s+,T8s+,98s,ATo,KJo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,TT,AKo,AQs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        }
      },
      loose: {
        UTG: {
          unopened: { raise: '66+,A8s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+,QJo', call: '22-55,A2s-A7s,KTs', fold: '*' },
          'facing-limp': { raise: '66+,A8s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+,QJo', call: '22-55,A2s-A7s,K8s,Q8s,J8s,T8s,98s,87s', fold: '*' },
          'facing-raise': { '3bet': 'JJ+,AKs,AKo', call: 'TT-66,AJs+,KQs,AQo', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        MP: {
          unopened: { raise: '22+,A5s+,K8s+,Q8s+,J8s+,T8s+,98s,87s,A9o+,KTo+,QTo+,JTo', call: 'A2s-A4s', fold: '*' },
          'facing-limp': { raise: '44+,A6s+,K8s+,Q8s+,J8s+,T8s+,98s,87s,A8o+,KTo+,QTo+,JTo', call: '22-33,A2s-A5s,K5s-K7s,Q6s,J6s,T6s,96s,76s,65s', fold: '*' },
          'facing-raise': { '3bet': 'TT+,AJs+,KQs,AQo+', call: '99-22,A8s+,KJs+,QJs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,AKs', call: 'QQ,JJ,AKo', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        CO: {
          unopened: { raise: '22+,A2s+,K4s+,Q6s+,J7s+,T7s+,97s+,87s,76s,65s,A5o+,K9o+,Q9o+,J9o+,T9o', call: '', fold: '' },
          'facing-limp': { raise: '33+,A4s+,K6s+,Q7s+,J8s+,T8s+,98s,87s,76s,A7o+,KTo+,QTo+,JTo', call: '22,A2s-A3s,K4s-K5s,Q5s-Q6s,J6s,T6s,96s,86s,65s,54s', fold: '*' },
          'facing-raise': { '3bet': '99+,A9s+,KTs+,QJs,AJo+,KQo', call: '88-22,A2s-A8s,K9s,KJs,QTs', fold: '*' },
          'facing-3bet': { '4bet': 'AA,KK,QQ,AKs', call: 'JJ,TT,AKo,AQs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        BTN: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J3s+,T5s+,95s+,85s+,75s+,64s+,54s,A2o+,K6o+,Q8o+,J8o+,T8o+,98o', call: '', fold: '' },
          'facing-limp': { raise: '22+,A3s+,K5s+,Q6s+,J7s+,T7s+,97s,87s,76s,A5o+,K9o+,Q9o+,J9o+,T9o', call: 'A2s,K2s-K4s,Q4s-Q5s,J5s-J6s,T5s-T6s,95s-96s,85s-86s,75s,65s,54s', fold: '*' },
          'facing-raise': { '3bet': '88+,A7s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+', call: '77-22,A2s-A6s,K5s+,Q7s+,J7s+,T7s+,97s+,87s', fold: '*' },
          'facing-3bet': { '4bet': 'KK+,AKs', call: 'QQ,JJ,TT,AKo,AQs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        },
        SB: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J2s+,T3s+,94s+,84s+,74s+,64s+,53s+,A2o+,K4o+,Q6o+,J7o+,T8o+,98o', call: '', fold: '' },
          'facing-limp': { raise: '33+,A4s+,K6s+,Q7s+,J8s+,T8s+,98s,87s,76s,A6o+,K9o+,Q9o+,J9o+,T9o', call: '22,A2s-A3s,K3s-K5s,Q4s-Q6s,J5s-J7s,T5s-T7s,95s-97s,85s-86s,75s,65s,54s', fold: '*' },
          'facing-raise': { '3bet': '88+,A7s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+', call: '77-22,A2s-A6s,K4s+,Q6s+,J6s+,T6s+,96s+', fold: '*' },
          'facing-3bet': { '4bet': 'KK+,AKs', call: 'QQ,JJ,TT,AKo,AQs', fold: '*' },
          'sb-complete': { call: '22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,53s+,43s,A2o+,K2o+,Q3o+,J5o+,T6o+,96o+,86o+', fold: '*' }
        },
        BB: {
          unopened: { raise: '22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,53s+,43s,A2o+,K2o+,Q4o+,J6o+,T7o+,97o+,87o', call: '*', fold: '' },
          'facing-limp': { raise: '44+,A4s+,K6s+,Q7s+,J8s+,T8s+,98s,87s,76s,A6o+,K9o+,Q9o+,JTo', call: '22-33,A2s-A3s,K2s-K5s,Q3s-Q6s,J4s-J7s,T4s-T7s,94s-97s,84s-86s,74s-75s,64s,54s', fold: '*' },
          'facing-raise': { '3bet': '77+,A5s+,K8s+,Q9s+,J9s+,T9s,A9o+,KTo+,QJo', call: '22-66,A2s-A4s,K2s-K7s,Q2s-Q8s,J5s+,T6s+,96s+,86s+,75s+,65s,A2o-A8o,K8o+,Q9o+,J9o+,T9o', fold: '*' },
          'facing-3bet': { '4bet': 'KK+,AKs', call: 'QQ,JJ,TT,99,AKo,AQs,AJs', fold: '*' },
          'sb-complete': { call: '*', fold: '' }
        }
      }
    };

    return presets[preset]?.[position] || presets.TAG[position];
  }

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type}`;

    setTimeout(() => {
      status.className = 'status';
    }, 3000);
  }
});
