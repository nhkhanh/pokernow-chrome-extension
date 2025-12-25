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

  // Click send button with retry logic
  function clickSendButton(retryCount = 0, maxRetries = 5) {
    const sendBtn = findSendButton();

    if (sendBtn && !sendBtn.disabled) {
      console.log('[Gemini] Found send button, clicking...');
      sendBtn.click();
      return true;
    }

    // If button not found or disabled, retry after delay
    if (retryCount < maxRetries) {
      console.log(`[Gemini] Send button not ready, retry ${retryCount + 1}/${maxRetries}...`);
      setTimeout(() => {
        if (!clickSendButton(retryCount + 1, maxRetries)) {
          // Final fallback: try Enter key
          tryEnterKey();
        }
      }, 300);
      return true; // Return true to indicate we're handling it
    }

    return false;
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
      }, 800);
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
