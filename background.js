// Background service worker for coordinating Gemini AI requests

let geminiTabId = null;
let pendingPrompt = null;

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEND_TO_GEMINI') {
    handleGeminiRequest(message.prompt, message.handLog);
    sendResponse({ status: 'processing' });
    return true;
  }

  if (message.type === 'GEMINI_READY') {
    // Gemini page is ready, send pending prompt if any
    if (pendingPrompt && sender.tab) {
      geminiTabId = sender.tab.id;
      chrome.tabs.sendMessage(geminiTabId, {
        type: 'INPUT_PROMPT',
        prompt: pendingPrompt
      });
      pendingPrompt = null;
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.type === 'GEMINI_RESPONSE') {
    // Forward Gemini response to PokerNow tabs
    forwardToPokerNow(message.response);
    sendResponse({ status: 'ok' });
    return true;
  }
});

async function handleGeminiRequest(prompt, handLog) {
  const fullPrompt = buildPokerPrompt(handLog);

  try {
    // Check if Gemini tab exists and is still valid
    if (geminiTabId) {
      try {
        const tab = await chrome.tabs.get(geminiTabId);
        if (tab && tab.url && tab.url.includes('gemini.google.com')) {
          // Tab exists, send prompt directly
          chrome.tabs.sendMessage(geminiTabId, {
            type: 'INPUT_PROMPT',
            prompt: fullPrompt
          });
          // Focus the Gemini tab briefly then return to PokerNow
          chrome.tabs.update(geminiTabId, { active: true });
          return;
        }
      } catch (e) {
        // Tab no longer exists
        geminiTabId = null;
      }
    }

    // Open new Gemini tab
    pendingPrompt = fullPrompt;
    const tab = await chrome.tabs.create({
      url: 'https://gemini.google.com/app',
      active: true
    });
    geminiTabId = tab.id;

  } catch (error) {
    console.error('[Background] Error handling Gemini request:', error);
  }
}

function buildPokerPrompt(handLog) {
  return `You are a poker advisor. Show Recommended Action first then reasoning.

Hand Log:
${handLog}

What should I do?`;
}

async function forwardToPokerNow(response) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.pokernow.club/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'GEMINI_RESPONSE',
        response: response
      });
    }
  } catch (error) {
    console.error('[Background] Error forwarding response:', error);
  }
}
