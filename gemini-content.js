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

  // Find and click the send button
  function clickSendButton() {
    // Try various selectors for the send button
    const sendBtn = document.querySelector('button[aria-label*="Send"]') ||
                    document.querySelector('button[mattooltip*="Send"]') ||
                    document.querySelector('.send-button') ||
                    document.querySelector('button[data-test-id="send-button"]') ||
                    document.querySelector('mat-icon[data-mat-icon-name="send"]')?.closest('button') ||
                    Array.from(document.querySelectorAll('button')).find(btn =>
                      btn.querySelector('mat-icon')?.textContent?.includes('send') ||
                      btn.querySelector('svg')?.innerHTML?.includes('send')
                    );

    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      return true;
    }

    // Try pressing Enter as fallback
    const inputEl = document.querySelector('div[contenteditable="true"]') ||
                    document.querySelector('rich-textarea div[contenteditable]');
    if (inputEl) {
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
      });
      inputEl.dispatchEvent(enterEvent);
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
        if (clickSendButton()) {
          console.log('[Gemini] Prompt sent successfully');
          // Start watching for response
          watchForResponse();
        } else {
          console.error('[Gemini] Could not send prompt');
          isProcessing = false;
        }
      }, 500);
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
