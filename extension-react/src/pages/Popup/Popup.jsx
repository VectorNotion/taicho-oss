import React, { useState, useEffect, useCallback, useRef } from 'react';
import './Popup.css';

// Application states
const STATES = {
  LOADING: 'loading',
  WRONG_PAGE: 'wrong_page',
  READY: 'ready',
  CAPTURING: 'capturing',
  GENERATING_OUTREACH: 'generating_outreach',
  SUCCESS: 'success',
  OUTREACH_READY: 'outreach_ready',
  ERROR: 'error',
};

const DEFAULT_API_URL = 'http://localhost:3004';
const POLL_INTERVAL = 2000; // 2 seconds
const STATE_STORAGE_KEY = 'leadCaptureState';

const Popup = () => {
  const [appState, setAppState] = useState(STATES.LOADING);
  const [leadData, setLeadData] = useState(null);
  const [capturedLeadId, setCapturedLeadId] = useState(null);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState(null);
  const [leadExisted, setLeadExisted] = useState(false);
  const [outreachMessage, setOutreachMessage] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [copiedField, setCopiedField] = useState(null); // Track which field was copied
  const currentUrlRef = useRef(null);
  const initialLoadDone = useRef(false);

  // Load settings from storage
  useEffect(() => {
    chrome.storage.local.get(['apiUrl'], (result) => {
      if (result.apiUrl) {
        setApiUrl(result.apiUrl);
      }
    });
  }, []);

  // Save state to storage whenever important state changes
  useEffect(() => {
    if (!initialLoadDone.current || !currentUrlRef.current) return;

    const stateToSave = {
      url: currentUrlRef.current,
      appState,
      leadData,
      capturedLeadId,
      leadExisted,
      outreachMessage,
      jobStatus,
      error,
      timestamp: Date.now(),
    };

    chrome.storage.local.set({ [STATE_STORAGE_KEY]: stateToSave });
  }, [appState, leadData, capturedLeadId, leadExisted, outreachMessage, jobStatus, error]);

  // Check if outreach was generated while popup was closed
  const checkOutreachCompletion = useCallback(async (leadId) => {
    try {
      const response = await fetch(`${apiUrl}/api/outreach/leads/${leadId}/outreach`);
      if (response.ok) {
        const messages = await response.json();
        // Find the most recent inmail message
        const inmailMessage = messages.find(m => m.medium === 'inmail');
        if (inmailMessage) {
          setOutreachMessage(inmailMessage);
          setJobStatus('Outreach ready!');
          setAppState(STATES.OUTREACH_READY);
          return;
        }
      }
      // No outreach found - reset to ready state so user can retry
      setJobStatus(null);
      setAppState(STATES.READY);
    } catch (err) {
      console.error('Failed to check outreach completion:', err);
      setAppState(STATES.READY);
    }
  }, [apiUrl]);

  // Check current page and extract lead data (or restore from storage)
  useEffect(() => {
    const checkPage = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab?.url) {
          setAppState(STATES.WRONG_PAGE);
          initialLoadDone.current = true;
          return;
        }

        // Check if on Sales Navigator profile page
        const isSalesNav = tab.url.includes('linkedin.com/sales/lead/') ||
                          tab.url.includes('linkedin.com/sales/people/');

        if (!isSalesNav) {
          setAppState(STATES.WRONG_PAGE);
          initialLoadDone.current = true;
          return;
        }

        currentUrlRef.current = tab.url;

        // Extract lead data from page
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractLeadFromPage,
        });

        if (!results?.[0]?.result) {
          setError('Could not extract lead data. Make sure the profile is fully loaded.');
          setAppState(STATES.ERROR);
          initialLoadDone.current = true;
          return;
        }

        const extractedData = results[0].result;
        setLeadData(extractedData);

        // Always check database for current state (fresh lookup every time)
        if (extractedData.name) {
          try {
            console.log('[Popup] Checking database for lead:', extractedData.name, extractedData.company);
            const lookupParams = new URLSearchParams();
            lookupParams.set('lookupName', extractedData.name);
            if (extractedData.company) {
              lookupParams.set('lookupCompany', extractedData.company);
            }

            const lookupResponse = await fetch(`${apiUrl}/api/outreach/leads?${lookupParams}`);
            console.log('[Popup] Lookup response status:', lookupResponse.status);

            if (lookupResponse.ok) {
              const lookupResult = await lookupResponse.json();
              console.log('[Popup] Lookup result:', lookupResult);

              if (lookupResult.exists && lookupResult.lead) {
                // Lead exists in database
                setCapturedLeadId(lookupResult.lead.id);
                setLeadExisted(true);

                // Check if there's outreach
                const inmailMessage = lookupResult.outreach?.find(m => m.medium === 'inmail');
                if (inmailMessage) {
                  setOutreachMessage(inmailMessage);
                  setJobStatus('Outreach ready!');
                  setAppState(STATES.OUTREACH_READY);
                } else {
                  setAppState(STATES.SUCCESS);
                }
                initialLoadDone.current = true;
                return;
              }
            }
          } catch (lookupErr) {
            console.error('[Popup] Failed to check if lead exists:', lookupErr);
            // Continue to READY state if lookup fails
          }
        }

        setAppState(STATES.READY);
        initialLoadDone.current = true;
      } catch (err) {
        console.error('Error checking page:', err);
        setError('Failed to access page content.');
        setAppState(STATES.ERROR);
        initialLoadDone.current = true;
      }
    };

    checkPage();
  }, [checkOutreachCompletion, apiUrl]);

  // Save API URL to storage
  const saveSettings = useCallback(() => {
    chrome.storage.local.set({ apiUrl });
    setShowSettings(false);
  }, [apiUrl]);

  // Capture lead (basic)
  const handleCapture = async () => {
    setAppState(STATES.CAPTURING);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/api/outreach/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...leadData,
          source: 'sales_navigator',
          priority: 'medium',
          tags: [],
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      setCapturedLeadId(result.id);
      setLeadExisted(result.existed || false);
      setAppState(STATES.SUCCESS);
    } catch (err) {
      console.error('Capture error:', err);
      setError(err.message || 'Failed to capture lead');
      setAppState(STATES.ERROR);
    }
  };

  // Capture lead and generate outreach
  const handleCaptureAndOutreach = async () => {
    setAppState(STATES.GENERATING_OUTREACH);
    setError(null);
    setJobStatus('Creating lead...');

    try {
      // Step 1: Capture lead with research
      const captureResponse = await fetch(`${apiUrl}/api/outreach/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...leadData,
          source: 'sales_navigator',
          priority: 'medium',
          tags: [],
          triggerResearch: true,
        }),
      });

      if (!captureResponse.ok) {
        throw new Error(`Capture failed: ${captureResponse.status}`);
      }

      const captureResult = await captureResponse.json();
      setCapturedLeadId(captureResult.id);
      setLeadExisted(captureResult.existed || false);

      setJobStatus('Starting research... (this may take a moment)');

      // Step 2: Wait for research to complete, then generate outreach
      // Poll for research completion
      let researchComplete = false;
      let attempts = 0;
      const maxAttempts = 30; // 60 seconds max

      while (!researchComplete && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        attempts++;

        const leadResponse = await fetch(`${apiUrl}/api/outreach/leads/${captureResult.id}`);
        if (leadResponse.ok) {
          const leadDetail = await leadResponse.json();
          // Research job sets status to 'researched' when complete
          if (leadDetail.status === 'researched') {
            researchComplete = true;
            setJobStatus('Research complete! Generating outreach...');
          } else {
            setJobStatus(`Researching... (${attempts * 2}s)`);
          }
        }
      }

      if (!researchComplete) {
        // Proceed anyway with generic outreach
        setJobStatus('Research timeout - generating with available info...');
      }

      // Step 3: Generate outreach (now synchronous with Mastra)
      setJobStatus('Generating personalized outreach...');
      const outreachResponse = await fetch(`${apiUrl}/api/outreach/leads/${captureResult.id}/outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medium: 'inmail',
          generate: true,
        }),
      });

      if (!outreachResponse.ok) {
        const errorData = await outreachResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Outreach generation failed: ${outreachResponse.status}`);
      }

      const outreachResult = await outreachResponse.json();
      setOutreachMessage(outreachResult);
      setJobStatus('Outreach ready!');
      setAppState(STATES.OUTREACH_READY);
    } catch (err) {
      console.error('Outreach error:', err);
      setError(err.message || 'Failed to generate outreach');
      setAppState(STATES.ERROR);
    }
  };

  // Copy text to clipboard with visual feedback
  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      // Reset after 2 seconds
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  // Regenerate outreach for the same lead
  const handleRegenerateOutreach = async () => {
    if (!capturedLeadId) return;

    setAppState(STATES.GENERATING_OUTREACH);
    setOutreachMessage(null);
    setJobStatus('Regenerating outreach...');
    setError(null);
    setCopiedField(null);

    try {
      const outreachResponse = await fetch(`${apiUrl}/api/outreach/leads/${capturedLeadId}/outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medium: 'inmail',
          generate: true,
        }),
      });

      if (!outreachResponse.ok) {
        const errorData = await outreachResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Outreach generation failed: ${outreachResponse.status}`);
      }

      const outreachResult = await outreachResponse.json();
      setOutreachMessage(outreachResult);
      setJobStatus('Outreach ready!');
      setAppState(STATES.OUTREACH_READY);
    } catch (err) {
      console.error('Regenerate error:', err);
      setError(err.message || 'Failed to regenerate outreach');
      setAppState(STATES.ERROR);
    }
  };

  // Reset to ready state
  const handleReset = () => {
    setAppState(STATES.READY);
    setError(null);
    setOutreachMessage(null);
    setJobStatus(null);
    setCapturedLeadId(null);
    setLeadExisted(false);
    setCopiedField(null);
    // Clear saved state
    chrome.storage.local.remove([STATE_STORAGE_KEY]);
  };

  // Open dashboard
  const openDashboard = () => {
    chrome.tabs.create({ url: `${apiUrl}/leads/${capturedLeadId}` });
  };

  return (
    <div className="popup">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
          </svg>
          <span className="header-title">Lead Capture</span>
        </div>
        <button
          className="settings-btn"
          onClick={() => setShowSettings(!showSettings)}
          title="Settings"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z"/>
          </svg>
        </button>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-panel">
          <label className="settings-label">API URL</label>
          <input
            type="text"
            className="settings-input"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="http://localhost:3004"
          />
          <button className="btn btn-secondary btn-sm" onClick={saveSettings}>
            Save
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="content">
        {/* Loading State */}
        {appState === STATES.LOADING && (
          <div className="state-container">
            <div className="spinner" />
            <p className="state-text">Loading...</p>
          </div>
        )}

        {/* Wrong Page State */}
        {appState === STATES.WRONG_PAGE && (
          <div className="state-container">
            <div className="state-icon state-icon-warning">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 14h-2V9h2m0 9h-2v-2h2M1 21h22L12 2L1 21z"/>
              </svg>
            </div>
            <h2 className="state-title">Wrong Page</h2>
            <p className="state-text">
              Navigate to a LinkedIn Sales Navigator profile page to capture a lead.
            </p>
            <p className="state-hint">
              URLs should match:<br/>
              linkedin.com/sales/lead/*<br/>
              linkedin.com/sales/people/*
            </p>
          </div>
        )}

        {/* Ready State - Lead Preview */}
        {appState === STATES.READY && leadData && (
          <div className="lead-preview">
            <div className="lead-header">
              {leadData.photoUrl ? (
                <img src={leadData.photoUrl} alt="" className="lead-photo" />
              ) : (
                <div className="lead-photo-placeholder">
                  {leadData.name?.charAt(0) || '?'}
                </div>
              )}
              <div className="lead-info">
                <h2 className="lead-name">{leadData.name}</h2>
                {leadData.title && <p className="lead-title">{leadData.title}</p>}
                {leadData.company && <p className="lead-company">{leadData.company}</p>}
              </div>
            </div>

            {leadData.location && (
              <div className="lead-detail">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5a2.5 2.5 0 0 1 0 5z"/>
                </svg>
                <span>{leadData.location}</span>
              </div>
            )}

            {leadData.linkedinUrl && (
              <div className="lead-detail lead-detail-url">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                </svg>
                <a href={leadData.linkedinUrl} target="_blank" rel="noopener noreferrer" className="lead-url">
                  {leadData.linkedinUrl.replace('https://www.linkedin.com/in/', '')}
                </a>
              </div>
            )}

            {leadData.about && (
              <p className="lead-about">{leadData.about}</p>
            )}

            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={handleCapture}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                Capture Only
              </button>
              <button className="btn btn-primary" onClick={handleCaptureAndOutreach}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5l-8-5V6l8 5l8-5v2z"/>
                </svg>
                Capture & Outreach
              </button>
            </div>
          </div>
        )}

        {/* Capturing State */}
        {appState === STATES.CAPTURING && (
          <div className="state-container">
            <div className="spinner" />
            <p className="state-text">Capturing lead...</p>
          </div>
        )}

        {/* Generating Outreach State */}
        {appState === STATES.GENERATING_OUTREACH && (
          <div className="state-container">
            <div className="spinner spinner-large" />
            <p className="state-text">{jobStatus || 'Generating outreach...'}</p>
            <p className="state-hint">This may take up to a minute</p>
          </div>
        )}

        {/* Success State */}
        {appState === STATES.SUCCESS && (
          <div className="state-container">
            <div className="state-icon state-icon-success">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41L9 16.17z"/>
              </svg>
            </div>
            <h2 className="state-title">
              {leadExisted ? 'Lead Updated!' : 'Lead Captured!'}
            </h2>
            <p className="state-text">
              {leadExisted
                ? 'This lead already existed and has been updated with the latest info.'
                : 'The lead has been saved to your dashboard.'}
            </p>
            <div className="success-actions">
              <button className="btn btn-primary" onClick={openDashboard}>
                View in Dashboard
              </button>
              <button className="btn btn-secondary" onClick={handleReset}>
                Capture Another
              </button>
            </div>
          </div>
        )}

        {/* Outreach Ready State */}
        {appState === STATES.OUTREACH_READY && outreachMessage && (
          <div className="outreach-container">
            <div className="outreach-header">
              <div className="state-icon state-icon-success state-icon-sm">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41L9 16.17z"/>
                </svg>
              </div>
              <h2 className="outreach-title">Outreach Ready!</h2>
            </div>

            {outreachMessage.subject && (
              <div className="outreach-field">
                <div className="outreach-field-header">
                  <label>Subject</label>
                  <button
                    className={`copy-btn ${copiedField === 'subject' ? 'copy-btn-success' : ''}`}
                    onClick={() => copyToClipboard(outreachMessage.subject, 'subject')}
                    title="Copy subject"
                  >
                    {copiedField === 'subject' ? (
                      <>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41L9 16.17z"/>
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 21H8V7h11m0-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m-3-4H4a2 2 0 0 0-2 2v14h2V3h12V1z"/>
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="outreach-value">{outreachMessage.subject}</div>
              </div>
            )}

            <div className="outreach-field">
              <div className="outreach-field-header">
                <label>Message</label>
                <button
                  className={`copy-btn ${copiedField === 'message' ? 'copy-btn-success' : ''}`}
                  onClick={() => copyToClipboard(outreachMessage.content, 'message')}
                  title="Copy message"
                >
                  {copiedField === 'message' ? (
                    <>
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41L9 16.17z"/>
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 21H8V7h11m0-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m-3-4H4a2 2 0 0 0-2 2v14h2V3h12V1z"/>
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <div className="outreach-message">{outreachMessage.content}</div>
            </div>

            <div className="outreach-actions">
              <button className="btn btn-secondary" onClick={handleRegenerateOutreach}>
                Regenerate
              </button>
              <button className="btn btn-primary" onClick={openDashboard}>
                View in Dashboard
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {appState === STATES.ERROR && (
          <div className="state-container">
            <div className="state-icon state-icon-error">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41z"/>
              </svg>
            </div>
            <h2 className="state-title">Error</h2>
            <p className="state-text error-text">{error}</p>
            <button className="btn btn-primary" onClick={handleReset}>
              Try Again
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

// Content script function to extract lead data from the page
function extractLeadFromPage() {
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

    // Location
    const locationEl = document.querySelector('[data-sn-view-name="feature-lead-top-card"] ._header_sqh8tm .mMJQZqEhpdGqabNZoKajosVQmvKyWxEJZmiE');
    if (locationEl?.textContent?.trim()) {
      data.location = locationEl.textContent.trim();
    }

    // About/Bio
    const aboutEl = document.querySelector('[data-sn-view-name="lead-current-role"] [data-anonymize="person-blurb"]');
    if (aboutEl?.textContent?.trim()) {
      let aboutText = aboutEl.textContent.trim();
      aboutText = aboutText.replace(/…\s*Show more\s*$/, '').trim();
      data.about = aboutText.substring(0, 500);
    }

    // LinkedIn profile URL - try multiple selectors
    const linkedinSelectors = [
      '[data-sn-view-name="feature-lead-relationship"] a[href*="linkedin.com/in/"]',
      'a[href*="linkedin.com/in/"]',
      '[data-x--lead--actions] a[href*="linkedin.com/in/"]',
      'a.link-without-visited-state[href*="linkedin.com/in/"]',
    ];

    for (const selector of linkedinSelectors) {
      const el = document.querySelector(selector);
      if (el?.href && el.href.includes('/in/')) {
        const url = new URL(el.href);
        data.linkedinUrl = `${url.origin}${url.pathname}`;
        break;
      }
    }

    if (!data.name) {
      return null;
    }

    if (data.linkedinUrl) {
      data.linkedinUrl = data.linkedinUrl.split('?')[0].split('#')[0];
    }

    return data;
  } catch (error) {
    console.error('Lead Capture: Error extracting data', error);
    return null;
  }
}

export default Popup;
