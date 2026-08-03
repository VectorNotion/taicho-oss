// Popup script for Lead Capture extension

const DEFAULT_API_URL = 'http://localhost:3004';

// State management
let currentState = 'wrong-page';
let leadData = null;
let apiUrl = DEFAULT_API_URL;
let capturedLeadId = null;

// DOM elements
const states = {
  wrongPage: document.getElementById('state-wrong-page'),
  ready: document.getElementById('state-ready'),
  capturing: document.getElementById('state-capturing'),
  success: document.getElementById('state-success'),
  error: document.getElementById('state-error'),
};

const elements = {
  // Preview elements
  previewPhoto: document.getElementById('preview-photo'),
  previewName: document.getElementById('preview-name'),
  previewTitle: document.getElementById('preview-title'),
  previewCompany: document.getElementById('preview-company'),
  previewLocation: document.getElementById('preview-location'),
  previewConnection: document.getElementById('preview-connection'),
  previewIndustry: document.getElementById('preview-industry'),
  rowLocation: document.getElementById('row-location'),
  rowConnection: document.getElementById('row-connection'),
  rowIndustry: document.getElementById('row-industry'),
  // Buttons
  btnCapture: document.getElementById('btn-capture'),
  btnCaptureResearch: document.getElementById('btn-capture-research'),
  btnViewLead: document.getElementById('btn-view-lead'),
  btnRetry: document.getElementById('btn-retry'),
  btnSettings: document.getElementById('btn-settings'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnCancelSettings: document.getElementById('btn-cancel-settings'),
  // Settings
  settingsPanel: document.getElementById('settings-panel'),
  apiUrlInput: document.getElementById('api-url'),
  // Messages
  successMessage: document.getElementById('success-message'),
  errorMessage: document.getElementById('error-message'),
};

/**
 * Show a specific state and hide others
 */
function showState(stateName) {
  currentState = stateName;
  Object.entries(states).forEach(([name, el]) => {
    if (name === stateName) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

/**
 * Populate the preview with lead data
 */
function populatePreview(data) {
  // Photo
  if (data.photoUrl) {
    elements.previewPhoto.src = data.photoUrl;
    elements.previewPhoto.style.display = 'block';
  } else {
    elements.previewPhoto.style.display = 'none';
  }

  // Required fields
  elements.previewName.textContent = data.name || 'Unknown';
  elements.previewTitle.textContent = data.title || 'No title';
  elements.previewCompany.textContent = data.company || 'Unknown company';

  // Optional fields - hide row if not available
  if (data.location) {
    elements.previewLocation.textContent = data.location;
    elements.rowLocation.style.display = 'flex';
  } else {
    elements.rowLocation.style.display = 'none';
  }

  if (data.connectionDegree) {
    elements.previewConnection.textContent = data.connectionDegree;
    elements.rowConnection.style.display = 'flex';
  } else {
    elements.rowConnection.style.display = 'none';
  }

  if (data.industry) {
    elements.previewIndustry.textContent = data.industry;
    elements.rowIndustry.style.display = 'flex';
  } else {
    elements.rowIndustry.style.display = 'none';
  }
}

/**
 * Check if current tab is a Sales Navigator profile page
 */
async function checkCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url) {
      showState('wrongPage');
      return;
    }

    const isSalesNav = tab.url.includes('linkedin.com/sales/lead/') ||
                       tab.url.includes('linkedin.com/sales/people/');

    if (!isSalesNav) {
      showState('wrongPage');
      return;
    }

    // Inject and execute content script directly
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // Now execute the extraction function
    const extractionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // This runs in the page context where extractLeadData is now defined
        if (typeof extractLeadData === 'function') {
          return extractLeadData();
        }
        return null;
      }
    });

    const extractedData = extractionResults?.[0]?.result;

    if (extractedData) {
      leadData = extractedData;
      populatePreview(leadData);
      showState('ready');
    } else {
      elements.errorMessage.textContent = 'Could not extract lead data. Make sure the profile is fully loaded.';
      showState('error');
    }
  } catch (error) {
    console.error('Error checking page:', error);
    elements.errorMessage.textContent = error.message || 'An unexpected error occurred.';
    showState('error');
  }
}

/**
 * Capture the lead by sending to API
 */
async function captureLead(triggerResearch = false) {
  if (!leadData) return;

  showState('capturing');

  try {
    const payload = {
      name: leadData.name,
      title: leadData.title,
      company: leadData.company,
      linkedinUrl: leadData.linkedinUrl,
      location: leadData.location,
      photoUrl: leadData.photoUrl,
      source: 'sales_navigator',
      priority: 'medium',
      tags: [],
      triggerResearch,
    };

    // Add LinkedIn bio if available
    if (leadData.about) {
      payload.about = leadData.about;
    }

    const response = await fetch(`${apiUrl}/api/outreach/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to capture lead');
    }

    capturedLeadId = result.id;

    // Check if it was an existing lead (updated) or new
    if (result.existed) {
      elements.successMessage.textContent = 'Lead already exists - updated!';
    } else if (triggerResearch) {
      elements.successMessage.textContent = 'Lead captured! Research started.';
    } else {
      elements.successMessage.textContent = 'Lead captured!';
    }

    showState('success');
  } catch (error) {
    console.error('Error capturing lead:', error);

    if (error.message.includes('fetch')) {
      elements.errorMessage.textContent = `Cannot connect to API at ${apiUrl}. Check settings.`;
    } else {
      elements.errorMessage.textContent = error.message;
    }

    showState('error');
  }
}

/**
 * Load settings from storage
 */
async function loadSettings() {
  const result = await chrome.storage.local.get(['apiUrl']);
  apiUrl = result.apiUrl || DEFAULT_API_URL;
  elements.apiUrlInput.value = apiUrl;
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  const newUrl = elements.apiUrlInput.value.trim();
  if (!newUrl) {
    apiUrl = DEFAULT_API_URL;
  } else {
    // Remove trailing slash
    apiUrl = newUrl.replace(/\/$/, '');
  }

  await chrome.storage.local.set({ apiUrl });
  elements.settingsPanel.classList.add('hidden');
}

/**
 * Open the dashboard to view the captured lead
 */
function viewLeadInDashboard() {
  if (capturedLeadId) {
    chrome.tabs.create({ url: `${apiUrl}/leads/${capturedLeadId}` });
  } else {
    chrome.tabs.create({ url: `${apiUrl}/leads` });
  }
}

// Event listeners
elements.btnCapture.addEventListener('click', () => captureLead(false));
elements.btnCaptureResearch.addEventListener('click', () => captureLead(true));
elements.btnViewLead.addEventListener('click', viewLeadInDashboard);
elements.btnRetry.addEventListener('click', checkCurrentPage);

elements.btnSettings.addEventListener('click', () => {
  elements.apiUrlInput.value = apiUrl;
  elements.settingsPanel.classList.toggle('hidden');
});

elements.btnSaveSettings.addEventListener('click', saveSettings);
elements.btnCancelSettings.addEventListener('click', () => {
  elements.settingsPanel.classList.add('hidden');
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Show version from manifest
  const manifest = chrome.runtime.getManifest();
  document.getElementById('version').textContent = `v${manifest.version}`;

  await loadSettings();
  await checkCurrentPage();
});
