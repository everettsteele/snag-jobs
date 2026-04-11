// HopeSpot Content Script — extracts job info from common job board page structures

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'EXTRACT_JOB_INFO') return;

  const info = { company: '', role: '' };

  // Try structured data first (JSON-LD)
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const ld = JSON.parse(script.textContent);
      const job = ld['@type'] === 'JobPosting' ? ld : (ld['@graph'] || []).find(g => g['@type'] === 'JobPosting');
      if (job) {
        info.role = job.title || '';
        info.company = typeof job.hiringOrganization === 'string'
          ? job.hiringOrganization
          : job.hiringOrganization?.name || '';
        if (info.role) { sendResponse(info); return; }
      }
    } catch {}
  }

  // Try common DOM patterns
  const selectors = {
    role: [
      'h1.job-title', 'h1.posting-headline', '[data-qa="job-title"]',
      '.job-title h1', '.posting-headline h2', 'h1.app-title',
      'h1[class*="title"]', 'h2[class*="job-title"]',
      '.jobs-unified-top-card__job-title', // LinkedIn
      'h1',
    ],
    company: [
      '[data-qa="company-name"]', '.company-name', '.employer-name',
      '[class*="company"]', '[class*="employer"]', '[class*="org"]',
      '.jobs-unified-top-card__company-name', // LinkedIn
      'a[data-tracking-control-name="public_jobs_company-name"]',
    ],
  };

  for (const sel of selectors.role) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) { info.role = el.textContent.trim().slice(0, 200); break; }
  }

  for (const sel of selectors.company) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) { info.company = el.textContent.trim().slice(0, 200); break; }
  }

  // Fallback: parse page title ("Role at Company - Site")
  if (!info.role || !info.company) {
    const title = document.title || '';
    const match = title.match(/^(.+?)(?:\s+at\s+|\s*[-|–—]\s*)(.+?)(?:\s*[-|–—]|$)/i);
    if (match) {
      if (!info.role) info.role = match[1].trim();
      if (!info.company) info.company = match[2].trim();
    }
  }

  sendResponse(info);
});
