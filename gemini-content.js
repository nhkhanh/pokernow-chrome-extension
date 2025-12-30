// Content script for Gemini page - automates input and captures response

(function() {
  'use strict';

  let isProcessing = false;
  let responseObserver = null;

  // Notify background that Gemini page is ready
  function notifyReady() {
    chrome.runtime.sendMessage({ type: 'GEMINI_READY' });
  }

  // Wait for the input element to be available
  function waitForInput(callback, maxAttempts = 30) {
    let attempts = 0;
    const check = () => {
      // Gemini uses a contenteditable div or textarea for input
      const inputEl = document.querySelector('div[contenteditable="true"]') ||
                      document.querySelector('textarea[placeholder*="Enter"]') ||
                      document.querySelector('.ql-editor') ||
                      document.querySelector('rich-textarea div[contenteditable]');

      if (inputEl) {
        callback(inputEl);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(check, 500);
      } else {
        console.error('[Gemini] Could not find input element');
      }
    };
    check();
  }

  // Find the stop button (shown when Gemini is generating)
  function findStopButton() {
    return document.querySelector('button[aria-label*="Stop"]') ||
           document.querySelector('button[aria-label*="stop"]') ||
           document.querySelector('button[mattooltip*="Stop"]') ||
           document.querySelector('button[data-test-id="stop-button"]') ||
           // Look for button with stop icon
           Array.from(document.querySelectorAll('button')).find(btn => {
             const ariaLabel = btn.getAttribute('aria-label') || '';
             const matTooltip = btn.getAttribute('mattooltip') || '';
             if (ariaLabel.toLowerCase().includes('stop') || matTooltip.toLowerCase().includes('stop')) {
               return true;
             }
             // Check for stop icon inside button
             const icon = btn.querySelector('mat-icon, svg, i');
             if (icon) {
               const iconText = icon.textContent?.toLowerCase() || '';
               const iconClass = icon.className?.toLowerCase() || '';
               if (iconText.includes('stop') || iconClass.includes('stop')) {
                 return true;
               }
             }
             return false;
           });
  }

  // Stop any ongoing generation and wait for send button to be ready
  function stopGeneration(callback) {
    const stopBtn = findStopButton();
    if (stopBtn && isButtonEnabled(stopBtn)) {
      console.log('[Gemini] Found Stop button, clicking to stop generation...');
      simulateClick(stopBtn);
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
    console.log('[Gemini] Waiting for send button to be enabled after stopping...');

    const checkButton = () => {
      const sendBtn = findSendButton();
      const stopBtn = findStopButton();

      // Make sure stop button is gone or disabled, and send button is enabled
      const stopGone = !stopBtn || !isButtonEnabled(stopBtn);
      const sendReady = sendBtn && isButtonEnabled(sendBtn);

      if (stopGone && sendReady) {
        console.log('[Gemini] Send button is ready after stop');
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
        console.log('[Gemini] Timeout waiting for send button after stop, proceeding anyway');
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
           document.querySelector('button[mattooltip*="Send"]') ||
           document.querySelector('.send-button') ||
           document.querySelector('button[data-test-id="send-button"]') ||
           document.querySelector('mat-icon[data-mat-icon-name="send"]')?.closest('button') ||
           // Look for button with send icon
           Array.from(document.querySelectorAll('button')).find(btn => {
             const ariaLabel = btn.getAttribute('aria-label') || '';
             const matTooltip = btn.getAttribute('mattooltip') || '';
             if (ariaLabel.toLowerCase().includes('send') || matTooltip.toLowerCase().includes('send')) {
               return true;
             }
             // Check for send icon inside button
             const icon = btn.querySelector('mat-icon, svg, i');
             if (icon) {
               const iconText = icon.textContent?.toLowerCase() || '';
               const iconClass = icon.className?.toLowerCase() || '';
               if (iconText.includes('send') || iconClass.includes('send')) {
                 return true;
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

  // Simulate a proper mouse click with all events
  function simulateClick(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y
    };

    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    element.dispatchEvent(new MouseEvent('click', eventOptions));
  }

  // Wait for send button to become enabled using MutationObserver
  function waitForEnabledSendButton(callback, timeout = 8000) {
    const startTime = Date.now();

    const checkButton = () => {
      const sendBtn = findSendButton();
      if (sendBtn && isButtonEnabled(sendBtn)) {
        console.log('[Gemini] Send button is now enabled');
        callback(sendBtn);
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkButton()) return;

    // Set up MutationObserver to watch for changes
    const observer = new MutationObserver(() => {
      if (checkButton()) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'class']
    });

    // Also poll as backup
    const pollInterval = setInterval(() => {
      if (checkButton()) {
        clearInterval(pollInterval);
        observer.disconnect();
      } else if (Date.now() - startTime > timeout) {
        console.log('[Gemini] Timeout waiting for send button');
        clearInterval(pollInterval);
        observer.disconnect();
        // Fallback to Enter key
        tryEnterKey();
      }
    }, 300);
  }

  // Click send button with retry logic
  function clickSendButton() {
    const sendBtn = findSendButton();

    if (sendBtn && isButtonEnabled(sendBtn)) {
      console.log('[Gemini] Found enabled send button, clicking...');
      simulateClick(sendBtn);
      return true;
    }

    // Wait for button to become enabled
    console.log('[Gemini] Send button not ready, waiting...');
    waitForEnabledSendButton((btn) => {
      console.log('[Gemini] Clicking send button...');
      simulateClick(btn);
    });

    return true;
  }

  // Try pressing Enter as fallback
  function tryEnterKey() {
    const inputEl = document.querySelector('div[contenteditable="true"]') ||
                    document.querySelector('rich-textarea div[contenteditable]') ||
                    document.querySelector('textarea');
    if (inputEl) {
      console.log('[Gemini] Trying Enter key as fallback...');
      inputEl.focus();

      // Try multiple event types
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

  // Input the prompt into Gemini
  function inputPrompt(prompt) {
    if (isProcessing) {
      console.log('[Gemini] Already processing a request');
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

        // Insert the prompt text
        // Use different methods depending on the element type
        if (inputEl.tagName === 'TEXTAREA') {
          inputEl.value = prompt;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // For contenteditable divs
          inputEl.textContent = prompt;
          // Trigger input event
          inputEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: prompt
          }));
        }

        // Wait a moment for the UI to update, then click send
        setTimeout(() => {
          console.log('[Gemini] Attempting to send prompt...');
          clickSendButton();
          // Start watching for response regardless (button click has retry logic)
          watchForResponse();
        }, 1200);
      });
    });
  }

  // Watch for Gemini's response
  function watchForResponse() {
    // Clean up any existing observer
    if (responseObserver) {
      responseObserver.disconnect();
    }

    let lastResponseText = '';
    let stableCount = 0;
    const checkInterval = 1000; // Check every second
    const stableThreshold = 3; // Response is complete after 3 stable checks

    const checkResponse = () => {
      // Find response elements - Gemini typically shows responses in message containers
      const responseEls = document.querySelectorAll('.response-content, .model-response, [data-message-author-role="model"], .markdown-main-panel');
      const lastResponse = responseEls[responseEls.length - 1];

      if (lastResponse) {
        const currentText = lastResponse.textContent?.trim() || '';

        if (currentText && currentText === lastResponseText) {
          stableCount++;
          if (stableCount >= stableThreshold) {
            // Response is complete
            console.log('[Gemini] Response captured');
            chrome.runtime.sendMessage({
              type: 'GEMINI_RESPONSE',
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

      // Keep checking
      setTimeout(checkResponse, checkInterval);
    };

    // Start checking after a delay to allow response to start
    setTimeout(checkResponse, 2000);

    // Timeout after 60 seconds
    setTimeout(() => {
      if (isProcessing) {
        console.log('[Gemini] Response timeout');
        isProcessing = false;
      }
    }, 60000);
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INPUT_PROMPT') {
      console.log('[Gemini] Received prompt request');
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

  console.log('[Gemini] Content script loaded');
})();
