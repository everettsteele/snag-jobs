// HopeSpot Browser Extension — Popup Logic

let config = {};

async function init() {
  config = await chrome.storage.local.get(['serverUrl', 'token', 'email']);

  if (!config.serverUrl || !config.token) {
    show('setup-view');
    return;
  }

  // Verify token is still valid
  try {
    const r = await fetch(`${config.serverUrl}/api/auth/check`, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    });
    if (!r.ok) throw new Error('Invalid token');
  } catch {
    show('setup-view');
    return;
  }

  // Get current tab info
  show('snag-view');
  document.getElementById('open-app').href = config.serverUrl;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    document.getElementById('det-title').textContent = tab.title || 'Current page';
    document.getElementById('det-url').textContent = tab.url || '';

    // Try to extract company and role from content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JOB_INFO' });
      if (response) {
        if (response.company) document.getElementById('snag-company').value = response.company;
        if (response.role) document.getElementById('snag-role').value = response.role;
      }
    } catch {
      // Content script might not be loaded; use page title as fallback
      const title = tab.title || '';
      // Common patterns: "Role at Company" or "Role - Company"
      const match = title.match(/^(.+?)(?:\s+at\s+|\s*[-|–—]\s*)(.+?)(?:\s*[-|–—]|$)/i);
      if (match) {
        document.getElementById('snag-role').value = match[1].trim();
        document.getElementById('snag-company').value = match[2].trim();
      }
    }
  }
}

function show(viewId) {
  ['setup-view', 'snag-view', 'success-view'].forEach(id => {
    document.getElementById(id).style.display = id === viewId ? 'block' : 'none';
  });
}

async function doSetup() {
  const url = document.getElementById('server-url').value.trim().replace(/\/+$/, '');
  const email = document.getElementById('setup-email').value.trim();
  const password = document.getElementById('setup-password').value;
  const errorEl = document.getElementById('setup-error');
  errorEl.style.display = 'none';

  if (!url || !email || !password) {
    errorEl.textContent = 'All fields required.';
    errorEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('setup-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting...';

  try {
    const r = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Login failed');

    await chrome.storage.local.set({ serverUrl: url, token: data.token, email });
    config = { serverUrl: url, token: data.token, email };
    init(); // Re-init with connection
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = 'block';
  }

  btn.disabled = false;
  btn.textContent = 'Connect';
}

async function doSnag() {
  const company = document.getElementById('snag-company').value.trim();
  const role = document.getElementById('snag-role').value.trim();
  const notes = document.getElementById('snag-notes').value.trim();
  const errorEl = document.getElementById('snag-error');
  errorEl.style.display = 'none';

  if (!company || !role) {
    errorEl.textContent = 'Company and role are required.';
    errorEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('snag-btn');
  btn.disabled = true;
  btn.textContent = 'Snagging...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await fetch(`${config.serverUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        company,
        role,
        source_url: tab?.url || '',
        notes: notes || `Snagged via browser extension`,
      }),
    });
    const data = await r.json();
    if (data.id) {
      document.getElementById('success-msg').textContent = `${company} — ${role} added to queue.`;
      show('success-view');
    } else {
      throw new Error(data.error || 'Failed to save');
    }
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = 'block';
  }

  btn.disabled = false;
  btn.textContent = 'Snag to HopeSpot';
}

function disconnect() {
  chrome.storage.local.remove(['serverUrl', 'token', 'email']);
  config = {};
  show('setup-view');
}

init();
