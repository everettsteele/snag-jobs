// HopeSpot apps.js v6.0 — Applications, Dashboard, Job Board
// Loaded after main script in index.html.

const APP_STATUSES = {
  queued:                { label: 'Queued',       color: '#7c3aed' },
  applied:               { label: 'Applied',      color: '#6b7280' },
  confirmation_received: { label: 'Confirmed',    color: '#2563eb' },
  interviewing:          { label: 'Interviewing', color: '#d97706' },
  offer:                 { label: 'Offer',         color: '#16a34a' },
  rejected:              { label: 'Rejected',      color: '#dc2626' },
  no_response:           { label: 'No Response',  color: '#9ca3af' },
  withdrawn:             { label: 'Withdrawn',    color: '#9ca3af' }
};

let _appsData = [];

function _authH() {
  const k = localStorage.getItem('hopespot_apikey');
  if (k) return { 'x-api-key': k, 'Content-Type': 'application/json' };
  const t = localStorage.getItem('hopespot_token');
  return { 'x-auth-token': t || '', 'Content-Type': 'application/json' };
}
function _authFH() {
  const k = localStorage.getItem('hopespot_apikey');
  if (k) return { 'x-api-key': k };
  return { 'x-auth-token': localStorage.getItem('hopespot_token') || '' };
}

async function loadApps() {
  try {
    const r = await fetch('/api/applications', { headers: _authFH() });
    _appsData = await r.json();
  } catch(e) { _appsData = []; }
  const ab = document.getElementById('badge-applications');
  if (ab) ab.textContent = _appsData.filter(a => !['rejected','withdrawn','offer'].includes(a.status)).length;
  renderApplications();
}

function renderApplications() {
  const counts = {};
  _appsData.forEach(a => { counts[a.status] = (counts[a.status]||0)+1; });
  const summary = Object.entries(APP_STATUSES)
    .filter(([k]) => counts[k])
    .map(([k,v]) => '<span style="padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;background:'+v.color+'18;color:'+v.color+';border:1px solid '+v.color+'35">'+counts[k]+' '+v.label+'</span>')
    .join('');
  const today = new Date().toISOString().split('T')[0];
  const rows = _appsData.map(app => {
    const st = APP_STATUSES[app.status] || { label: app.status, color: '#333' };
    const ov = app.follow_up_date && app.follow_up_date <= today && !['rejected','offer','withdrawn'].includes(app.status);
    const latest = (app.activity||[]).slice(-1)[0];
    const actHtml = latest ? '<span style="font-size:11px;color:#9ca3af">'+latest.date+': '+(latest.note||latest.type)+'</span>' : '';
    return '<tr style="border-bottom:1px solid #f3f4f6">'
      +'<td style="padding:10px 14px;font-weight:600;font-size:13px">'+app.company+'</td>'
      +'<td style="padding:10px 14px;font-size:12px;color:#6b7280">'+app.role+'</td>'
      +'<td style="padding:10px 14px;font-size:12px;white-space:nowrap">'+(app.applied_date||'\u2014')+'</td>'
      +'<td style="padding:10px 14px"><select onchange="_patchApp(\''+app.id+'\',{status:this.value})" style="font-size:12px;padding:3px 6px;color:'+st.color+';border:1px solid '+st.color+'50;border-radius:5px;background:'+st.color+'10;cursor:pointer">'
        +Object.entries(APP_STATUSES).map(([k,v])=>'<option value="'+k+'" '+(app.status===k?'selected':'')+'>'+v.label+'</option>').join('')
      +'</select></td>'
      +'<td style="padding:10px 14px;font-size:12px;color:'+(ov?'#dc2626':'#6b7280')+';white-space:nowrap">'+(app.follow_up_date||'\u2014')+(ov?' \u26a0':'')+'</td>'
      +'<td style="padding:10px 14px">'+actHtml+'</td>'
      +'<td style="padding:10px 14px;white-space:nowrap">'
        +(app.drive_url?'<a href="'+app.drive_url+'" target="_blank" style="display:inline-block;padding:3px 9px;background:#16a34a;border-radius:5px;font-size:11px;color:#fff;text-decoration:none;margin-right:4px">Drive</a>':'')
        +(app.notion_url?'<a href="'+app.notion_url+'" target="_blank" style="display:inline-block;padding:3px 9px;background:#f3f4f6;border-radius:5px;font-size:11px;color:#374151;text-decoration:none;margin-right:4px">Package</a>':'')
        +(app.source_url?'<a href="'+app.source_url+'" target="_blank" style="display:inline-block;padding:3px 9px;background:#f97316;border-radius:5px;font-size:11px;color:#fff;text-decoration:none;margin-right:4px">Apply</a>':'')
        +'<button onclick="_deleteApp(\''+app.id+'\')" style="padding:3px 7px;background:#fee2e2;border:none;border-radius:5px;font-size:11px;color:#dc2626;cursor:pointer">\u2715</button>'
      +'</td>'
      +'</tr>';
  }).join('');

  document.getElementById('main-content').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
    +'<div><div style="font-size:22px;font-weight:700">Job Applications</div>'
    +'<div style="font-size:13px;color:#9ca3af;margin-top:2px">'+_appsData.length+' application'+(_appsData.length!==1?'s':'')+' tracked</div></div>'
    +'<button onclick="_showAddAppModal()" style="padding:9px 18px;background:#f97316;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">+ Log Application</button>'
    +'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">'+summary+'</div>'
    +'<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">'
    +'<table style="width:100%;border-collapse:collapse">'
    +'<thead><tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb">'
    +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Company</th>'
    +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Role</th>'
    +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Date</th>'
    +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Status</th>'
    +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Follow-up</th>'
    +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Latest</th>'
    +'<th style="padding:10px 14px"></th>'
    +'</tr></thead>'
    +'<tbody>'+(rows||'<tr><td colspan="7" style="padding:48px;text-align:center;color:#9ca3af">No applications logged yet.</td></tr>')+'</tbody>'
    +'</table></div>';
}

