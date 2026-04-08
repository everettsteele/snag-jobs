// HopeSpot apps.js v7.1 — Dashboard, Applications, Job Board, Networking

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

let _appsData = [], _netData = [], _showHiddenNet = false;

function _authH() {
  const k = localStorage.getItem('hopespot_apikey');
  if (k) return { 'x-api-key': k, 'Content-Type': 'application/json' };
  return { 'x-auth-token': localStorage.getItem('hopespot_token')||'', 'Content-Type': 'application/json' };
}
function _authFH() {
  const k = localStorage.getItem('hopespot_apikey');
  if (k) return { 'x-api-key': k };
  return { 'x-auth-token': localStorage.getItem('hopespot_token')||'' };
}

// ================================================================
// RICH COMBINED DASHBOARD
// ================================================================
async function renderDashboard() {
  let apps = [], net = [];
  try {
    const [ar, nr] = await Promise.all([
      fetch('/api/applications', { headers: _authFH() }),
      fetch('/api/networking/events', { headers: _authFH() })
    ]);
    apps = await ar.json(); net = await nr.json();
    _appsData = apps; _netData = net;
    net = net.filter(e => !e.hidden); // exclude hidden events from all dashboard KPIs
  } catch(e) {}

  if (!STATS) { document.getElementById('main-content').innerHTML = '<div class="empty">Loading...</div>'; return; }
  const { segments, daily, totals, slaStats, sectorStats, templateStats } = STATS;

  const todayStr = (new Date()).toISOString().split('T')[0];
  const dAgo = (n) => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; };
  const wkAgo = dAgo(7), twoWkAgo = dAgo(14), moAgo = dAgo(30);

  const overallRate = totals.contacted > 0 ? Math.round((totals.inConversation/totals.contacted)*100) : 0;
  const thisWkSent = daily.filter(d => d.date >= wkAgo).reduce((s,d) => s+d.total, 0);
  const lastWkSent = daily.filter(d => d.date >= twoWkAgo && d.date < wkAgo).reduce((s,d) => s+d.total, 0);
  const sentTrend = lastWkSent > 0 ? Math.round(((thisWkSent-lastWkSent)/lastWkSent)*100) : null;
  const sla = slaStats || { target:10, dailyAvg7:0, onTrack:false };

  const aQ = apps.filter(a=>a.status==='queued').length;
  const aA = apps.filter(a=>a.status==='applied').length;
  const aC = apps.filter(a=>['confirmation_received','interviewing','offer'].includes(a.status)).length;
  const aI = apps.filter(a=>['interviewing','offer'].includes(a.status)).length;
  const aO = apps.filter(a=>a.status==='offer').length;
  const aR = apps.filter(a=>a.status==='rejected').length;
  const aNP = apps.filter(a=>a.status==='queued' && !a.drive_url).length;
  const aSubmit = apps.filter(a=>['applied','confirmation_received','interviewing','offer','rejected','no_response'].includes(a.status)).length;
  const aRespond = apps.filter(a=>['confirmation_received','interviewing','offer','rejected'].includes(a.status)).length;
  const aRR = aSubmit > 0 ? Math.round((aRespond/aSubmit)*100) : 0;
  const appsWk = apps.filter(a=>a.applied_date && a.applied_date >= wkAgo).length;
  const appsLWk = apps.filter(a=>a.applied_date && a.applied_date >= twoWkAgo && a.applied_date < wkAgo).length;
  const appTrend = appsLWk > 0 ? Math.round(((appsWk-appsLWk)/appsLWk)*100) : null;

  // net is already filtered to exclude hidden events above
  const netWk = net.filter(e=>e.start_date >= wkAgo && e.start_date <= todayStr).length;
  const netLWk = net.filter(e=>e.start_date >= twoWkAgo && e.start_date < wkAgo).length;
  const netMo = net.filter(e=>e.start_date >= moAgo && e.start_date <= todayStr).length;
  const netTrend = netLWk > 0 ? Math.round(((netWk-netLWk)/netLWk)*100) : null;
  const allSteps = net.flatMap(e => (e.next_steps||[]));
  const pendSteps = allSteps.filter(ns=>!ns.done).length;
  const overSteps = allSteps.filter(ns=>!ns.done && ns.due_date && ns.due_date <= todayStr).length;
  const noNotes = net.filter(e=>e.start_date >= dAgo(14) && e.start_date <= todayStr && !(e.notes||'').trim()).length;
  const netContacts = [...new Set(net.flatMap(e=>(e.contacts||[]).filter(c=>c.email).map(c=>c.email.toLowerCase())))].length;

  const tw = (pct, rev=false) => {
    if (pct===null||pct===undefined) return '';
    const good = rev ? pct<=0 : pct>=0;
    return `<span style="font-size:10px;color:${good?'#10B981':'#EF4444'};font-weight:600;margin-left:3px">${pct>=0?'\u2191':'\u2193'}${Math.abs(pct)}%</span>`;
  };
  const slaChip = (ok, label) =>
    `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${ok?'#ECFDF5':'#FEF2F2'};color:${ok?'#059669':'#EF4444'};border:1px solid ${ok?'#A7F3D0':'#FECACA'}">${ok?'\u2713':'\u26A0'} ${label}</span>`;
  const kpi = (v, l, c='#1F2D3D', t='') =>
    `<div style="text-align:center"><div style="font-size:24px;font-weight:700;color:${c};line-height:1">${v}${t}</div><div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;margin-top:3px">${l}</div></div>`;

  const insights = [];
  if (aNP > 0) insights.push({ text: `${aNP} queued app${aNP>1?'s':''} need a package`, color:'#EF4444', tab:'applications' });
  if (noNotes > 0) insights.push({ text: `${noNotes} recent event${noNotes>1?'s':''} missing notes`, color:'#F59E0B', tab:'events' });
  if (overSteps > 0) insights.push({ text: `${overSteps} overdue next step${overSteps>1?'s':''}`, color:'#F59E0B', tab:'events' });
  if (DUE.length > 0) insights.push({ text: `${DUE.length} follow-up${DUE.length>1?'s':''} due today`, color:'#3B82F6', tab:'queue' });
  if (!sla.onTrack) insights.push({ text: `Outreach SLA: ${sla.dailyAvg7}/day vs ${sla.target}/day target`, color:'#EF4444', tab:'recruiters' });

  let html = '';
  if (insights.length > 0) {
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">';
    insights.forEach(ins => { html += `<button onclick="switchTab('${ins.tab}')" style="padding:4px 11px;background:${ins.color}15;border:1px solid ${ins.color}40;border-radius:20px;font-size:11px;font-weight:600;color:${ins.color};cursor:pointer">${ins.text}</button>`; });
    html += '</div>';
  }

  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:18px">';
  html += `<div class="dash-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div class="dash-card-title" style="margin:0">Email Outreach</div>${slaChip(sla.onTrack, sla.dailyAvg7+'/day')}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">${kpi(totals.contacted,'Total Sent','#1F2D3D',tw(sentTrend))}${kpi(overallRate+'%','Reply Rate',overallRate>5?'#10B981':'#6B7280')}${kpi(totals.inConversation,'In Convo','#3B82F6')}${kpi(DUE.length,'Due Today',DUE.length>3?'#EF4444':'#9CA3AF')}</div><div style="font-size:11px;color:#6B7280;padding-top:6px;border-top:1px solid #F3F4F6">This week: <strong>${thisWkSent}</strong> sent &nbsp;&middot;&nbsp; <strong>${totals.drafts}</strong> drafted</div></div>`;
  html += `<div class="dash-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div class="dash-card-title" style="margin:0">Applications</div>${slaChip(appsWk>=5, appsWk+' this wk')}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">${kpi(aQ+aA,'Pipeline',aQ>0?'#7c3aed':'#6b7280',tw(appTrend))}${kpi(aRR+'%','Response',aRR>15?'#10B981':'#6B7280')}${kpi(aI,'Interview','#d97706')}${kpi(aNP,'Needs Pkg',aNP>0?'#EF4444':'#10B981')}</div><div style="font-size:11px;color:#6B7280;padding-top:6px;border-top:1px solid #F3F4F6">${apps.length} tracked &nbsp;&middot;&nbsp; <strong>${aO}</strong> offer${aO!==1?'s':''} &nbsp;&middot;&nbsp; <strong>${aR}</strong> rejected</div></div>`;
  html += `<div class="dash-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div class="dash-card-title" style="margin:0">Networking</div>${slaChip(netWk>=2, netWk+' this wk')}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">${kpi(netMo,'30-Day Events','#1F2D3D',tw(netTrend))}${kpi(netContacts,'Contacts','#6B7280')}${kpi(overSteps,'Overdue',overSteps>0?'#EF4444':'#10B981')}${kpi(noNotes,'No Notes',noNotes>0?'#F59E0B':'#10B981')}</div><div style="font-size:11px;color:#6B7280;padding-top:6px;border-top:1px solid #F3F4F6">${net.length} visible &nbsp;&middot;&nbsp; <strong>${pendSteps}</strong> pending steps</div></div>`;
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:3fr 2fr;gap:14px;margin-bottom:16px;align-items:start">';
  const maxD = daily.length ? Math.max(...daily.map(d=>d.total),1) : 1;
  const CH = 110;
  let ci = '';
  if (!daily.length) { ci = '<div style="color:#9CA3AF;font-size:13px;padding:24px 0">No activity yet.</div>'; }
  else {
    let bars = '';
    daily.slice(-14).forEach(d => {
      const tH = Math.round((d.total/maxD)*CH);
      const rH = d.total>0?Math.round((d.recruiters/d.total)*tH):0;
      const cH = d.total>0?Math.round((d.ceos/d.total)*tH):0;
      const vH = tH-rH-cH;
      const lbl = new Date(d.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
      bars += `<div class="chart-col" style="height:${tH}px"><div class="chart-count">${d.total}</div><div class="chart-bar" style="height:${tH}px">${vH>0?`<div class="chart-seg" style="height:${vH}px;background:#10B981"></div>`:''}${cH>0?`<div class="chart-seg" style="height:${cH}px;background:#F97316"></div>`:''}${rH>0?`<div class="chart-seg" style="height:${rH}px;background:#3B82F6"></div>`:''}</div><div class="chart-label">${lbl}</div></div>`;
    });
    ci = `<div class="chart-wrap">${bars}</div><div class="legend"><div class="legend-item"><div class="legend-dot" style="background:#3B82F6"></div>Recruiters</div><div class="legend-item"><div class="legend-dot" style="background:#F97316"></div>CEOs</div><div class="legend-item"><div class="legend-dot" style="background:#10B981"></div>VCs</div></div>`;
  }
  html += `<div class="dash-card"><div class="dash-card-title">Daily Outreach Activity (14 days)</div>${ci}</div>`;

  html += '<div style="display:flex;flex-direction:column;gap:14px">';
  html += '<div class="dash-card"><div class="dash-card-title">Application Funnel</div>';
  const fSteps = [['Queued',aQ,'#7c3aed'],['Applied',aA,'#6b7280'],['Confirmed',aC,'#2563eb'],['Interview',aI,'#d97706'],['Offer',aO,'#16a34a']];
  const fMax = Math.max(...fSteps.map(s=>s[1]),1);
  fSteps.forEach(([l,v,c]) => {
    const pct = Math.max(Math.round(v/fMax*100), v>0?4:0);
    const cp = aSubmit>0&&l!=='Queued'?`<span style="color:#9CA3AF;font-weight:400;font-size:10px"> (${Math.round(v/aSubmit*100)}%)</span>`:'';
    html += `<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:#6B7280;font-weight:500">${l}</span><span style="color:${c};font-weight:700">${v}${cp}</span></div><div style="height:6px;background:#F3F4F6;border-radius:3px"><div style="height:100%;background:${c};border-radius:3px;width:${pct}%"></div></div></div>`;
  });
  html += '</div>';

  const recentEvt = net.filter(e=>e.start_date<=todayStr).slice(0,3);
  if (recentEvt.length > 0) {
    html += '<div class="dash-card"><div class="dash-card-title">Recent Events</div>';
    recentEvt.forEach(e => {
      const pS = (e.next_steps||[]).filter(ns=>!ns.done).length;
      const oS = (e.next_steps||[]).filter(ns=>!ns.done&&ns.due_date&&ns.due_date<=todayStr).length;
      const hN = (e.notes||'').trim().length > 0;
      html += `<div style="padding:7px 0;border-bottom:1px solid #F9FAFB"><div style="font-weight:600;font-size:12px;color:#1F2D3D">${e.title}</div><div style="font-size:10px;color:#9CA3AF;margin-top:2px">${e.start_date}${e.location?' \u00b7 '+e.location:''} &nbsp;\u00b7&nbsp; ${hN?'Notes \u2713':'<span style="color:#F59E0B">No notes</span>'}${oS>0?` &nbsp;\u00b7&nbsp; <span style="color:#EF4444">${oS} overdue</span>`:pS>0?` &nbsp;\u00b7&nbsp; <span style="color:#d97706">${pS} pending</span>`:''}</div></div>`;
    });
    html += '</div>';
  }
  html += '</div></div>';

  const bc = ['#3B82F6','#F97316','#10B981'];
  html += '<div class="dash-grid" style="margin-bottom:16px">';
  segments.forEach((s,i) => {
    const pct = s.contacted>0?Math.round((s.conv/s.contacted)*100):0;
    html += `<div class="dash-card"><div class="dash-card-title">${s.label}</div><div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:14px"><div><div class="big-num">${s.contacted}</div><div class="big-sub">contacted</div></div><div class="rate-circle" style="border-color:${bc[i]}"><div class="rate-pct">${pct}%</div><div class="rate-lbl">replies</div></div></div><div class="seg-row"><span class="seg-lbl">In conversation</span><span class="seg-val">${s.conv}</span></div><div class="seg-row"><span class="seg-lbl">Drafts pending</span><span class="seg-val" style="color:#8B5CF6">${s.drafts}</span></div><div class="seg-row"><span class="seg-lbl">Bounced</span><span class="seg-val" style="color:#F59E0B">${s.bounced}</span></div></div>`;
  });
  html += '</div>';

  const tmpl = templateStats||[];
  let slaHtml = `<div class="dash-card"><div class="dash-card-title">SLA Compliance</div><div style="display:flex;align-items:flex-end;gap:8px;margin-bottom:8px"><div class="sla-big ${sla.onTrack?'sla-ok':'sla-miss'}">${sla.dailyAvg7}</div><div style="font-size:13px;color:#9CA3AF;padding-bottom:5px">/ ${sla.target}/day</div></div><div style="display:flex;flex-direction:column;gap:6px;font-size:11px"><div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Email (daily avg)</span><span style="color:${sla.onTrack?'#10B981':'#EF4444'};font-weight:600">${sla.dailyAvg7}/${sla.target}</span></div><div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Applications (weekly)</span><span style="color:${appsWk>=5?'#10B981':'#EF4444'};font-weight:600">${appsWk}/5</span></div><div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Networking (weekly)</span><span style="color:${netWk>=2?'#10B981':'#EF4444'};font-weight:600">${netWk}/2</span></div></div></div>`;
  let tmplHtml = '<div class="dash-card"><div class="dash-card-title">Template A/B</div>';
  if (!tmpl.length) tmplHtml += '<div style="color:#9CA3AF;font-size:12px">No data yet.</div>';
  else tmplHtml += '<table class="perf-table"><tr><th>Ver</th><th>Sent</th><th>Replies</th><th>Rate</th></tr>' + tmpl.map(t=>`<tr><td><span class="tv-badge tv-${t.version}">${t.version}</span></td><td>${t.sent}</td><td class="hl">${t.replies}</td><td>${t.replyRate}%</td></tr>`).join('') + '</table>';
  tmplHtml += '</div>';
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">${slaHtml}${tmplHtml}</div>`;

  const sec = sectorStats||[];
  if (sec.length) html += '<div class="dash-card" style="margin-bottom:16px"><div class="dash-card-title">CEO Outreach by Sector</div><table class="perf-table"><tr><th>Sector</th><th>Sent</th><th>Replies</th><th>Rate</th></tr>' + sec.map(s=>`<tr><td><span class="sector-badge sector-${s.sector}">${s.label}</span></td><td>${s.sent}</td><td class="hl">${s.replies}</td><td>${s.replyRate}%</td></tr>`).join('') + '</table></div>';

  document.getElementById('main-content').innerHTML = html;
}

