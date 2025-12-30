// Google Analytics 4 Measurement Protocol for Chrome Extension
// Documentation: https://developers.google.com/analytics/devguides/collection/protocol/ga4

const GA_MEASUREMENT_ID = 'G-ENJNTMJV08'; // Replace with your GA4 Measurement ID
const GA_API_SECRET = 'yG_FBuCSQ2qtOGE5BadYWg'; // Replace with your GA4 API Secret

const GA_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;

// Get or create a unique client ID
async function getClientId() {
  const result = await chrome.storage.local.get(['ga_client_id']);
  if (result.ga_client_id) {
    return result.ga_client_id;
  }

  // Generate a new client ID (UUID v4 format)
  const clientId = crypto.randomUUID();
  await chrome.storage.local.set({ ga_client_id: clientId });
  return clientId;
}

// Send event to Google Analytics
async function sendAnalyticsEvent(eventName, eventParams = {}) {
  try {
    const clientId = await getClientId();

    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          engagement_time_msec: '100',
          session_id: Date.now().toString(),
          ...eventParams
        }
      }]
    };

    const response = await fetch(GA_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('[Analytics] Failed to send event:', response.status);
    }
  } catch (error) {
    console.error('[Analytics] Error sending event:', error);
  }
}

// Track extension install/update
async function trackInstall(reason) {
  await sendAnalyticsEvent('extension_install', {
    install_reason: reason,
    extension_version: chrome.runtime.getManifest().version
  });
}

// Track popup opened
async function trackPopupOpen() {
  await sendAnalyticsEvent('popup_open');
}

// Track settings changed
async function trackSettingsChange(settingName, newValue) {
  await sendAnalyticsEvent('settings_change', {
    setting_name: settingName,
    setting_value: String(newValue)
  });
}

// Track sound upload
async function trackSoundUpload() {
  await sendAnalyticsEvent('sound_upload');
}

// Track sound removed
async function trackSoundRemoved() {
  await sendAnalyticsEvent('sound_removed');
}

// Track AI request
async function trackAIRequest(provider) {
  await sendAnalyticsEvent('ai_request', {
    ai_provider: provider
  });
}

// Track page view (for popup)
async function trackPageView(pageName) {
  await sendAnalyticsEvent('page_view', {
    page_title: pageName,
    page_location: pageName
  });
}

// Export functions for use in other scripts
if (typeof window !== 'undefined') {
  window.analytics = {
    sendEvent: sendAnalyticsEvent,
    trackInstall,
    trackPopupOpen,
    trackSettingsChange,
    trackSoundUpload,
    trackSoundRemoved,
    trackAIRequest,
    trackPageView
  };
}