async function _patchApp(id, body) {
  await fetch('/api/applications/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify(body) });
  await loadApps();
  if (typeof toast === 'function') toast('Updated');
}

async function _deleteApp(id) {
  if (!confirm('Remove this application?')) return;
  await fetch('/api/applications/'+id, { method:'DELETE', headers:_authFH() });
  await loadApps();
}

function _showAddAppModal() {
  const m = document.getElementById('add-app-modal');
  if (m) { m.style.display = 'flex'; document.getElementById('nac-date').value = new Date().toISOString().split('T')[0]; }
}
function _closeAddAppModal() {
  const m = document.getElementById('add-app-modal');
  if (m) { m.style.display = 'none'; ['nac-company','nac-role','nac-url','nac-notion','nac-notes'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; }); }
}
async function _submitAddApp() {
  const company = document.getElementById('nac-company').value.trim();
  const role = document.getElementById('nac-role').value.trim();
  if (!company||!role) { alert('Company and role required.'); return; }
  await fetch('/api/applications', { method:'POST', headers:_authH(), body:JSON.stringify({
    company, role,
    source_url: document.getElementById('nac-url').value.trim(),
    notion_url: document.getElementById('nac-notion').value.trim(),
    applied_date: document.getElementById('nac-date').value,
    notes: document.getElementById('nac-notes').value.trim()
  })});
  _closeAddAppModal();
  await loadApps();
  if (typeof toast === 'function') toast('Application logged');
}

// --- JOB BOARD ---