// ================================================================
// APPLICATIONS
// ================================================================
async function loadApps() {
  try { _appsData = await (await fetch('/api/applications', { headers: _authFH() })).json(); } catch(e) { _appsData = []; }
  const ab = document.getElementById('badge-applications');
  if (ab) ab.textContent = _appsData.filter(a=>!['rejected','withdrawn','offer'].includes(a.status)).length;
  renderApplications();
}

function renderApplications() {
  const today = new Date().toISOString().split('T')[0];
  const counts = {};
  _appsData.forEach(a => { counts[a.status] = (counts[a.status]||0)+1; });
  const summary = Object.entries(APP_STATUSES).filter(([k])=>counts[k]).map(([k,v])=>`<span style="padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${v.color}18;color:${v.color};border:1px solid ${v.color}30">${counts[k]} ${v.label}</span>`).join('');
  const rows = _appsData.map(app => {
    const st = APP_STATUSES[app.status]||{label:app.status,color:'#6b7280'};
    const ov = app.follow_up_date && app.follow_up_date<=today && !['rejected','offer','withdrawn'].includes(app.status);
    const lat = (app.activity||[]).slice(-1)[0];
    const actHtml = lat ? `<span style="font-size:11px;color:#9CA3AF">${lat.date}: ${lat.note||lat.type}</span>` : '';
    return `<tr style="border-bottom:1px solid #F3F4F6">
      <td style="padding:10px 0;font-weight:600;font-size:13px">${app.company}${app.status==='queued'&&!app.drive_url?` <span style="font-size:9px;background:#FEF2F2;color:#EF4444;padding:1px 5px;border-radius:3px;vertical-align:middle">NO PKG</span>`:''}</td>
      <td style="padding:10px 8px;font-size:12px;color:#6B7280">${app.role}</td>
      <td style="padding:10px 8px;font-size:12px">${app.applied_date||''}</td>
      <td style="padding:10px 8px"><select onchange="_patchApp('${app.id}',{status:this.value})" style="font-size:11px;padding:3px 5px;color:${st.color};border:1px solid ${st.color}40;border-radius:4px;background:${st.color}12;cursor:pointer">${Object.entries(APP_STATUSES).map(([k,v])=>`<option value="${k}" ${app.status===k?'selected':''}>${v.label}</option>`).join('')}</select></td>
      <td style="padding:10px 8px;font-size:12px;color:${ov?'#EF4444':'#6B7280'}">${app.follow_up_date||''}${ov?' \u26a0':''}</td>
      <td style="padding:10px 8px">${actHtml}</td>
      <td style="padding:10px 0;white-space:nowrap">
        ${app.drive_url?`<a href="${app.drive_url}" target="_blank" style="display:inline-block;padding:3px 8px;background:#16a34a;border-radius:5px;font-size:11px;color:#fff;text-decoration:none;margin-right:3px">Drive</a>`:''}
        ${app.notion_url?`<a href="${app.notion_url}" target="_blank" style="display:inline-block;padding:3px 8px;background:#f3f4f6;border-radius:5px;font-size:11px;color:#374151;text-decoration:none;margin-right:3px">Pkg</a>`:''}
        ${app.source_url?`<a href="${app.source_url}" target="_blank" style="display:inline-block;padding:3px 8px;background:#f97316;border-radius:5px;font-size:11px;color:#fff;text-decoration:none;margin-right:3px">Apply</a>`:''}
        <button onclick="_deleteApp('${app.id}')" style="padding:3px 8px;border-radius:5px;border:1px solid #FCA5A5;background:#FEF2F2;color:#EF4444;font-size:11px;cursor:pointer">&times;</button>
      </td></tr>`;
  }).join('');
  document.getElementById('main-content').innerHTML =
    `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><div><div style="font-size:22px;font-weight:700">Applications</div><div style="font-size:13px;color:#9ca3af;margin-top:2px">${_appsData.length} tracked &nbsp;&middot;&nbsp; ${_appsData.filter(a=>a.status==='queued'&&!a.drive_url).length} need a package</div></div><button onclick="_showAddAppModal()" style="padding:9px 18px;background:#f97316;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">+ Log Application</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${summary}</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr style="border-bottom:2px solid #E5E7EB"><th style="text-align:left;padding:8px 0;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Company</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Role</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Added</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Status</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Follow-up</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Activity</th><th style="padding:8px 0"></th></tr></thead>
    <tbody>${rows||'<tr><td colspan="7" style="text-align:center;padding:32px;color:#9CA3AF">No applications yet.</td></tr>'}</tbody></table></div>`;
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
  if (m) { m.style.display='none'; ['nac-company','nac-role','nac-url','nac-notion','nac-notes'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; }); }
}
async function _submitAddApp() {
  const company = document.getElementById('nac-company').value.trim();
  const role = document.getElementById('nac-role').value.trim();
  if (!company||!role) { alert('Company and role required.'); return; }
  await fetch('/api/applications', { method:'POST', headers:_authH(), body:JSON.stringify({ company, role, source_url: document.getElementById('nac-url').value.trim(), notion_url: document.getElementById('nac-notion').value.trim(), applied_date: document.getElementById('nac-date').value, notes: document.getElementById('nac-notes').value.trim() }) });
  _closeAddAppModal();
  await loadApps();
  if (typeof toast === 'function') toast('Application logged');
}

