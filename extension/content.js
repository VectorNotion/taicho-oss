// Content script for LinkedIn Sales Navigator lead extraction
// Injected into linkedin.com/sales/lead/* and linkedin.com/sales/people/* pages

/**
 * Extract lead data from the current Sales Navigator profile page.
 * Uses precise selectors based on LinkedIn Sales Navigator DOM structure.
 * @returns {Object|null} Lead data or null if extraction fails
 */
function extractLeadData() {
  try {
    const data = {
      name: null,
      title: null,
      company: null,
      linkedinUrl: null,
      salesNavUrl: window.location.href,
      location: null,
      companyLinkedinUrl: null,
      about: null,
      photoUrl: null,
    };

    // Name - from lead top card with data-x--lead--name attribute
    const nameEl = document.querySelector('[data-sn-view-name="feature-lead-top-card"] [data-x--lead--name]');
    if (nameEl?.textContent?.trim()) {
      data.name = nameEl.textContent.trim();
    }

    // Title - from current role section with data-anonymize="job-title"
    const titleEl = document.querySelector('[data-sn-view-name="lead-current-role"] [data-anonymize="job-title"]');
    if (titleEl?.textContent?.trim()) {
      data.title = titleEl.textContent.trim();
    }

    // Company name - from current role section with data-anonymize="company-name"
    const companyEl = document.querySelector('[data-sn-view-name="lead-current-role"] [data-anonymize="company-name"]');
    if (companyEl?.textContent?.trim()) {
      data.company = companyEl.textContent.trim();
      // Get company LinkedIn URL from the link
      if (companyEl.tagName === 'A' && companyEl.href) {
        data.companyLinkedinUrl = companyEl.href;
      }
    }

    // Photo URL - from headshot with data-anonymize="headshot-photo"
    const photoEl = document.querySelector('[data-sn-view-name="feature-lead-top-card"] [data-anonymize="headshot-photo"]');
    if (photoEl?.src && !photoEl.src.includes('ghost')) {
      data.photoUrl = photoEl.src;
    }

    // Headline - fallback for title from top card
    if (!data.title) {
      const headlineEl = document.querySelector('[data-sn-view-name="feature-lead-top-card"] [data-anonymize="headline"]');
      if (headlineEl?.textContent?.trim()) {
        data.title = headlineEl.textContent.trim();
      }
    }

    // Location - from top card, the div contains location text after SVG icon
    // Based on DOM: <div class="mMJQZqEhpdGqabNZoKajosVQmvKyWxEJZmiE ...">Boston, Massachusetts...</div>
    const locationEl = document.querySelector('[data-sn-view-name="feature-lead-top-card"] ._header_sqh8tm .mMJQZqEhpdGqabNZoKajosVQmvKyWxEJZmiE');
    if (locationEl?.textContent?.trim()) {
      data.location = locationEl.textContent.trim();
    }

    // About/Bio - from person-blurb in current role section
    const aboutEl = document.querySelector('[data-sn-view-name="lead-current-role"] [data-anonymize="person-blurb"]');
    if (aboutEl?.textContent?.trim()) {
      // Get raw text, remove "Show more" button text
      let aboutText = aboutEl.textContent.trim();
      aboutText = aboutText.replace(/…\s*Show more\s*$/, '').trim();
      data.about = aboutText.substring(0, 500);
    }

    // LinkedIn profile URL - from relationship section "See more activity on LinkedIn" link
    const linkedinProfileLink = document.querySelector('[data-sn-view-name="feature-lead-relationship"] a[href^="https://www.linkedin.com/in/"]');
    if (linkedinProfileLink?.href) {
      // Clean up URL - remove query params
      const url = new URL(linkedinProfileLink.href);
      data.linkedinUrl = `${url.origin}${url.pathname}`;
    }

    // Validate required fields
    if (!data.name) {
      return null;
    }

    // Clean up the LinkedIn URL - normalize to profile URL
    if (data.linkedinUrl) {
      // Remove query parameters and fragments
      data.linkedinUrl = data.linkedinUrl.split('?')[0].split('#')[0];
    }

    return data;
  } catch (error) {
    console.error('Lead Capture: Error extracting data', error);
    return null;
  }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractLead') {
    const leadData = extractLeadData();
    sendResponse({ success: !!leadData, data: leadData });
  }
  return true; // Keep the message channel open for async response
});

// Log that content script is loaded (for debugging)
console.log('Lead Capture: Content script loaded on', window.location.href);
