// Content script for ChatGPT page - automates input and captures response

(function() {
  'use strict';

  let isProcessing = false;
  let responseObserver = null;

  // Notify background that ChatGPT page is ready
  function notifyReady() {
    chrome.runtime.sendMessage({ type: 'CHATGPT_READY' });
  }

  // Wait for the input element to be available
  function waitForInput(callback, maxAttempts = 30) {
    let attempts = 0;
    const check = () => {
      // ChatGPT uses a textarea or contenteditable div for input
      const inputEl = document.querySelector('#prompt-textarea') ||
                      document.querySelector('textarea[data-id="root"]') ||
                      document.querySelector('div[contenteditable="true"]') ||
                      document.querySelector('textarea');

      if (inputEl) {
        callback(inputEl);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(check, 500);
      } else {
        console.error('[ChatGPT] Could not find input element');
      }
    };
    check();
  }

  // Find the send button using various selectors
  function findSendButton() {
    // Try various selectors for the send button
    return document.querySelector('button[data-testid="send-button"]') ||
           document.querySelector('button[aria-label*="Send"]') ||
           document.querySelector('button[aria-label*="send"]') ||
           // Look for button with send icon near the input
           Array.from(document.querySelectorAll('button')).find(btn => {
             const ariaLabel = btn.getAttribute('aria-label') || '';
             if (ariaLabel.toLowerCase().includes('send')) {
               return true;
             }
             // Check for arrow/send icon inside button
             const svg = btn.querySelector('svg');
             if (svg) {
               const parent = btn.closest('form') || btn.closest('[class*="composer"]');
               if (parent) return true;
             }
             return false;
           });
  }

  // Click send button with retry logic
  function clickSendButton(retryCount = 0, maxRetries = 5) {
    const sendBtn = findSendButton();

    if (sendBtn && !sendBtn.disabled) {
      console.log('[ChatGPT] Found send button, clicking...');
      sendBtn.click();
      return true;
    }

    // If button not found or disabled, retry after delay
    if (retryCount < maxRetries) {
      console.log(`[ChatGPT] Send button not ready, retry ${retryCount + 1}/${maxRetries}...`);
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
    const inputEl = document.querySelector('#prompt-textarea') ||
                    document.querySelector('textarea') ||
                    document.querySelector('div[contenteditable="true"]');
    if (inputEl) {
      console.log('[ChatGPT] Trying Enter key as fallback...');
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

  // Input the prompt into ChatGPT
  function inputPrompt(prompt) {
    if (isProcessing) {
      console.log('[ChatGPT] Already processing a request');
      return;
    }

    isProcessing = true;

    waitForInput((inputEl) => {
      // Focus the input
      inputEl.focus();

      // Clear and set value based on element type
      if (inputEl.tagName === 'TEXTAREA') {
        // Use native value setter to bypass React's controlled input
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeInputValueSetter.call(inputEl, prompt);

        // Dispatch input event to trigger React's onChange
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // For contenteditable divs - convert newlines to proper HTML
        const htmlContent = prompt
          .split('\n')
          .map(line => `<p>${line || '<br>'}</p>`)
          .join('');
        inputEl.innerHTML = htmlContent;
        inputEl.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: prompt
        }));
      }

      // Wait a moment for the UI to update, then click send
      setTimeout(() => {
        console.log('[ChatGPT] Attempting to send prompt...');
        clickSendButton();
        watchForResponse();
      }, 800);
    });
  }

  // Watch for ChatGPT's response
  function watchForResponse() {
    if (responseObserver) {
      responseObserver.disconnect();
    }

    let lastResponseText = '';
    let stableCount = 0;
    const checkInterval = 1000;
    const stableThreshold = 3;

    const checkResponse = () => {
      // Find response elements - ChatGPT shows responses in message containers
      const responseEls = document.querySelectorAll('[data-message-author-role="assistant"], .markdown, .prose');
      const lastResponse = responseEls[responseEls.length - 1];

      if (lastResponse) {
        const currentText = lastResponse.textContent?.trim() || '';

        if (currentText && currentText === lastResponseText) {
          stableCount++;
          if (stableCount >= stableThreshold) {
            console.log('[ChatGPT] Response captured');
            chrome.runtime.sendMessage({
              type: 'CHATGPT_RESPONSE',
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
        console.log('[ChatGPT] Response timeout');
        isProcessing = false;
      }
    }, 60000);
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INPUT_PROMPT') {
      console.log('[ChatGPT] Received prompt request');
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

  console.log('[ChatGPT] Content script loaded');
})();