async function renderJobBoard() {
  let leads = [];
  try { leads = await (await fetch('/api/job-board', { headers: _authFH() })).json(); } catch(e) {}
  const newLeads = leads.filter(l => l.status === 'new');
  const reviewedLeads = leads.filter(l => l.status === 'reviewed');

  const srcColors = { jewishjobs:'#2563eb', execthread:'#7c3aed', csnetwork:'#d97706', idealist:'#16a34a', builtinatlanta:'#0891b2' };

  const renderRow = (lead) => {
    const srcColor = srcColors[lead.source] || '#6b7280';
    const srcLabel = lead.source_label || lead.source;
    return '<tr style="border-bottom:1px solid #f3f4f6">'
      +'<td style="padding:10px 14px">'
        +'<div style="font-weight:600;font-size:13px">'+lead.title+'</div>'
        +'<div style="font-size:11px;color:#6b7280;margin-top:2px">'
          +(lead.organization?lead.organization:'')+(lead.location?' \u00b7 '+lead.location:'')
        +'</div>'
        +'<span style="display:inline-block;margin-top:4px;padding:1px 6px;background:'+srcColor+'15;color:'+srcColor+';border-radius:4px;font-size:10px;font-weight:700">'+srcLabel+'</span>'
      +'</td>'
      +'<td style="padding:10px 14px;text-align:center"><span style="font-size:13px;font-weight:700;color:'+(lead.fit_score>=7?'#16a34a':lead.fit_score>=5?'#d97706':'#6b7280')+'">'+lead.fit_score+'/10</span></td>'
      +'<td style="padding:10px 14px;font-size:11px;color:#6b7280">'+lead.fit_reason+'</td>'
      +'<td style="padding:10px 14px;font-size:11px;color:#9ca3af;white-space:nowrap">'+lead.date_found+'</td>'
      +'<td style="padding:10px 14px;white-space:nowrap">'
        +'<a href="'+lead.url+'" target="_blank" style="display:inline-block;padding:3px 9px;background:#1f2d3d;border-radius:5px;font-size:11px;color:#fff;text-decoration:none;margin-right:4px">View</a>'
        +(lead.status==='new'?'<button onclick="snagLead(\''+lead.id+'\',this)" style="padding:3px 9px;background:#f97316;border:none;border-radius:5px;font-size:11px;color:#fff;cursor:pointer;margin-right:4px;font-weight:600">Snag</button>':'')
        +(lead.status==='new'?'<button onclick="updateLeadStatus(\''+lead.id+'\',\'reviewed\')" style="padding:3px 7px;background:#f3f4f6;border:none;border-radius:5px;font-size:11px;color:#374151;cursor:pointer;margin-right:4px">Skip</button>':'')
      +'</td>'
      +'</tr>';
  };

  const sourceSummary = {};
  leads.filter(l=>l.status==='new').forEach(l=>{ const s=l.source_label||l.source; sourceSummary[s]=(sourceSummary[s]||0)+1; });
  const sourceBadges = Object.entries(sourceSummary).map(([s,n])=>{
    const c = Object.entries(srcColors).find(([k])=>s.toLowerCase().includes(k.replace('atlanta','')))?.[1]||'#6b7280';
    return '<span style="padding:3px 10px;background:'+c+'15;color:'+c+';border-radius:10px;font-size:11px;font-weight:600;border:1px solid '+c+'30">'+n+' '+s+'</span>';
  }).join('');

  document.getElementById('main-content').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
    +'<div><div style="font-size:22px;font-weight:700">Job Board</div>'
    +'<div style="font-size:13px;color:#9ca3af;margin-top:2px">JewishJobs \u00b7 ExecThread \u00b7 CoS Network \u00b7 Idealist \u00b7 Built In ATL \u00b7 Daily 6 AM</div></div>'
    +'<button onclick="triggerCrawl(this)" style="padding:9px 18px;background:#1f2d3d;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Crawl Now</button>'
    +'</div>'
    +(sourceBadges?'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">'+sourceBadges+'</div>':'')
    +(newLeads.length > 0
      ? '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#374151;margin-bottom:8px">New ('+newLeads.length+') \u2014 Snag to add to Applications queue</div>'
        +'<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:20px">'
        +'<table style="width:100%;border-collapse:collapse">'
        +'<thead><tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb">'
        +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Role</th>'
        +'<th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Fit</th>'
        +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Why</th>'
        +'<th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Found</th>'
        +'<th style="padding:10px 14px"></th>'
        +'</tr></thead>'
        +'<tbody>'+newLeads.map(renderRow).join('')+'</tbody>'
        +'</table></div>'
      : '<div style="color:#9ca3af;font-size:13px;margin-bottom:20px;padding:40px;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:10px">No new leads. Hit Crawl Now to run all sources.</div>')
    +(reviewedLeads.length > 0
      ? '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;margin-bottom:8px">Reviewed / Skipped ('+reviewedLeads.length+')</div>'
        +'<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;opacity:.55">'
        +'<table style="width:100%;border-collapse:collapse"><tbody>'+reviewedLeads.slice(0,8).map(renderRow).join('')+'</tbody></table>'
        +'</div>'
      : '');

  updateJobBoardBadge(newLeads.length);
}

