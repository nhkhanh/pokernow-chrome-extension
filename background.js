// Background service worker for coordinating AI requests

let geminiTabId = null;
let claudeTabId = null;
let pendingPrompt = null;
let pendingProvider = null;

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEND_TO_AI') {
    handleAIRequest(message.provider, message.handLog);
    sendResponse({ status: 'processing' });
    return true;
  }

  if (message.type === 'GEMINI_READY') {
    // Gemini page is ready, send pending prompt if any
    if (pendingPrompt && pendingProvider === 'gemini' && sender.tab) {
      geminiTabId = sender.tab.id;
      chrome.tabs.sendMessage(geminiTabId, {
        type: 'INPUT_PROMPT',
        prompt: pendingPrompt
      });
      pendingPrompt = null;
      pendingProvider = null;
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.type === 'CLAUDE_READY') {
    // Claude page is ready, send pending prompt if any
    if (pendingPrompt && pendingProvider === 'claude' && sender.tab) {
      claudeTabId = sender.tab.id;
      chrome.tabs.sendMessage(claudeTabId, {
        type: 'INPUT_PROMPT',
        prompt: pendingPrompt
      });
      pendingPrompt = null;
      pendingProvider = null;
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.type === 'GEMINI_RESPONSE' || message.type === 'CLAUDE_RESPONSE') {
    // Forward AI response to PokerNow tabs
    forwardToPokerNow(message.response);
    sendResponse({ status: 'ok' });
    return true;
  }
});

async function handleAIRequest(provider, handLog) {
  const fullPrompt = buildPokerPrompt(handLog);

  try {
    if (provider === 'gemini') {
      await handleGeminiRequest(fullPrompt);
    } else if (provider === 'claude') {
      await handleClaudeRequest(fullPrompt);
    }
  } catch (error) {
    console.error('[Background] Error handling AI request:', error);
  }
}

async function handleGeminiRequest(fullPrompt) {
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
        chrome.tabs.update(geminiTabId, { active: true });
        return;
      }
    } catch (e) {
      geminiTabId = null;
    }
  }

  // Open new Gemini tab
  pendingPrompt = fullPrompt;
  pendingProvider = 'gemini';
  const tab = await chrome.tabs.create({
    url: 'https://gemini.google.com/app',
    active: true
  });
  geminiTabId = tab.id;
}

async function handleClaudeRequest(fullPrompt) {
  // Check if Claude tab exists and is still valid
  if (claudeTabId) {
    try {
      const tab = await chrome.tabs.get(claudeTabId);
      if (tab && tab.url && tab.url.includes('claude.ai')) {
        // Tab exists, send prompt directly
        chrome.tabs.sendMessage(claudeTabId, {
          type: 'INPUT_PROMPT',
          prompt: fullPrompt
        });
        chrome.tabs.update(claudeTabId, { active: true });
        return;
      }
    } catch (e) {
      claudeTabId = null;
    }
  }

  // Open new Claude tab
  pendingPrompt = fullPrompt;
  pendingProvider = 'claude';
  const tab = await chrome.tabs.create({
    url: 'https://claude.ai/new',
    active: true
  });
  claudeTabId = tab.id;
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
        type: 'AI_RESPONSE',
        response: response
      });
    }
  } catch (error) {
    console.error('[Background] Error forwarding response:', error);
  }
}
