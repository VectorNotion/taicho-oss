// Background service worker for Lead Capture extension
console.log('Lead Capture: Background service worker started');

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Lead Capture: Extension installed');
    // Set default API URL
    chrome.storage.local.set({ apiUrl: 'http://localhost:3004' });
  } else if (details.reason === 'update') {
    console.log('Lead Capture: Extension updated');
  }
});