async function updateLeadStatus(id, status) {
  await fetch('/api/job-board/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ status }) });
  await renderJobBoard();
}

async function snagLead(leadId, btn) {
  if (btn) { btn.textContent = 'Snagging...'; btn.disabled = true; }
  try {
    const r = await (await fetch('/api/job-board/snag', {
      method: 'POST',
      headers: _authH(),
      body: JSON.stringify({ lead_id: leadId })
    })).json();
    if (r.ok) {
      if (typeof toast === 'function') toast('Snagged \u2014 added to Applications queue');
      await renderJobBoard();
    } else {
      if (typeof toast === 'function') toast('Snag failed: ' + (r.error || 'unknown'));
      if (btn) { btn.textContent = 'Snag'; btn.disabled = false; }
    }
  } catch(e) {
    if (typeof toast === 'function') toast('Snag failed');
    if (btn) { btn.textContent = 'Snag'; btn.disabled = false; }
  }
}

async function triggerCrawl(btn) {
  if (btn) { btn.textContent = 'Crawling...'; btn.disabled = true; }
  try {
    const r = await (await fetch('/api/job-board/crawl', { method:'POST', headers:_authFH() })).json();
    if (typeof toast === 'function') toast(r.newLeads + ' new lead' + (r.newLeads!==1?'s':'') + ' found across all sources');
    await renderJobBoard();
  } catch(e) { if (typeof toast === 'function') toast('Crawl failed'); }
  if (btn) { btn.textContent = 'Crawl Now'; btn.disabled = false; }
}

async function updateJobBoardBadge(count) {
  if (count === undefined) {
    try { const l = await (await fetch('/api/job-board?status=new', { headers: _authFH() })).json(); count = l.length; } catch(e) { count = 0; }
  }
  const badge = document.getElementById('badge-jobboard');
  if (badge) badge.textContent = count;
}

// --- END JOB BOARD ---

// Inject nav items and modal after DOM is ready
(function init() {
  function inject() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav || document.getElementById('nav-applications')) return;

    const section = document.createElement('div');
    section.innerHTML =
      '<div class="nav-section-label">Jobs</div>'
      +'<div class="nav-item" id="nav-applications" onclick="_switchToTab(\'applications\');closeSidebar()">'
        +'<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>'
        +'Applications<span class="nav-badge blue" id="badge-applications">0</span>'
      +'</div>'
      +'<div class="nav-item" id="nav-jobboard" onclick="_switchToTab(\'jobboard\');closeSidebar()">'
        +'<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
        +'Job Board<span class="nav-badge urgent" id="badge-jobboard">0</span>'
      +'</div>';
    Array.from(section.children).forEach(c => nav.appendChild(c));

    const modal = document.createElement('div');
    modal.id = 'add-app-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1001;align-items:center;justify-content:center';
    modal.onclick = e => { if (e.target === modal) _closeAddAppModal(); };
    modal.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:480px;max-width:90%;padding:24px;box-shadow:0 24px 64px rgba(0,0,0,.22)">'
      +'<h3 style="font-size:15px;font-weight:700;margin-bottom:16px">Log Application</h3>'
      +'<div style="display:flex;flex-direction:column;gap:10px">'
      +'<input type="text" id="nac-company" placeholder="Company *" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none">'
      +'<input type="text" id="nac-role" placeholder="Role *" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none">'
      +'<input type="text" id="nac-url" placeholder="Apply URL" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none">'
      +'<input type="text" id="nac-notion" placeholder="Notion package URL" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none">'
      +'<input type="date" id="nac-date" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none">'
      +'<textarea id="nac-notes" placeholder="Notes" rows="2" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;resize:vertical"></textarea>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">'
      +'<button onclick="_submitAddApp()" style="padding:8px 18px;background:#f97316;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer">Save</button>'
      +'<button onclick="_closeAddAppModal()" style="padding:8px 14px;background:#f3f4f6;color:#374151;border:none;border-radius:7px;font-size:13px;cursor:pointer">Cancel</button>'
      +'</div></div></div>';
    document.body.appendChild(modal);

    updateJobBoardBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    setTimeout(inject, 300);
  }
})();

// _switchToTab handles Applications and Job Board tabs from this file
function _switchToTab(tab) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('nav-'+tab);
  if (el) el.classList.add('active');
  const titles = {
    applications: ['Applications', 'Job application pipeline'],
    jobboard:     ['Job Board', 'JewishJobs \u00b7 ExecThread \u00b7 CoS Network \u00b7 Idealist \u00b7 Built In ATL']
  };
  const t = titles[tab];
  if (t) {
    const tb = document.getElementById('topbar-title'); if (tb) tb.textContent = t[0];
    const ts = document.getElementById('topbar-sub');   if (ts) ts.textContent = t[1];
    const mt = document.getElementById('mobile-title'); if (mt) mt.textContent = t[0];
  }
  if (tab === 'applications') loadApps();
  if (tab === 'jobboard') renderJobBoard();
}
