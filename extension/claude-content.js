// Content script for Claude page - automates input and captures response

(function() {
  'use strict';

  let isProcessing = false;
  let responseObserver = null;

  // Notify background that Claude page is ready
  function notifyReady() {
    chrome.runtime.sendMessage({ type: 'CLAUDE_READY' });
  }

  // Wait for the input element to be available
  function waitForInput(callback, maxAttempts = 30) {
    let attempts = 0;
    const check = () => {
      // Claude uses a contenteditable div for input
      const inputEl = document.querySelector('div[contenteditable="true"]') ||
                      document.querySelector('.ProseMirror') ||
                      document.querySelector('[data-placeholder]');

      if (inputEl) {
        callback(inputEl);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(check, 500);
      } else {
        console.error('[Claude] Could not find input element');
      }
    };
    check();
  }

  // Find the stop button (shown when Claude is generating)
  function findStopButton() {
    return document.querySelector('button[aria-label*="Stop"]') ||
           document.querySelector('button[aria-label*="stop"]') ||
           document.querySelector('button[data-testid="stop-button"]') ||
           // Look for button with stop icon
           Array.from(document.querySelectorAll('button')).find(btn => {
             const ariaLabel = btn.getAttribute('aria-label') || '';
             if (ariaLabel.toLowerCase().includes('stop')) {
               return true;
             }
             // Check for stop icon inside button
             const svg = btn.querySelector('svg');
             if (svg) {
               const path = svg.querySelector('path');
               // Claude's stop button typically has a square/rect shape
               if (path && btn.closest('form')) {
                 const d = path.getAttribute('d') || '';
                 // Square-ish path for stop icon
                 if (d.includes('rect') || d.includes('M4') || d.includes('M6')) {
                   return true;
                 }
               }
             }
             return false;
           });
  }

  // Check if button is enabled
  function isButtonEnabled(btn) {
    if (!btn) return false;
    return !btn.disabled &&
           btn.getAttribute('aria-disabled') !== 'true' &&
           !btn.classList.contains('disabled');
  }

  // Stop any ongoing generation and wait for send button to be ready
  function stopGeneration(callback) {
    const stopBtn = findStopButton();
    if (stopBtn && isButtonEnabled(stopBtn)) {
      console.log('[Claude] Found Stop button, clicking to stop generation...');
      stopBtn.click();
      // Wait for send button to become enabled after stopping
      waitForSendButtonAfterStop(callback);
    } else {
      // No stop button, proceed immediately
      callback();
    }
  }

  // Wait for send button to be enabled after stopping generation
  function waitForSendButtonAfterStop(callback, timeout = 10000) {
    const startTime = Date.now();
    console.log('[Claude] Waiting for send button to be enabled after stopping...');

    const checkButton = () => {
      const sendBtn = findSendButton();
      const stopBtn = findStopButton();

      // Make sure stop button is gone or disabled, and send button is enabled
      const stopGone = !stopBtn || !isButtonEnabled(stopBtn);
      const sendReady = sendBtn && isButtonEnabled(sendBtn);

      if (stopGone && sendReady) {
        console.log('[Claude] Send button is ready after stop');
        callback();
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkButton()) return;

    // Poll until ready or timeout
    const pollInterval = setInterval(() => {
      if (checkButton()) {
        clearInterval(pollInterval);
      } else if (Date.now() - startTime > timeout) {
        console.log('[Claude] Timeout waiting for send button after stop, proceeding anyway');
        clearInterval(pollInterval);
        callback();
      }
    }, 300);
  }

  // Find the send button using various selectors
  function findSendButton() {
    // Try various selectors for the send button
    return document.querySelector('button[aria-label*="Send"]') ||
           document.querySelector('button[aria-label*="send"]') ||
           document.querySelector('button[data-testid="send-button"]') ||
           // Look for button with send icon or arrow
           Array.from(document.querySelectorAll('button')).find(btn => {
             const ariaLabel = btn.getAttribute('aria-label') || '';
             if (ariaLabel.toLowerCase().includes('send')) {
               return true;
             }
             // Check for arrow icon inside button (Claude uses an arrow icon)
             const svg = btn.querySelector('svg');
             if (svg && btn.closest('form')) {
               return true;
             }
             return false;
           });
  }

  // Click send button with retry logic
  function clickSendButton(retryCount = 0, maxRetries = 5) {
    const sendBtn = findSendButton();

    if (sendBtn && !sendBtn.disabled) {
      console.log('[Claude] Found send button, clicking...');
      sendBtn.click();
      return true;
    }

    // If button not found or disabled, retry after delay
    if (retryCount < maxRetries) {
      console.log(`[Claude] Send button not ready, retry ${retryCount + 1}/${maxRetries}...`);
      setTimeout(() => {
        if (!clickSendButton(retryCount + 1, maxRetries)) {
          tryEnterKey();
        }
      }, 300);
      return true;
    }

    return false;
  }

  // Try pressing Enter as fallback
  function tryEnterKey() {
    const inputEl = document.querySelector('div[contenteditable="true"]') ||
                    document.querySelector('.ProseMirror');
    if (inputEl) {
      console.log('[Claude] Trying Enter key as fallback...');
      inputEl.focus();

      const events = [
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
        new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
      ];

      events.forEach(event => inputEl.dispatchEvent(event));
      return true;
    }
    return false;
  }

  // Input the prompt into Claude
  function inputPrompt(prompt) {
    if (isProcessing) {
      console.log('[Claude] Already processing a request');
      return;
    }

    isProcessing = true;

    // First, stop any ongoing generation
    stopGeneration(() => {
      waitForInput((inputEl) => {
        // Clear existing content
        inputEl.innerHTML = '';
        inputEl.textContent = '';

        // Focus the input
        inputEl.focus();

        // Convert line breaks to proper HTML paragraphs for ProseMirror
        const lines = prompt.split('\n');
        if (lines.length > 1) {
          // Multiple lines - use paragraph elements
          inputEl.innerHTML = lines.map(line => `<p>${line || '<br>'}</p>`).join('');
        } else {
          // Single line - use textContent
          inputEl.textContent = prompt;
        }

        // Trigger input event
        inputEl.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: prompt
        }));

        // Wait a moment for the UI to update, then click send
        setTimeout(() => {
          console.log('[Claude] Attempting to send prompt...');
          clickSendButton();
          watchForResponse();
        }, 800);
      });
    });
  }

  // Watch for Claude's response
  function watchForResponse() {
    if (responseObserver) {
      responseObserver.disconnect();
    }

    let lastResponseText = '';
    let stableCount = 0;
    const checkInterval = 1000;
    const stableThreshold = 3;

    const checkResponse = () => {
      // Find response elements - Claude shows responses in message containers
      const responseEls = document.querySelectorAll('[data-is-streaming], .prose, .markdown');
      const lastResponse = responseEls[responseEls.length - 1];

      if (lastResponse) {
        const currentText = lastResponse.textContent?.trim() || '';

        if (currentText && currentText === lastResponseText) {
          stableCount++;
          if (stableCount >= stableThreshold) {
            console.log('[Claude] Response captured');
            chrome.runtime.sendMessage({
              type: 'CLAUDE_RESPONSE',
              response: currentText
            });
            isProcessing = false;
            return;
          }
        } else {
          stableCount = 0;
          lastResponseText = currentText;
        }
      }

      setTimeout(checkResponse, checkInterval);
    };

    setTimeout(checkResponse, 2000);

    // Timeout after 60 seconds
    setTimeout(() => {
      if (isProcessing) {
        console.log('[Claude] Response timeout');
        isProcessing = false;
      }
    }, 60000);
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INPUT_PROMPT') {
      console.log('[Claude] Received prompt request');
      inputPrompt(message.prompt);
      sendResponse({ status: 'ok' });
    }
    return true;
  });

  // Wait for page to be fully loaded, then notify ready
  if (document.readyState === 'complete') {
    setTimeout(notifyReady, 1000);
  } else {
    window.addEventListener('load', () => {
      setTimeout(notifyReady, 1000);
    });
  }

  console.log('[Claude] Content script loaded');
})();
