// Background service worker for coordinating AI requests

// Import analytics module
importScripts('analytics.js');

// Track extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    sendAnalyticsEvent('extension_install', { install_reason: 'install' });
  } else if (details.reason === 'update') {
    sendAnalyticsEvent('extension_install', {
      install_reason: 'update',
      previous_version: details.previousVersion
    });
  }
});

// Inject WebSocket override early into PokerNow pages
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // Only main frame

  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['ws-override.js'],
      world: 'MAIN',
      injectImmediately: true
    });
    console.log('[Background] WebSocket override injected into tab', details.tabId);
  } catch (error) {
    console.error('[Background] Failed to inject WebSocket override:', error);
  }
}, { url: [{ hostSuffix: 'pokernow.com' }] });

let geminiTabId = null;
let claudeTabId = null;
let chatgptTabId = null;
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

  if (message.type === 'CHATGPT_READY') {
    // ChatGPT page is ready, send pending prompt if any
    if (pendingPrompt && pendingProvider === 'chatgpt' && sender.tab) {
      chatgptTabId = sender.tab.id;
      chrome.tabs.sendMessage(chatgptTabId, {
        type: 'INPUT_PROMPT',
        prompt: pendingPrompt
      });
      pendingPrompt = null;
      pendingProvider = null;
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.type === 'GEMINI_RESPONSE' || message.type === 'CLAUDE_RESPONSE' || message.type === 'CHATGPT_RESPONSE') {
    // Forward AI response to PokerNow tabs
    forwardToPokerNow(message.response);
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.type === 'MANUAL_AI_REQUEST') {
    // Forward manual AI request to PokerNow tabs
    forwardManualAIRequest();
    sendResponse({ status: 'ok' });
    return true;
  }
});

async function handleAIRequest(provider, handLog) {
  const fullPrompt = buildPokerPrompt(handLog);

  // Track AI request
  sendAnalyticsEvent('ai_request', { ai_provider: provider });

  try {
    if (provider === 'gemini') {
      await handleGeminiRequest(fullPrompt);
    } else if (provider === 'claude') {
      await handleClaudeRequest(fullPrompt);
    } else if (provider === 'chatgpt') {
      await handleChatGPTRequest(fullPrompt);
    }
  } catch (error) {
    console.error('[Background] Error handling AI request:', error);
  }
}

async function handleGeminiRequest(fullPrompt) {
  // First, try to find any existing Gemini tab
  try {
    const existingTabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
    if (existingTabs.length > 0) {
      geminiTabId = existingTabs[0].id;
      try {
        await chrome.tabs.sendMessage(geminiTabId, {
          type: 'INPUT_PROMPT',
          prompt: fullPrompt
        });
        chrome.tabs.update(geminiTabId, { active: true });
        return;
      } catch (msgError) {
        // Content script not ready, reload the tab and set pending
        console.log('[Background] Gemini tab exists but content script not ready, reloading...');
        pendingPrompt = fullPrompt;
        pendingProvider = 'gemini';
        chrome.tabs.reload(geminiTabId);
        chrome.tabs.update(geminiTabId, { active: true });
        return;
      }
    }
  } catch (e) {
    console.error('[Background] Error finding Gemini tab:', e);
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
  // First, try to find any existing Claude tab
  try {
    const existingTabs = await chrome.tabs.query({ url: '*://claude.ai/*' });
    if (existingTabs.length > 0) {
      claudeTabId = existingTabs[0].id;
      try {
        await chrome.tabs.sendMessage(claudeTabId, {
          type: 'INPUT_PROMPT',
          prompt: fullPrompt
        });
        chrome.tabs.update(claudeTabId, { active: true });
        return;
      } catch (msgError) {
        // Content script not ready, reload the tab and set pending
        console.log('[Background] Claude tab exists but content script not ready, reloading...');
        pendingPrompt = fullPrompt;
        pendingProvider = 'claude';
        chrome.tabs.reload(claudeTabId);
        chrome.tabs.update(claudeTabId, { active: true });
        return;
      }
    }
  } catch (e) {
    console.error('[Background] Error finding Claude tab:', e);
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

async function handleChatGPTRequest(fullPrompt) {
  // First, try to find any existing ChatGPT tab
  try {
    const existingTabs = await chrome.tabs.query({ url: '*://chatgpt.com/*' });
    if (existingTabs.length > 0) {
      chatgptTabId = existingTabs[0].id;
      try {
        await chrome.tabs.sendMessage(chatgptTabId, {
          type: 'INPUT_PROMPT',
          prompt: fullPrompt
        });
        chrome.tabs.update(chatgptTabId, { active: true });
        return;
      } catch (msgError) {
        // Content script not ready, reload the tab and set pending
        console.log('[Background] ChatGPT tab exists but content script not ready, reloading...');
        pendingPrompt = fullPrompt;
        pendingProvider = 'chatgpt';
        chrome.tabs.reload(chatgptTabId);
        chrome.tabs.update(chatgptTabId, { active: true });
        return;
      }
    }
  } catch (e) {
    console.error('[Background] Error finding ChatGPT tab:', e);
  }

  // Open new ChatGPT tab
  pendingPrompt = fullPrompt;
  pendingProvider = 'chatgpt';
  const tab = await chrome.tabs.create({
    url: 'https://chatgpt.com/',
    active: true
  });
  chatgptTabId = tab.id;
}

function buildPokerPrompt(handLog) {
  return `You are a poker advisor. Analyze the hand and provide GTO mixed strategy recommendations.

IMPORTANT: Show the strategy table FIRST, then explain the reasoning AFTER.

Output format:
1. First, show the GTO Mixed Strategy table with all viable options
2. Then, provide analysis and reasoning for each action

Table columns:
- Action (Fold/Check/Call/Bet/Raise with amount in BB)
- EV (expected value: +BB or -BB)
- Freq (percentage in mixed strategy, must sum to 100%)

Example:
| Action | EV | Freq |
|--------|-----|------|
| Raise 8BB | +2.5BB | 60% |
| Call | +0.5BB | 30% |
| Fold | 0BB | 10% |

**Analysis:**
[Reasoning for each action and overall recommendation]

Hand Log:
${handLog}

What are my options?`;
}

async function forwardToPokerNow(response) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.pokernow.com/*' });
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

async function forwardManualAIRequest() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.pokernow.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'MANUAL_AI_REQUEST'
      }).catch(() => {
        // Tab might not have content script ready
      });
    }
  } catch (error) {
    console.error('[Background] Error forwarding manual AI request:', error);
  }
}