// ================================================================
// JOB BOARD
// ================================================================
async function renderJobBoard() {
  let leads = [];
  try { leads = await (await fetch('/api/job-board', { headers: _authFH() })).json(); } catch(e) {}
  const newLeads = leads.filter(l=>l.status==='new'), reviewed = leads.filter(l=>l.status==='reviewed');
  const srcColors = { jewishjobs:'#2563eb', execthread:'#7c3aed', csnetwork:'#d97706', idealist:'#16a34a', builtinatlanta:'#0891b2' };
  const srcSummary = {};
  newLeads.forEach(l => { const s = l.source_label||l.source; srcSummary[s] = (srcSummary[s]||0)+1; });
  const srcBadges = Object.entries(srcSummary).map(([s,n]) => { const c = srcColors[Object.keys(srcColors).find(k=>s.toLowerCase().includes(k.replace('atlanta','')))||'']||'#6b7280'; return `<span style="padding:3px 10px;background:${c}15;color:${c};border-radius:10px;font-size:11px;font-weight:600;border:1px solid ${c}30">${n} ${s}</span>`; }).join('');
  const row = (l) => {
    const sc = srcColors[l.source]||'#6b7280';
    return `<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:10px 14px"><div style="font-weight:600;font-size:13px">${l.title}</div><div style="font-size:11px;color:#6b7280;margin-top:2px">${l.organization||''}${l.location?' \u00b7 '+l.location:''}</div><span style="display:inline-block;margin-top:4px;padding:1px 6px;background:${sc}15;color:${sc};border-radius:4px;font-size:10px;font-weight:700">${l.source_label||l.source}</span></td><td style="padding:10px 14px;text-align:center"><span style="font-size:13px;font-weight:700;color:${l.fit_score>=7?'#16a34a':l.fit_score>=5?'#d97706':'#6b7280'}">${l.fit_score}/10</span></td><td style="padding:10px 14px;font-size:11px;color:#6b7280">${l.fit_reason}</td><td style="padding:10px 14px;font-size:11px;color:#9ca3af;white-space:nowrap">${l.date_found}</td><td style="padding:10px 14px;white-space:nowrap"><a href="${l.url}" target="_blank" style="display:inline-block;padding:3px 9px;background:#1f2d3d;border-radius:5px;font-size:11px;color:#fff;text-decoration:none;margin-right:4px">View</a>${l.status==='new'?`<button onclick="snagLead('${l.id}',this)" style="padding:3px 9px;background:#f97316;border:none;border-radius:5px;font-size:11px;color:#fff;cursor:pointer;margin-right:4px;font-weight:600">Snag</button><button onclick="updateLeadStatus('${l.id}','reviewed')" style="padding:3px 7px;background:#f3f4f6;border:none;border-radius:5px;font-size:11px;color:#374151;cursor:pointer">Skip</button>`:''}</td></tr>`;
  };
  document.getElementById('main-content').innerHTML =
    `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div><div style="font-size:22px;font-weight:700">Job Board</div><div style="font-size:13px;color:#9ca3af;margin-top:2px">JewishJobs &middot; ExecThread &middot; CoS Network &middot; Idealist &middot; Built In ATL &middot; Daily 6 AM</div></div><button onclick="triggerCrawl(this)" style="padding:9px 18px;background:#1f2d3d;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Crawl Now</button></div>
    ${srcBadges?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${srcBadges}</div>`:''}
    ${newLeads.length>0?`<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#374151;margin-bottom:8px">New (${newLeads.length}) &mdash; Snag to add to Applications</div><div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:20px"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb"><th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Role</th><th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Fit</th><th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Why</th><th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Found</th><th style="padding:10px 14px"></th></tr></thead><tbody>${newLeads.map(row).join('')}</tbody></table></div>`:'<div style="color:#9ca3af;font-size:13px;margin-bottom:20px;padding:40px;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:10px">No new leads. Hit Crawl Now to run all sources.</div>'}
    ${reviewed.length>0?`<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;margin-bottom:8px">Skipped (${reviewed.length})</div><div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;opacity:.5"><table style="width:100%;border-collapse:collapse"><tbody>${reviewed.slice(0,8).map(row).join('')}</tbody></table></div>`:''}` ;
  const badge = document.getElementById('badge-jobboard');
  if (badge) badge.textContent = newLeads.length;
}

async function updateLeadStatus(id, status) {
  await fetch('/api/job-board/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ status }) });
  await renderJobBoard();
}
async function snagLead(leadId, btn) {
  if (btn) { btn.textContent = 'Snagging...'; btn.disabled = true; }
  try {
    const r = await (await fetch('/api/job-board/snag', { method:'POST', headers:_authH(), body:JSON.stringify({ lead_id: leadId }) })).json();
    if (r.ok) { if (typeof toast === 'function') toast('Snagged \u2014 added to Applications'); await renderJobBoard(); }
    else { if (typeof toast === 'function') toast('Snag failed: '+(r.error||'unknown')); if (btn) { btn.textContent='Snag'; btn.disabled=false; } }
  } catch(e) { if (typeof toast === 'function') toast('Snag failed'); if (btn) { btn.textContent='Snag'; btn.disabled=false; } }
}
async function triggerCrawl(btn) {
  if (btn) { btn.textContent='Crawling...'; btn.disabled=true; }
  try {
    const r = await (await fetch('/api/job-board/crawl', { method:'POST', headers:_authFH() })).json();
    if (typeof toast === 'function') toast(r.newLeads+' new lead'+(r.newLeads!==1?'s':'')+' found across all sources');
    await renderJobBoard();
  } catch(e) { if (typeof toast === 'function') toast('Crawl failed'); }
  if (btn) { btn.textContent='Crawl Now'; btn.disabled=false; }
}

// ================================================================
// NETWORKING
// ================================================================
async function renderNetworking() {
  try { _netData = await (await fetch('/api/networking/events', { headers: _authFH() })).json(); } catch(e) { _netData = []; }
  const today = new Date().toISOString().split('T')[0];
  const visible = _netData.filter(e => !e.hidden);
  const hiddenEvts = _netData.filter(e => e.hidden);

  const TYPE_COLOR = { coffee:'#F97316', interview:'#2563eb', event:'#7c3aed', phone:'#10B981', video:'#0891b2', other:'#9CA3AF' };
  const TYPE_LABEL = { coffee:'Coffee', interview:'Interview', event:'Event', phone:'Phone', video:'Video', other:'Other' };
  const totalOverdue = visible.reduce((n,e) => n + (e.next_steps||[]).filter(ns=>!ns.done&&ns.due_date&&ns.due_date<=today).length, 0);
  const nb = document.getElementById('badge-networking'); if (nb) nb.textContent = totalOverdue || '';

  const renderEvent = (e, isHidden = false) => {
    const c = TYPE_COLOR[e.type]||'#9CA3AF';
    const future = e.start_date > today;
    const ovrS = (e.next_steps||[]).filter(ns=>!ns.done&&ns.due_date&&ns.due_date<=today).length;
    const pendS = (e.next_steps||[]).filter(ns=>!ns.done).length;
    return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px;margin-bottom:12px;${isHidden?'opacity:.45':''}">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:${isHidden?'0':'12px'}">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-size:14px;font-weight:600;${isHidden?'text-decoration:line-through;color:#9CA3AF':''}">${e.title}</div>
            ${!isHidden?`<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${c}15;color:${c}">${TYPE_LABEL[e.type]||e.type}</span>`:''}
            ${future&&!isHidden?'<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:#EFF6FF;color:#3B82F6">Upcoming</span>':''}
          </div>
          <div style="font-size:11px;color:#9CA3AF;margin-top:3px">${e.start_date}${e.start_time?' at '+e.start_time:''}${e.location?' \u00b7 '+e.location:''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${!isHidden&&ovrS>0?`<span style="font-size:10px;font-weight:700;color:#EF4444;background:#FEF2F2;padding:2px 7px;border-radius:4px">${ovrS} overdue</span>`:''}
          ${!isHidden&&pendS>0&&ovrS===0?`<span style="font-size:10px;color:#d97706;background:#FEF3C7;padding:2px 7px;border-radius:4px">${pendS} pending</span>`:''}
          ${isHidden
            ?`<button onclick="unhideEvent('${e.id}')" style="padding:3px 9px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:5px;font-size:11px;color:#059669;cursor:pointer">unhide</button>`
            :`<button onclick="deleteEvent('${e.id}')" style="background:none;border:none;color:#D1D5DB;cursor:pointer;font-size:16px;padding:0 2px">&times;</button>`}
        </div>
      </div>
      ${!isHidden?`
      <div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:5px">Notes</div>
        <textarea id="notes-${e.id}" onblur="saveEventNotes('${e.id}', this.value)" style="width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:12px;min-height:56px;resize:vertical;font-family:inherit;outline:none;color:#374151" placeholder="What happened? Key topics, connections, next opportunities...">${e.notes||''}</textarea>
      </div>
      ${(e.contacts||[]).length>0?`<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:5px">Contacts</div>${(e.contacts||[]).map(ct=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:#F9FAFB;border-radius:6px;margin-bottom:4px;font-size:12px"><div style="flex:1"><span style="font-weight:600">${ct.name}</span>${ct.company?` \u00b7 <span style="color:#6B7280">${ct.company}</span>`:''}${ct.role?` \u00b7 <span style="color:#9CA3AF">${ct.role}</span>`:''}</div>${ct.email?`<span style="font-family:monospace;font-size:10px;color:#F97316">${ct.email}</span>`:''}</div>`).join('')}</div>`:''}
      ${(e.next_steps||[]).length>0?`<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:5px">Next Steps</div>${(e.next_steps||[]).map((ns,idx)=>{ const isOvr = !ns.done&&ns.due_date&&ns.due_date<=today; return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #F9FAFB;font-size:12px"><input type="checkbox" ${ns.done?'checked':''} onchange="toggleNextStep('${e.id}',${idx},this.checked)" style="cursor:pointer"><span style="flex:1;color:${ns.done?'#9CA3AF':'#374151'};text-decoration:${ns.done?'line-through':'none'}">${ns.text}</span>${ns.due_date?`<span style="font-size:10px;color:${isOvr?'#EF4444':'#9CA3AF'};font-weight:${isOvr?'700':'400'}">${ns.due_date}</span>`:''}</div>`; }).join('')}</div>`:''}
      <div style="display:flex;gap:6px;margin-top:10px">
        <button onclick="addNextStep('${e.id}')" style="padding:3px 10px;background:#F3F4F6;border:none;border-radius:5px;font-size:11px;color:#374151;cursor:pointer">+ Step</button>
        <button onclick="addContactToEvent('${e.id}')" style="padding:3px 10px;background:#F3F4F6;border:none;border-radius:5px;font-size:11px;color:#374151;cursor:pointer">+ Contact</button>
        <button onclick="hideEvent('${e.id}')" style="padding:3px 10px;background:#F3F4F6;border:none;border-radius:5px;font-size:11px;color:#9CA3AF;cursor:pointer;margin-left:auto">hide</button>
      </div>`:''}
    </div>`;
  };

  const upcoming = visible.filter(e=>e.start_date>today);
  const past = visible.filter(e=>e.start_date<=today);
  const hiddenToggle = hiddenEvts.length > 0
    ? `<button onclick="_toggleHiddenNet()" style="background:none;border:none;color:#9CA3AF;font-size:12px;cursor:pointer;text-decoration:underline;margin-left:4px">${hiddenEvts.length} hidden ${_showHiddenNet?'[collapse]':'[show]'}</button>`
    : '';

  document.getElementById('main-content').innerHTML =
    `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div><div style="font-size:22px;font-weight:700">Events &amp; Meetings</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:2px">${visible.length} logged &nbsp;&middot;&nbsp; ${totalOverdue} overdue steps${hiddenToggle}</div></div>
      <button onclick="showAddEventModal()" style="padding:9px 18px;background:#F97316;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">+ Log Event</button>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin-bottom:16px">Calendar syncs during morning sync (primary calendar only). Use <strong>hide</strong> to remove non-relevant appointments from stats and this view.</p>
    ${upcoming.length>0?`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#3B82F6;margin-bottom:8px">Upcoming (${upcoming.length})</div>${upcoming.map(e=>renderEvent(e)).join('')}`:''}
    ${past.length>0?`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#374151;margin-bottom:8px;margin-top:${upcoming.length>0?'20px':'0'}">Past (${past.length})</div>${past.map(e=>renderEvent(e)).join('')}`:''}
    ${visible.length===0?'<div style="text-align:center;padding:60px;color:#9CA3AF;background:#fff;border:1px solid #E5E7EB;border-radius:10px">No events yet. Log one manually or run morning sync to import from Google Calendar.</div>':''}
    ${_showHiddenNet&&hiddenEvts.length>0?`<div style="margin-top:24px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:10px">Hidden (${hiddenEvts.length}) &nbsp;&mdash;&nbsp; not counted in stats</div>${hiddenEvts.map(e=>renderEvent(e,true)).join('')}</div>`:''}` ;
}

function _toggleHiddenNet() {
  _showHiddenNet = !_showHiddenNet;
  renderNetworking();
}
async function hideEvent(id) {
  await fetch('/api/networking/events/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ hidden: true }) });
  if (typeof toast === 'function') toast('Event hidden \u2014 excluded from stats');
  await renderNetworking();
}
async function unhideEvent(id) {
  await fetch('/api/networking/events/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ hidden: false }) });
  if (typeof toast === 'function') toast('Event restored');
  await renderNetworking();
}

async function renderNetworkingContacts() {
  try { _netData = await (await fetch('/api/networking/events', { headers: _authFH() })).json(); } catch(e) { _netData = []; }
  const contactMap = {};
  // Only show contacts from visible (non-hidden) events
  _netData.filter(e=>!e.hidden).forEach(e => {
    (e.contacts||[]).forEach(c => {
      const key = c.email ? c.email.toLowerCase() : c.name.toLowerCase();
      if (!contactMap[key]) contactMap[key] = { ...c, events: [], latestDate: '' };
      contactMap[key].events.push({ id: e.id, title: e.title, date: e.start_date });
      if (e.start_date > contactMap[key].latestDate) contactMap[key].latestDate = e.start_date;
    });
  });
  const contacts = Object.values(contactMap).sort((a,b) => b.latestDate.localeCompare(a.latestDate));
  const rows = contacts.map(c => `<tr style="border-bottom:1px solid #F3F4F6"><td style="padding:10px 0;font-weight:600;font-size:13px">${c.name}</td><td style="padding:10px 8px;font-size:12px;color:#6B7280">${c.company||''}</td><td style="padding:10px 8px;font-size:12px;color:#9CA3AF">${c.role||''}</td><td style="padding:10px 8px;font-family:monospace;font-size:11px;color:#F97316">${c.email||''}</td><td style="padding:10px 8px;font-size:11px;color:#9CA3AF">${c.latestDate}</td><td style="padding:10px 8px;font-size:11px;color:#6B7280">${c.events.map(ev=>ev.title).join(', ')}</td></tr>`).join('');
  document.getElementById('main-content').innerHTML =
    `<div style="font-size:22px;font-weight:700;margin-bottom:4px">Networking Contacts</div>
    <div style="font-size:13px;color:#9ca3af;margin-bottom:20px">${contacts.length} contacts from ${_netData.filter(e=>!e.hidden).length} events</div>
    ${contacts.length===0
      ? '<div style="text-align:center;padding:60px;color:#9CA3AF;background:#fff;border:1px solid #E5E7EB;border-radius:10px">No contacts yet. Add contacts to events.</div>'
      : `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #E5E7EB"><th style="text-align:left;padding:8px 0;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Name</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Company</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Role</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Email</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Met</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Events</th></tr></thead><tbody>${rows}</tbody></table></div>`}` ;
}

// Networking event helpers
async function saveEventNotes(id, notes) {
  await fetch('/api/networking/events/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ notes }) });
  const e = _netData.find(x=>x.id===id); if (e) e.notes = notes;
  if (typeof toast === 'function') toast('Notes saved');
}
async function toggleNextStep(eventId, idx, done) {
  const e = _netData.find(x=>x.id===eventId); if (!e) return;
  const steps = [...(e.next_steps||[])]; steps[idx] = {...steps[idx], done};
  await fetch('/api/networking/events/'+eventId, { method:'PATCH', headers:_authH(), body:JSON.stringify({ next_steps: steps }) });
  await renderNetworking();
}
async function addNextStep(eventId) {
  const text = prompt('Next step:'); if (!text) return;
  const due = prompt('Due date YYYY-MM-DD (optional):') || null;
  const e = _netData.find(x=>x.id===eventId); if (!e) return;
  const steps = [...(e.next_steps||[]), { text, done:false, due_date: due||null }];
  await fetch('/api/networking/events/'+eventId, { method:'PATCH', headers:_authH(), body:JSON.stringify({ next_steps: steps }) });
  await renderNetworking();
  if (typeof toast === 'function') toast('Step added');
}
async function addContactToEvent(eventId) {
  const name = prompt('Contact name:'); if (!name) return;
  const company = prompt('Company:') || '';
  const role = prompt('Role:') || '';
  const email = prompt('Email:') || '';
  const e = _netData.find(x=>x.id===eventId); if (!e) return;
  const contacts = [...(e.contacts||[]), { name, company, role, email }];
  await fetch('/api/networking/events/'+eventId, { method:'PATCH', headers:_authH(), body:JSON.stringify({ contacts }) });
  await renderNetworking();
  if (typeof toast === 'function') toast('Contact added');
}
async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  await fetch('/api/networking/events/'+id, { method:'DELETE', headers:_authFH() });
  await renderNetworking();
}
async function showAddEventModal() {
  const title = prompt('Event title:'); if (!title) return;
  const date = prompt('Date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]); if (!date) return;
  const type = prompt('Type: coffee / interview / event / phone / video / other', 'other') || 'other';
  const location = prompt('Location (optional):') || '';
  await fetch('/api/networking/events', { method:'POST', headers:_authH(), body:JSON.stringify({ title, start_date: date, type, location }) });
  await renderNetworking();
  if (typeof toast === 'function') toast('Event logged');
}

// ================================================================
// MODAL + BADGE INJECTION
// ================================================================
(function inject() {
  function go() {
    if (!document.getElementById('add-app-modal')) {
      const modal = document.createElement('div');
      modal.id = 'add-app-modal';
      modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1001;align-items:center;justify-content:center';
      modal.onclick = e => { if (e.target===modal) _closeAddAppModal(); };
      modal.innerHTML = '<div style="background:#fff;border-radius:12px;width:480px;max-width:90%;padding:24px;box-shadow:0 24px 64px rgba(0,0,0,.22)"><h3 style="font-size:15px;font-weight:700;margin-bottom:16px">Log Application</h3><div style="display:flex;flex-direction:column;gap:10px"><input type="text" id="nac-company" placeholder="Company *" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><input type="text" id="nac-role" placeholder="Role *" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><input type="text" id="nac-url" placeholder="Apply URL" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><input type="text" id="nac-notion" placeholder="Notion package URL" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><input type="date" id="nac-date" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><textarea id="nac-notes" placeholder="Notes" rows="2" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;resize:vertical"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px"><button onclick="_submitAddApp()" style="padding:8px 18px;background:#f97316;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer">Save</button><button onclick="_closeAddAppModal()" style="padding:8px 14px;background:#f3f4f6;color:#374151;border:none;border-radius:7px;font-size:13px;cursor:pointer">Cancel</button></div></div></div>';
      document.body.appendChild(modal);
    }
    fetch('/api/job-board?status=new', { headers: _authFH() }).then(r=>r.json()).then(leads => {
      const b = document.getElementById('badge-jobboard'); if (b) b.textContent = leads.length;
    }).catch(()=>{});
    // Badge only counts overdue steps from visible (non-hidden) events
    fetch('/api/networking/events', { headers: _authFH() }).then(r=>r.json()).then(events => {
      const today = new Date().toISOString().split('T')[0];
      const overdue = events.filter(e=>!e.hidden).reduce((n,e) => n+(e.next_steps||[]).filter(ns=>!ns.done&&ns.due_date&&ns.due_date<=today).length, 0);
      const b = document.getElementById('badge-networking'); if (b) b.textContent = overdue||'';
    }).catch(()=>{});
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', go);
  else setTimeout(go, 300);
})();
