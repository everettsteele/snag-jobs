// HopeSpot apps.js v9.0

function esc(s){if(typeof esc._memo==='undefined')esc._memo={};if(!s)return '';s=String(s);if(esc._memo[s])return esc._memo[s];var r=s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');esc._memo[s]=r;return r;}

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

var _appsData = [], _netData = [], _showHiddenNet = false, _appStatusFilter = localStorage.getItem('hs_app_filter') || 'all';

// _skippedLeadIds: IDs skipped this session, not yet confirmed persisted.
// Kept even after PATCH responds so _purgeSkippedRows() can clean up any
// re-render that races the server write.
var _skippedLeadIds = new Set();

function _authH() {
  var t = localStorage.getItem('hopespot_token') || '';
  return { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function _authFH() {
  var t = localStorage.getItem('hopespot_token') || '';
  return { 'Authorization': 'Bearer ' + t };
}
function _authToken() {
  var t = localStorage.getItem('hopespot_token') || '';
  return 'token=' + encodeURIComponent(t);
}

// Flush all pending skips to the server in one atomic batch write.
// Called before any snag or re-render that needs consistent server state.
async function _flushSkips() {
  if (_skippedLeadIds.size === 0) return;
  var ids = Array.from(_skippedLeadIds);
  var updates = ids.map(function(id) { return { id: id, status: 'reviewed' }; });
  try {
    var resp = await fetch('/api/job-board/batch-update', {
      method: 'POST',
      headers: _authH(),
      body: JSON.stringify({ updates: updates })
    });
    if (resp.ok) {
      ids.forEach(function(id) { _skippedLeadIds.delete(id); });
    }
  } catch(e) {}
}

// ================================================================
// DASHBOARD
// ================================================================
async function renderDashboard() {
  var apps = [], net = [];
  try {
    var results = await Promise.all([
      fetch('/api/applications', { headers: _authFH() }),
      fetch('/api/networking/events', { headers: _authFH() })
    ]);
    apps = await results[0].json();
    net = await results[1].json();
    _appsData = apps;
    _netData = net;
    net = net.filter(function(e) { return !e.hidden; });
  } catch(e) {}

  if (!STATS) { document.getElementById('main-content').innerHTML = '<div class="empty">Loading...</div>'; return; }
  var segments = STATS.segments, daily = STATS.daily, totals = STATS.totals, slaStats = STATS.slaStats, sectorStats = STATS.sectorStats, templateStats = STATS.templateStats;

  var todayStr = (new Date()).toISOString().split('T')[0];
  function dAgo(n) { var d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; }
  var wkAgo = dAgo(7), twoWkAgo = dAgo(14), moAgo = dAgo(30);

  var overallRate = totals.contacted > 0 ? Math.round((totals.inConversation/totals.contacted)*100) : 0;
  var thisWkSent = daily.filter(function(d){return d.date>=wkAgo;}).reduce(function(s,d){return s+d.total;},0);
  var lastWkSent = daily.filter(function(d){return d.date>=twoWkAgo&&d.date<wkAgo;}).reduce(function(s,d){return s+d.total;},0);
  var sentTrend = lastWkSent > 0 ? Math.round(((thisWkSent-lastWkSent)/lastWkSent)*100) : null;
  var sla = slaStats || { target:10, dailyAvg7:0, onTrack:false };

  var aQ = apps.filter(function(a){return a.status==='queued';}).length;
  var aA = apps.filter(function(a){return a.status==='applied';}).length;
  var aC = apps.filter(function(a){return ['confirmation_received','interviewing','offer'].indexOf(a.status)>=0;}).length;
  var aI = apps.filter(function(a){return ['interviewing','offer'].indexOf(a.status)>=0;}).length;
  var aO = apps.filter(function(a){return a.status==='offer';}).length;
  var aR = apps.filter(function(a){return a.status==='rejected';}).length;
  var aNP = apps.filter(function(a){return a.status==='queued'&&!a.drive_url;}).length;
  var aSubmit = apps.filter(function(a){return ['applied','confirmation_received','interviewing','offer','rejected','no_response'].indexOf(a.status)>=0;}).length;
  var aRespond = apps.filter(function(a){return ['confirmation_received','interviewing','offer','rejected'].indexOf(a.status)>=0;}).length;
  var aRR = aSubmit > 0 ? Math.round((aRespond/aSubmit)*100) : 0;
  var appsWk = apps.filter(function(a){return a.applied_date&&a.applied_date>=wkAgo;}).length;
  var appsLWk = apps.filter(function(a){return a.applied_date&&a.applied_date>=twoWkAgo&&a.applied_date<wkAgo;}).length;
  var appTrend = appsLWk > 0 ? Math.round(((appsWk-appsLWk)/appsLWk)*100) : null;

  var netWk = net.filter(function(e){return e.start_date>=wkAgo&&e.start_date<=todayStr;}).length;
  var netLWk = net.filter(function(e){return e.start_date>=twoWkAgo&&e.start_date<wkAgo;}).length;
  var netMo = net.filter(function(e){return e.start_date>=moAgo&&e.start_date<=todayStr;}).length;
  var netTrend = netLWk > 0 ? Math.round(((netWk-netLWk)/netLWk)*100) : null;
  var allSteps = net.reduce(function(acc,e){return acc.concat(e.next_steps||[]);}, []);
  var pendSteps = allSteps.filter(function(ns){return !ns.done;}).length;
  var overSteps = allSteps.filter(function(ns){return !ns.done&&ns.due_date&&ns.due_date<=todayStr;}).length;
  var noNotes = net.filter(function(e){return e.start_date>=dAgo(14)&&e.start_date<=todayStr&&!(e.notes||'').trim();}).length;
  var allEmails = [];
  net.forEach(function(e){(e.contacts||[]).forEach(function(c){if(c.email&&allEmails.indexOf(c.email.toLowerCase())<0)allEmails.push(c.email.toLowerCase());});});
  var netContacts = allEmails.length;

  function tw(pct, rev) {
    if (pct===null||pct===undefined) return '';
    var good = rev ? pct<=0 : pct>=0;
    return '<span style="font-size:10px;color:' + (good?'#10B981':'#EF4444') + ';font-weight:600;margin-left:3px">' + (pct>=0?'\u2191':'\u2193') + Math.abs(pct) + '%</span>';
  }
  function slaChip(ok, label) {
    return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:' + (ok?'#ECFDF5':'#FEF2F2') + ';color:' + (ok?'#059669':'#EF4444') + ';border:1px solid ' + (ok?'#A7F3D0':'#FECACA') + '">' + (ok?'\u2713':'\u26A0') + ' ' + label + '</span>';
  }
  function kpi(v, l, c, t) {
    c = c || '#1F2D3D'; t = t || '';
    return '<div style="text-align:center"><div style="font-size:24px;font-weight:700;color:' + c + ';line-height:1">' + v + t + '</div><div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;margin-top:3px">' + l + '</div></div>';
  }

  var insights = [];
  if (aNP > 0) insights.push({ text: aNP + ' queued app' + (aNP>1?'s':'') + ' need a package', color:'#EF4444', tab:'applications' });
  if (noNotes > 0) insights.push({ text: noNotes + ' recent event' + (noNotes>1?'s':'') + ' missing notes', color:'#F59E0B', tab:'events' });
  if (overSteps > 0) insights.push({ text: overSteps + ' overdue next step' + (overSteps>1?'s':''), color:'#F59E0B', tab:'events' });
  if (DUE.length > 0) insights.push({ text: DUE.length + ' follow-up' + (DUE.length>1?'s':'') + ' due today', color:'#3B82F6', tab:'queue' });
  if (!sla.onTrack) insights.push({ text: 'Outreach SLA: ' + sla.dailyAvg7 + '/day vs ' + sla.target + '/day target', color:'#EF4444', tab:'recruiters' });

  var html = '';
  if (insights.length > 0) {
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">';
    insights.forEach(function(ins) { html += '<button onclick="switchTab(\'' + ins.tab + '\')" style="padding:4px 11px;background:' + ins.color + '15;border:1px solid ' + ins.color + '40;border-radius:20px;font-size:11px;font-weight:600;color:' + ins.color + ';cursor:pointer">' + ins.text + '</button>'; });
    html += '</div>';
  }

  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:18px">';
  html += '<div class="dash-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div class="dash-card-title" style="margin:0">Email Outreach</div>' + slaChip(sla.onTrack, sla.dailyAvg7+'/day') + '</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">' + kpi(totals.contacted,'Total Sent','#1F2D3D',tw(sentTrend)) + kpi(overallRate+'%','Reply Rate',overallRate>5?'#10B981':'#6B7280') + kpi(totals.inConversation,'In Convo','#3B82F6') + kpi(DUE.length,'Due Today',DUE.length>3?'#EF4444':'#9CA3AF') + '</div><div style="font-size:11px;color:#6B7280;padding-top:6px;border-top:1px solid #F3F4F6">This week: <strong>' + thisWkSent + '</strong> sent &nbsp;&middot;&nbsp; <strong>' + totals.drafts + '</strong> drafted</div></div>';
  html += '<div class="dash-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div class="dash-card-title" style="margin:0">Applications</div>' + slaChip(appsWk>=5, appsWk+' this wk') + '</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">' + kpi(aQ+aA,'Pipeline',aQ>0?'#7c3aed':'#6b7280',tw(appTrend)) + kpi(aRR+'%','Response',aRR>15?'#10B981':'#6B7280') + kpi(aI,'Interview','#d97706') + kpi(aNP,'Needs Pkg',aNP>0?'#EF4444':'#10B981') + '</div><div style="font-size:11px;color:#6B7280;padding-top:6px;border-top:1px solid #F3F4F6">' + apps.length + ' tracked &nbsp;&middot;&nbsp; <strong>' + aO + '</strong> offer' + (aO!==1?'s':'') + ' &nbsp;&middot;&nbsp; <strong>' + aR + '</strong> rejected</div></div>';
  html += '<div class="dash-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div class="dash-card-title" style="margin:0">Networking</div>' + slaChip(netWk>=2, netWk+' this wk') + '</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">' + kpi(netMo,'30-Day Events','#1F2D3D',tw(netTrend)) + kpi(netContacts,'Contacts','#6B7280') + kpi(overSteps,'Overdue',overSteps>0?'#EF4444':'#10B981') + kpi(noNotes,'No Notes',noNotes>0?'#F59E0B':'#10B981') + '</div><div style="font-size:11px;color:#6B7280;padding-top:6px;border-top:1px solid #F3F4F6">' + net.length + ' visible &nbsp;&middot;&nbsp; <strong>' + pendSteps + '</strong> pending steps</div></div>';
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:3fr 2fr;gap:14px;margin-bottom:16px;align-items:start">';
  var maxD = daily.length ? Math.max.apply(null, daily.map(function(d){return d.total;})) : 1;
  if (maxD < 1) maxD = 1;
  var CH = 110;
  var ci = '';
  if (!daily.length) { ci = '<div style="color:#9CA3AF;font-size:13px;padding:24px 0">No activity yet.</div>'; }
  else {
    var bars = '';
    daily.slice(-14).forEach(function(d) {
      var tH = Math.round((d.total/maxD)*CH);
      var rH = d.total>0?Math.round((d.recruiters/d.total)*tH):0;
      var cH = d.total>0?Math.round((d.ceos/d.total)*tH):0;
      var vH = tH-rH-cH;
      var lbl = new Date(d.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
      bars += '<div class="chart-col" style="height:'+tH+'px"><div class="chart-count">'+d.total+'</div><div class="chart-bar" style="height:'+tH+'px">'+(vH>0?'<div class="chart-seg" style="height:'+vH+'px;background:#10B981"></div>':'')+(cH>0?'<div class="chart-seg" style="height:'+cH+'px;background:#F97316"></div>':'')+(rH>0?'<div class="chart-seg" style="height:'+rH+'px;background:#3B82F6"></div>':'')+'</div><div class="chart-label">'+lbl+'</div></div>';
    });
    ci = '<div class="chart-wrap">'+bars+'</div><div class="legend"><div class="legend-item"><div class="legend-dot" style="background:#3B82F6"></div>Recruiters</div><div class="legend-item"><div class="legend-dot" style="background:#F97316"></div>CEOs</div><div class="legend-item"><div class="legend-dot" style="background:#10B981"></div>VCs</div></div>';
  }
  html += '<div class="dash-card"><div class="dash-card-title">Daily Outreach Activity (14 days)</div>'+ci+'</div>';

  html += '<div style="display:flex;flex-direction:column;gap:14px">';
  html += '<div class="dash-card"><div class="dash-card-title">Application Funnel</div>';
  var fSteps = [['Queued',aQ,'#7c3aed'],['Applied',aA,'#6b7280'],['Confirmed',aC,'#2563eb'],['Interview',aI,'#d97706'],['Offer',aO,'#16a34a']];
  var fMax = Math.max.apply(null, fSteps.map(function(s){return s[1];}));
  if (fMax < 1) fMax = 1;
  fSteps.forEach(function(s) {
    var l=s[0],v=s[1],c=s[2];
    var pct = Math.max(Math.round(v/fMax*100), v>0?4:0);
    var cp = aSubmit>0&&l!=='Queued' ? '<span style="color:#9CA3AF;font-weight:400;font-size:10px"> ('+Math.round(v/aSubmit*100)+'%)</span>' : '';
    html += '<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:#6B7280;font-weight:500">'+l+'</span><span style="color:'+c+';font-weight:700">'+v+cp+'</span></div><div style="height:6px;background:#F3F4F6;border-radius:3px"><div style="height:100%;background:'+c+';border-radius:3px;width:'+pct+'%"></div></div></div>';
  });
  html += '</div>';

  var recentEvt = net.filter(function(e){return e.start_date<=todayStr;}).slice(0,3);
  if (recentEvt.length > 0) {
    html += '<div class="dash-card"><div class="dash-card-title">Recent Events</div>';
    recentEvt.forEach(function(e) {
      var pS = (e.next_steps||[]).filter(function(ns){return !ns.done;}).length;
      var oS = (e.next_steps||[]).filter(function(ns){return !ns.done&&ns.due_date&&ns.due_date<=todayStr;}).length;
      var hN = (e.notes||'').trim().length > 0;
      html += '<div style="padding:7px 0;border-bottom:1px solid #F9FAFB"><div style="font-weight:600;font-size:12px;color:#1F2D3D">'+esc(e.title)+'</div><div style="font-size:10px;color:#9CA3AF;margin-top:2px">'+esc(e.start_date)+(e.location?' \u00b7 '+esc(e.location):'')+' &nbsp;\u00b7&nbsp; '+(hN?'Notes \u2713':'<span style="color:#F59E0B">No notes</span>')+(oS>0?' &nbsp;\u00b7&nbsp; <span style="color:#EF4444">'+oS+' overdue</span>':(pS>0?' &nbsp;\u00b7&nbsp; <span style="color:#d97706">'+pS+' pending</span>':''))+'</div></div>';
    });
    html += '</div>';
  }
  html += '</div></div>';

  var bc = ['#3B82F6','#F97316','#10B981'];
  html += '<div class="dash-grid" style="margin-bottom:16px">';
  segments.forEach(function(s,i) {
    var pct = s.contacted>0?Math.round((s.conv/s.contacted)*100):0;
    html += '<div class="dash-card"><div class="dash-card-title">'+s.label+'</div><div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:14px"><div><div class="big-num">'+s.contacted+'</div><div class="big-sub">contacted</div></div><div class="rate-circle" style="border-color:'+bc[i]+'"><div class="rate-pct">'+pct+'%</div><div class="rate-lbl">replies</div></div></div><div class="seg-row"><span class="seg-lbl">In conversation</span><span class="seg-val">'+s.conv+'</span></div><div class="seg-row"><span class="seg-lbl">Drafts pending</span><span class="seg-val" style="color:#8B5CF6">'+s.drafts+'</span></div><div class="seg-row"><span class="seg-lbl">Bounced</span><span class="seg-val" style="color:#F59E0B">'+s.bounced+'</span></div></div>';
  });
  html += '</div>';

  var tmpl = templateStats||[];
  var slaHtml = '<div class="dash-card"><div class="dash-card-title">SLA Compliance</div><div style="display:flex;align-items:flex-end;gap:8px;margin-bottom:8px"><div class="sla-big '+(sla.onTrack?'sla-ok':'sla-miss')+'">'+sla.dailyAvg7+'</div><div style="font-size:13px;color:#9CA3AF;padding-bottom:5px">/ '+sla.target+'/day</div></div><div style="display:flex;flex-direction:column;gap:6px;font-size:11px"><div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Email (daily avg)</span><span style="color:'+(sla.onTrack?'#10B981':'#EF4444')+';font-weight:600">'+sla.dailyAvg7+'/'+sla.target+'</span></div><div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Applications (weekly)</span><span style="color:'+(appsWk>=5?'#10B981':'#EF4444')+';font-weight:600">'+appsWk+'/5</span></div><div style="display:flex;justify-content:space-between"><span style="color:#6B7280">Networking (weekly)</span><span style="color:'+(netWk>=2?'#10B981':'#EF4444')+';font-weight:600">'+netWk+'/2</span></div></div></div>';
  var tmplHtml = '<div class="dash-card"><div class="dash-card-title">Template A/B</div>';
  if (!tmpl.length) tmplHtml += '<div style="color:#9CA3AF;font-size:12px">No data yet.</div>';
  else tmplHtml += '<table class="perf-table"><tr><th>Ver</th><th>Sent</th><th>Replies</th><th>Rate</th></tr>' + tmpl.map(function(t){return '<tr><td><span class="tv-badge tv-'+t.version+'">'+t.version+'</span></td><td>'+t.sent+'</td><td class="hl">'+t.replies+'</td><td>'+t.replyRate+'%</td></tr>';}).join('') + '</table>';
  tmplHtml += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">'+slaHtml+tmplHtml+'</div>';

  var sec = sectorStats||[];
  if (sec.length) html += '<div class="dash-card" style="margin-bottom:16px"><div class="dash-card-title">CEO Outreach by Sector</div><table class="perf-table"><tr><th>Sector</th><th>Sent</th><th>Replies</th><th>Rate</th></tr>' + sec.map(function(s){return '<tr><td><span class="sector-badge sector-'+s.sector+'">'+s.label+'</span></td><td>'+s.sent+'</td><td class="hl">'+s.replies+'</td><td>'+s.replyRate+'%</td></tr>';}).join('') + '</table></div>';

  document.getElementById('main-content').innerHTML = html;
}

// ================================================================
// APPLICATIONS
// ================================================================
async function loadApps() {
  try { _appsData = await (await fetch('/api/applications', { headers: _authFH() })).json(); } catch(e) { _appsData = []; }
  var ab = document.getElementById('badge-applications');
  if (ab) ab.textContent = _appsData.filter(function(a){return ['rejected','withdrawn','offer'].indexOf(a.status)<0;}).length;
  renderApplications();
}

function _setAppStatusFilter(val) { _appStatusFilter = val; localStorage.setItem('hs_app_filter', val); renderApplications(); }

function renderApplications() {
  var today = new Date().toISOString().split('T')[0];
  var counts = {};
  _appsData.forEach(function(a) { counts[a.status] = (counts[a.status]||0)+1; });

  // Filter by status
  var filtered = _appStatusFilter === 'all' ? _appsData : _appsData.filter(function(a) { return a.status === _appStatusFilter; });

  // Status filter dropdown
  var filterOpts = '<option value="all"' + (_appStatusFilter==='all'?' selected':'') + '>All (' + _appsData.length + ')</option>';
  Object.entries(APP_STATUSES).forEach(function(e) {
    var k = e[0], v = e[1], c = counts[k] || 0;
    if (c > 0) filterOpts += '<option value="'+k+'"' + (_appStatusFilter===k?' selected':'') + '>'+v.label+' ('+c+')</option>';
  });

  var rows = filtered.map(function(app) {
    var st = APP_STATUSES[app.status]||{label:app.status,color:'#6b7280'};
    var ov = app.follow_up_date&&app.follow_up_date<=today&&['rejected','offer','withdrawn'].indexOf(app.status)<0;
    var lat = (app.activity||[]).slice(-1)[0];
    var actHtml = lat ? '<span style="font-size:11px;color:#9CA3AF">'+esc(lat.date)+': '+esc(lat.note||lat.type)+'</span>' : '';
    var opts = Object.entries(APP_STATUSES).map(function(e){return '<option value="'+e[0]+'" '+(app.status===e[0]?'selected':'')+'>'+e[1].label+'</option>';}).join('');

    // Package links — always show both, disabled style when missing
    var clUrl = '/api/applications/'+app.id+'/cover-letter?'+_authToken();
    var clBtn = app.cover_letter_text
      ? '<button onclick="window.open(\''+clUrl.replace(/'/g,"\\'")+'\',\'_blank\')" style="padding:3px 8px;background:#2563eb;border:none;border-radius:5px;font-size:11px;color:#fff;cursor:pointer;margin-right:3px">Cover Letter</button>'
      : '<span style="display:inline-block;padding:3px 8px;background:#F3F4F6;border-radius:5px;font-size:11px;color:#D1D5DB;margin-right:3px" title="Run Build Queued Packages">Cover Letter</span>';
    var driveBtn = app.drive_url
      ? '<button onclick="window.open(\''+app.drive_url.replace(/'/g,"\\'")+'\',\'_blank\')" style="padding:3px 8px;background:#16a34a;border:none;border-radius:5px;font-size:11px;color:#fff;cursor:pointer;margin-right:3px">Resume</button>'
      : '<span style="display:inline-block;padding:3px 8px;background:#F3F4F6;border-radius:5px;font-size:11px;color:#D1D5DB;margin-right:3px" title="Run Build Queued Packages">Resume</span>';
    var applyBtn = app.source_url
      ? '<button onclick="window.open(\''+app.source_url.replace(/'/g,"\\'")+'\',\'_blank\')" style="padding:3px 8px;background:#f97316;border:none;border-radius:5px;font-size:11px;color:#fff;cursor:pointer;margin-right:3px">Apply</button>'
      : '';
    var variantColors = { operator:'#7c3aed', partner:'#2563eb', builder:'#d97706', innovator:'#0891b2' };
    var variantBadge = app.resume_variant
      ? ' <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:'+(variantColors[app.resume_variant]||'#6b7280')+'15;color:'+(variantColors[app.resume_variant]||'#6b7280')+';vertical-align:middle">'+app.resume_variant+'</span>'
      : '';

    return '<tr style="border-bottom:1px solid #F3F4F6">'
      +'<td style="padding:10px 0;font-weight:600;font-size:13px">'+esc(app.company)+variantBadge+'</td>'
      +'<td style="padding:10px 8px;font-size:12px;color:#6B7280">'+esc(app.role)+'</td>'
      +'<td style="padding:10px 8px;font-size:12px">'+esc(app.applied_date||'')+'</td>'
      +'<td style="padding:10px 8px"><select onchange="_patchApp(this.dataset.id,{status:this.value})" data-id="'+app.id+'" style="font-size:11px;padding:3px 5px;color:'+st.color+';border:1px solid '+st.color+'40;border-radius:4px;background:'+st.color+'12;cursor:pointer">'+opts+'</select></td>'
      +'<td style="padding:10px 8px;font-size:12px;color:'+(ov?'#EF4444':'#6B7280')+'">'+(app.follow_up_date||'')+(ov?' \u26a0':'')+'</td>'
      +'<td style="padding:10px 8px">'+actHtml+'</td>'
      +'<td style="padding:10px 0;white-space:nowrap">'
        +clBtn+driveBtn+applyBtn
        +'<button data-id="'+app.id+'" onclick="_deleteApp(this.dataset.id)" style="padding:3px 8px;border-radius:5px;border:1px solid #FCA5A5;background:#FEF2F2;color:#EF4444;font-size:11px;cursor:pointer">&times;</button>'
      +'</td></tr>';
  }).join('');
  var needsPkgCount = _appsData.filter(function(a){return a.status==='queued'&&(!a.cover_letter_text||!a.drive_url);}).length;
  var batchBtn = needsPkgCount > 0
    ? '<button onclick="_batchBuildPackages(this)" style="padding:9px 18px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-left:10px">Build Queued Packages</button>'
    : '';
  document.getElementById('main-content').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><div><div style="font-size:22px;font-weight:700">Applications</div><div style="font-size:13px;color:#9ca3af;margin-top:2px">'+_appsData.length+' tracked &nbsp;&middot;&nbsp; '+needsPkgCount+' need a package</div></div><div style="display:flex;align-items:center">'+batchBtn+'<button onclick="_showAddAppModal()" style="padding:9px 18px;background:#f97316;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-left:10px">+ Log Application</button>'+'<button onclick="window.location.href=\'/api/export/applications?format=csv&\'+_authToken()" style="padding:9px 18px;background:#6b7280;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-left:10px">Export CSV</button></div></div>'
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'
      +'<select onchange="_setAppStatusFilter(this.value)" style="padding:6px 10px;border:1px solid #E5E7EB;border-radius:7px;font-size:12px;outline:none;background:#fff;cursor:pointer">'+filterOpts+'</select>'
      +'<div style="display:flex;gap:6px;flex-wrap:wrap">'+Object.entries(APP_STATUSES).filter(function(e){return counts[e[0]];}).map(function(e){var k=e[0],v=e[1];return '<span style="padding:3px 8px;border-radius:10px;font-size:11px;font-weight:600;background:'+v.color+'12;color:'+v.color+';border:1px solid '+v.color+'25">'+counts[k]+' '+v.label+'</span>';}).join('')+'</div>'
    +'</div>'
    +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'
    +'<thead><tr style="border-bottom:2px solid #E5E7EB"><th style="text-align:left;padding:8px 0;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Company</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Role</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Added</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Status</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Follow-up</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Activity</th><th style="padding:8px 0"></th></tr></thead>'
    +'<tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;padding:32px;color:#9CA3AF">No applications yet.</td></tr>')+'</tbody></table></div>';
}

async function _setDriveUrl(id) {
  var url = prompt('Paste the Google Drive folder URL for this application:');
  if (!url || !url.trim()) return;
  try { await fetch('/api/applications/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ drive_url: url.trim() }) }); } catch(e) {}
  await loadApps();
  if (typeof toast === 'function') toast('Drive URL saved');
}

async function _batchBuildPackages(btn) {
  var needsCount = _appsData.filter(function(a){return a.status==='queued'&&(!a.cover_letter_text||!a.drive_url);}).length;
  if (!confirm('Build packages for ' + needsCount + ' queued application' + (needsCount!==1?'s':'') + '? Generates cover letters and Drive folders. Takes 2-3 minutes.')) return;
  if (btn) { btn.textContent = 'Building...'; btn.disabled = true; }
  try {
    var r = await (await fetch('/api/applications/batch-packages', { method: 'POST', headers: _authFH() })).json();
    if (r.ok) {
      if (typeof toast === 'function') toast(r.message || 'Cover letters generating in background. Refresh Applications in 3 minutes.', 6000);
      // SSE progress listener
      var evtSrc = new EventSource('/api/sse/batch-progress?' + _authToken());
      evtSrc.onmessage = function(e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type === 'complete') { evtSrc.close(); loadApps(); }
          else if (data.type === 'progress' && typeof toast === 'function') {
            toast(data.message || ('Processing ' + (data.current||'') + '/' + (data.total||'')), 4000);
          }
        } catch(err) {}
      };
      evtSrc.onerror = function() { evtSrc.close(); };
      setTimeout(function() { evtSrc.close(); }, 300000);
    } else {
      if (typeof toast === 'function') toast('Error: ' + (r.error || 'Unknown error'));
    }
  } catch(e) {
    if (typeof toast === 'function') toast('Request failed');
  }
  if (btn) { btn.textContent = 'Build Queued Packages'; btn.disabled = false; }
  setTimeout(function() { loadApps(); }, 60000);
}

async function _patchApp(id, body) {
  try { await fetch('/api/applications/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify(body) }); } catch(e) {}
  await loadApps();
  if (typeof toast === 'function') toast('Updated');
}
async function _deleteApp(id) {
  if (!confirm('Remove this application?')) return;
  try { await fetch('/api/applications/'+id, { method:'DELETE', headers:_authFH() }); } catch(e) {}
  await loadApps();
}
function _showAddAppModal() {
  var m = document.getElementById('add-app-modal');
  if (m) { m.style.display = 'flex'; document.getElementById('nac-date').value = new Date().toISOString().split('T')[0]; }
}
function _closeAddAppModal() {
  var m = document.getElementById('add-app-modal');
  if (m) { m.style.display='none'; ['nac-company','nac-role','nac-url','nac-notion','nac-notes'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';}); }
}
async function _submitAddApp() {
  var company = document.getElementById('nac-company').value.trim();
  var role = document.getElementById('nac-role').value.trim();
  if (!company||!role) { alert('Company and role required.'); return; }
  try {
    await fetch('/api/applications', { method:'POST', headers:_authH(), body:JSON.stringify({ company:company, role:role, source_url:document.getElementById('nac-url').value.trim(), notion_url:document.getElementById('nac-notion').value.trim(), applied_date:document.getElementById('nac-date').value, notes:document.getElementById('nac-notes').value.trim() }) });
  } catch(e) {}
  _closeAddAppModal();
  await loadApps();
  if (typeof toast === 'function') toast('Application logged');
}

// ================================================================
// JOB BOARD
// ================================================================
function _purgeSkippedRows() {
  _skippedLeadIds.forEach(function(id) {
    var row = document.querySelector('tr[data-lead-id="'+id+'"]');
    if (row) row.remove();
  });
}

async function renderJobBoard() {
  var leads = [];
  try {
    var r = await fetch('/api/job-board?_=' + Date.now(), { headers: _authFH() });
    if (r.status === 401) { document.getElementById('main-content').innerHTML = '<div class="empty">Auth error. Refresh the page.</div>'; return; }
    leads = await r.json();
    if (!Array.isArray(leads)) leads = [];
  } catch(e) { leads = []; if (typeof toast === 'function') toast('Failed to load job board data'); }

  var newLeads = leads.filter(function(l){return l.status==='new';});
  var srcColors = { jewishjobs:'#2563eb', execthread:'#7c3aed', csnetwork:'#d97706', idealist:'#16a34a', builtinatlanta:'#0891b2' };
  var srcSummary = {};
  newLeads.forEach(function(l) { var s = l.source_label||l.source; srcSummary[s] = (srcSummary[s]||0)+1; });
  var srcBadges = Object.entries(srcSummary).map(function(e) {
    var s=e[0],n=e[1];
    var ck = Object.keys(srcColors).find(function(k){return s.toLowerCase().indexOf(k.replace('atlanta',''))>=0;});
    var c = (ck&&srcColors[ck])||'#6b7280';
    return '<span style="padding:3px 10px;background:'+c+'15;color:'+c+';border-radius:10px;font-size:11px;font-weight:600;border:1px solid '+c+'30">'+n+' '+s+'</span>';
  }).join('');

  function row(l) {
    var sc = srcColors[l.source]||'#6b7280';
    var fc = l.fit_score>=7?'#16a34a':l.fit_score>=5?'#d97706':'#6b7280';
    var btns = '<button class="hs-snag-btn" data-lead-id="'+l.id+'" style="padding:3px 9px;background:#f97316;border:none;border-radius:5px;font-size:11px;color:#fff;cursor:pointer;margin-right:4px;font-weight:600">Snag</button>'
             + '<button class="hs-skip-btn" data-lead-id="'+l.id+'" style="padding:3px 7px;background:#f3f4f6;border:none;border-radius:5px;font-size:11px;color:#374151;cursor:pointer">Skip</button>';
    return '<tr data-lead-id="'+l.id+'" style="border-bottom:1px solid #f3f4f6">'
      +'<td style="padding:10px 14px"><div style="font-weight:600;font-size:13px">'+esc(l.title)+'</div><div style="font-size:11px;color:#6b7280;margin-top:2px">'+esc(l.organization||'')+(l.location?' \u00b7 '+esc(l.location):'')+'</div><span style="display:inline-block;margin-top:4px;padding:1px 6px;background:'+sc+'15;color:'+sc+';border-radius:4px;font-size:10px;font-weight:700">'+esc(l.source_label||l.source)+'</span></td>'
      +'<td style="padding:10px 14px;text-align:center"><span style="font-size:13px;font-weight:700;color:'+fc+'">'+l.fit_score+'/10</span></td>'
      +'<td style="padding:10px 14px;font-size:11px;color:#6b7280">'+esc(l.fit_reason)+'</td>'
      +'<td style="padding:10px 14px;font-size:11px;color:#9ca3af;white-space:nowrap">'+esc(l.date_found)+'</td>'
      +'<td style="padding:10px 14px;white-space:nowrap"><a href="'+l.url+'" target="_blank" style="display:inline-block;padding:3px 9px;background:#1f2d3d;border-radius:5px;font-size:11px;color:#fff;text-decoration:none;margin-right:4px">View</a>'+btns+'</td>'
      +'</tr>';
  }

  var tableWrap = 'style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:20px"';
  var newHtml = newLeads.length>0
    ? '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#374151;margin-bottom:8px">New ('+newLeads.length+') &mdash; Snag to add to Applications</div><div '+tableWrap+'><table style="width:100%;min-width:480px;border-collapse:collapse"><thead><tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb"><th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Role</th><th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Fit</th><th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Why</th><th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280">Found</th><th style="padding:10px 14px"></th></tr></thead><tbody>'+newLeads.map(row).join('')+'</tbody></table></div>'
    : '<div style="color:#9ca3af;font-size:13px;margin-bottom:20px;padding:40px;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:10px"><div style="margin-bottom:16px">No new leads. Run a crawl to pull from all five sources.</div><button onclick="triggerCrawl(this)" style="padding:8px 20px;background:#1f2d3d;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer">Crawl Now</button></div>';

  document.getElementById('main-content').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div><div style="font-size:22px;font-weight:700">Job Board</div><div style="font-size:13px;color:#9ca3af;margin-top:2px">JewishJobs &middot; ExecThread &middot; CoS Network &middot; Idealist &middot; Built In ATL &middot; Daily 6 AM</div></div><div style="display:flex;align-items:center;gap:8px"><button onclick="window.location.href=\'/api/export/job-board?format=csv&\'+_authToken()" style="padding:9px 18px;background:#6b7280;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Export CSV</button><button onclick="triggerCrawl(this)" style="padding:9px 18px;background:#1f2d3d;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Crawl Now</button></div></div>'
    +(srcBadges?'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">'+srcBadges+'</div>':'')
    +newHtml;

  var badge = document.getElementById('badge-jobboard');
  if (badge) badge.textContent = newLeads.length;
  _purgeSkippedRows();
}

async function snagLead(leadId, btn) {
  if (btn) { btn.textContent = 'Snagging...'; btn.disabled = true; }
  // Flush all pending skips before snagging so the re-render sees clean server state.
  await _flushSkips();
  try {
    var r = await (await fetch('/api/job-board/snag', { method:'POST', headers:_authH(), body:JSON.stringify({ lead_id:leadId }) })).json();
    if (r.ok) {
      if (typeof toast === 'function') toast('Snagged \u2014 added to Applications');
      await renderJobBoard();
    } else {
      if (typeof toast === 'function') toast('Snag failed: '+(r.error||'unknown'));
      if (btn) { btn.textContent='Snag'; btn.disabled=false; }
    }
  } catch(e) {
    if (typeof toast === 'function') toast('Snag failed');
    if (btn) { btn.textContent='Snag'; btn.disabled=false; }
  }
}

async function triggerCrawl(btn) {
  if (btn) { btn.textContent='Crawling...'; btn.disabled=true; }
  try {
    var r = await (await fetch('/api/job-board/crawl', { method:'POST', headers:_authFH() })).json();
    if (typeof toast === 'function') toast(r.message || 'Crawl started. Check back in 2-3 minutes for new leads.', 5000);
    await renderJobBoard();
  } catch(e) { if (typeof toast === 'function') toast('Crawl failed \u2014 check Railway logs'); }
  if (btn) { btn.textContent='Crawl Now'; btn.disabled=false; }
}

// ================================================================
// NETWORKING
// ================================================================
function _buildEventHtml(e, today) {
  var TYPE_COLOR = { coffee:'#F97316', interview:'#2563eb', event:'#7c3aed', phone:'#10B981', video:'#0891b2', other:'#9CA3AF' };
  var TYPE_LABEL = { coffee:'Coffee', interview:'Interview', event:'Event', phone:'Phone', video:'Video', other:'Other' };
  var c = TYPE_COLOR[e.type]||'#9CA3AF';
  var future = e.start_date > today;
  var ovrS = (e.next_steps||[]).filter(function(ns){return !ns.done&&ns.due_date&&ns.due_date<=today;}).length;
  var pendS = (e.next_steps||[]).filter(function(ns){return !ns.done;}).length;

  var h = '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px;margin-bottom:12px">';
  h += '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">';
  h += '<div style="flex:1"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div style="font-size:14px;font-weight:600">'+esc(e.title)+'</div>';
  h += '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:'+c+'15;color:'+c+'">'+esc(TYPE_LABEL[e.type]||e.type)+'</span>';
  if (future) h += '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:#EFF6FF;color:#3B82F6">Upcoming</span>';
  h += '</div><div style="font-size:11px;color:#9CA3AF;margin-top:3px">'+esc(e.start_date)+(e.start_time?' at '+esc(e.start_time):'')+(e.location?' \u00b7 '+esc(e.location):'')+'</div></div>';
  h += '<div style="display:flex;gap:6px;align-items:center">';
  if (ovrS>0) h += '<span style="font-size:10px;font-weight:700;color:#EF4444;background:#FEF2F2;padding:2px 7px;border-radius:4px">'+ovrS+' overdue</span>';
  else if (pendS>0) h += '<span style="font-size:10px;color:#d97706;background:#FEF3C7;padding:2px 7px;border-radius:4px">'+pendS+' pending</span>';
  h += '<button data-event-id="'+e.id+'" onclick="deleteEvent(this.dataset.eventId)" style="background:none;border:none;color:#D1D5DB;cursor:pointer;font-size:16px;padding:0 2px">&times;</button>';
  h += '</div></div>';

  h += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:5px">Notes</div>';
  h += '<textarea data-event-id="'+e.id+'" onblur="saveEventNotes(this.dataset.eventId, this.value)" style="width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:12px;min-height:56px;resize:vertical;font-family:inherit;outline:none;color:#374151" placeholder="What happened? Key topics, connections, next opportunities...">'+((e.notes||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'))+'</textarea></div>';

  if ((e.contacts||[]).length > 0) {
    h += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:5px">Contacts</div>';
    (e.contacts||[]).forEach(function(ct) {
      h += '<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:#F9FAFB;border-radius:6px;margin-bottom:4px;font-size:12px"><div style="flex:1"><span style="font-weight:600">'+esc(ct.name)+'</span>'+(ct.company?' \u00b7 <span style="color:#6B7280">'+esc(ct.company)+'</span>':'')+(ct.role?' \u00b7 <span style="color:#9CA3AF">'+esc(ct.role)+'</span>':'')+'</div>'+(ct.email?'<span style="font-family:monospace;font-size:10px;color:#F97316">'+esc(ct.email)+'</span>':'')+'</div>';
    });
    h += '</div>';
  }

  if ((e.next_steps||[]).length > 0) {
    h += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:5px">Next Steps</div>';
    (e.next_steps||[]).forEach(function(ns, idx) {
      var isOvr = !ns.done&&ns.due_date&&ns.due_date<=today;
      h += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #F9FAFB;font-size:12px">';
      h += '<input type="checkbox" data-event-id="'+e.id+'" data-step-idx="'+idx+'" '+(ns.done?'checked':'')+' onchange="toggleNextStep(this.dataset.eventId,+this.dataset.stepIdx,this.checked)" style="cursor:pointer">';
      h += '<span style="flex:1;color:'+(ns.done?'#9CA3AF':'#374151')+';text-decoration:'+(ns.done?'line-through':'none')+'">'+esc(ns.text)+'</span>';
      if (ns.due_date) h += '<span style="font-size:10px;color:'+(isOvr?'#EF4444':'#9CA3AF')+';font-weight:'+(isOvr?'700':'400')+'">'+ns.due_date+'</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  h += '<div style="display:flex;gap:6px;margin-top:10px">';
  h += '<button data-event-id="'+e.id+'" onclick="addNextStep(this.dataset.eventId)" style="padding:3px 10px;background:#F3F4F6;border:none;border-radius:5px;font-size:11px;color:#374151;cursor:pointer">+ Step</button>';
  h += '<button data-event-id="'+e.id+'" onclick="addContactToEvent(this.dataset.eventId)" style="padding:3px 10px;background:#F3F4F6;border:none;border-radius:5px;font-size:11px;color:#374151;cursor:pointer">+ Contact</button>';
  h += '<button data-event-id="'+e.id+'" onclick="hideEvent(this.dataset.eventId)" style="padding:3px 10px;background:#F3F4F6;border:none;border-radius:5px;font-size:11px;color:#9CA3AF;cursor:pointer;margin-left:auto">hide</button>';
  h += '</div></div>';
  return h;
}

function _buildHiddenEventHtml(e) {
  var h = '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:12px 16px;margin-bottom:8px;opacity:.45">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between">';
  h += '<div><div style="font-size:13px;font-weight:600;color:#9CA3AF;text-decoration:line-through">'+esc(e.title)+'</div>';
  h += '<div style="font-size:11px;color:#9CA3AF;margin-top:2px">'+esc(e.start_date)+(e.location?' \u00b7 '+esc(e.location):'')+'</div></div>';
  h += '<button data-event-id="'+e.id+'" onclick="unhideEvent(this.dataset.eventId)" style="padding:3px 9px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:5px;font-size:11px;color:#059669;cursor:pointer">unhide</button>';
  h += '</div></div>';
  return h;
}

async function renderNetworking() {
  try { _netData = await (await fetch('/api/networking/events', { headers: _authFH() })).json(); } catch(e) { _netData = []; if (typeof toast === 'function') toast('Failed to load networking data'); }
  var today = new Date().toISOString().split('T')[0];
  var visible = _netData.filter(function(e){return !e.hidden;});
  var hiddenEvts = _netData.filter(function(e){return e.hidden;});
  var totalOverdue = visible.reduce(function(n,e){return n+(e.next_steps||[]).filter(function(ns){return !ns.done&&ns.due_date&&ns.due_date<=today;}).length;},0);
  var nb = document.getElementById('badge-networking');
  if (nb) nb.textContent = totalOverdue || '';

  var upcoming = visible.filter(function(e){return e.start_date>today;});
  var past = visible.filter(function(e){return e.start_date<=today;});

  var hiddenToggle = hiddenEvts.length > 0
    ? '<button onclick="_toggleHiddenNet()" style="background:none;border:none;color:#9CA3AF;font-size:12px;cursor:pointer;text-decoration:underline;margin-left:4px">'+hiddenEvts.length+' hidden '+(_showHiddenNet?'[collapse]':'[show]')+'</button>'
    : '';

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">';
  html += '<div><div style="font-size:22px;font-weight:700">Events &amp; Meetings</div>';
  html += '<div style="font-size:13px;color:#9ca3af;margin-top:2px">'+visible.length+' logged &nbsp;&middot;&nbsp; '+totalOverdue+' overdue steps'+hiddenToggle+'</div></div>';
  html += '<button onclick="showAddEventModal()" style="padding:9px 18px;background:#F97316;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">+ Log Event</button></div>';
  html += '<p style="font-size:12px;color:#9CA3AF;margin-bottom:16px">Calendar syncs during morning sync (primary calendar only). Use <strong>hide</strong> to remove non-relevant appointments.</p>';

  if (upcoming.length > 0) {
    html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#3B82F6;margin-bottom:8px">Upcoming ('+upcoming.length+')</div>';
    upcoming.forEach(function(e) { html += _buildEventHtml(e, today); });
  }
  if (past.length > 0) {
    html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#374151;margin-bottom:8px;margin-top:'+(upcoming.length>0?'20px':'0')+'">Past ('+past.length+')</div>';
    past.forEach(function(e) { html += _buildEventHtml(e, today); });
  }
  if (visible.length === 0) {
    html += '<div style="text-align:center;padding:60px;color:#9CA3AF;background:#fff;border:1px solid #E5E7EB;border-radius:10px">No events yet. Log one manually or run morning sync to import from Google Calendar.</div>';
  }
  if (_showHiddenNet && hiddenEvts.length > 0) {
    html += '<div style="margin-top:24px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin-bottom:10px">Hidden ('+hiddenEvts.length+') &mdash; not counted in stats</div>';
    hiddenEvts.forEach(function(e) { html += _buildHiddenEventHtml(e); });
    html += '</div>';
  }

  document.getElementById('main-content').innerHTML = html;
}

function _toggleHiddenNet() { _showHiddenNet = !_showHiddenNet; renderNetworking(); }
async function hideEvent(id) {
  try { await fetch('/api/networking/events/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ hidden:true }) }); } catch(e) {}
  if (typeof toast === 'function') toast('Event hidden \u2014 excluded from stats');
  await renderNetworking();
}
async function unhideEvent(id) {
  try { await fetch('/api/networking/events/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ hidden:false }) }); } catch(e) {}
  if (typeof toast === 'function') toast('Event restored');
  await renderNetworking();
}

async function renderNetworkingContacts() {
  try { _netData = await (await fetch('/api/networking/events', { headers: _authFH() })).json(); } catch(e) { _netData = []; if (typeof toast === 'function') toast('Failed to load contacts data'); }
  var contactMap = {};
  _netData.filter(function(e){return !e.hidden;}).forEach(function(e) {
    (e.contacts||[]).forEach(function(c) {
      var key = c.email ? c.email.toLowerCase() : c.name.toLowerCase();
      if (!contactMap[key]) contactMap[key] = { name:c.name, company:c.company||'', role:c.role||'', email:c.email||'', events:[], latestDate:'' };
      contactMap[key].events.push({ id:e.id, title:e.title, date:e.start_date });
      if (e.start_date > contactMap[key].latestDate) contactMap[key].latestDate = e.start_date;
    });
  });
  var contacts = Object.values(contactMap).sort(function(a,b){return b.latestDate.localeCompare(a.latestDate);});
  var rows = contacts.map(function(c) {
    return '<tr style="border-bottom:1px solid #F3F4F6"><td style="padding:10px 0;font-weight:600;font-size:13px">'+esc(c.name)+'</td><td style="padding:10px 8px;font-size:12px;color:#6B7280">'+esc(c.company)+'</td><td style="padding:10px 8px;font-size:12px;color:#9CA3AF">'+esc(c.role)+'</td><td style="padding:10px 8px;font-family:monospace;font-size:11px;color:#F97316">'+esc(c.email)+'</td><td style="padding:10px 8px;font-size:11px;color:#9CA3AF">'+esc(c.latestDate)+'</td><td style="padding:10px 8px;font-size:11px;color:#6B7280">'+c.events.map(function(ev){return esc(ev.title);}).join(', ')+'</td></tr>';
  }).join('');
  document.getElementById('main-content').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><div style="font-size:22px;font-weight:700">Networking Contacts</div><button onclick="window.location.href=\'/api/export/networking?format=csv&\'+_authToken()" style="padding:9px 18px;background:#6b7280;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Export CSV</button></div>'
    +'<div style="font-size:13px;color:#9ca3af;margin-bottom:20px">'+contacts.length+' contacts from '+_netData.filter(function(e){return !e.hidden;}).length+' events</div>'
    +(contacts.length===0
      ? '<div style="text-align:center;padding:60px;color:#9CA3AF;background:#fff;border:1px solid #E5E7EB;border-radius:10px">No contacts yet.</div>'
      : '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="width:100%;min-width:520px;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #E5E7EB"><th style="text-align:left;padding:8px 0;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Name</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Company</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Role</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Email</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Met</th><th style="text-align:left;padding:8px;font-size:10px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Events</th></tr></thead><tbody>'+rows+'</tbody></table></div>');
}

async function saveEventNotes(id, notes) {
  try { await fetch('/api/networking/events/'+id, { method:'PATCH', headers:_authH(), body:JSON.stringify({ notes:notes }) }); } catch(e) {}
  var e = _netData.find(function(x){return x.id===id;}); if (e) e.notes = notes;
  if (typeof toast === 'function') toast('Notes saved');
}
async function toggleNextStep(eventId, idx, done) {
  var e = _netData.find(function(x){return x.id===eventId;}); if (!e) return;
  var steps = (e.next_steps||[]).slice(); steps[idx] = Object.assign({}, steps[idx], { done:done });
  try { await fetch('/api/networking/events/'+eventId, { method:'PATCH', headers:_authH(), body:JSON.stringify({ next_steps:steps }) }); } catch(err) {}
  await renderNetworking();
}
async function addNextStep(eventId) {
  var text = prompt('Next step:'); if (!text) return;
  var due = prompt('Due date YYYY-MM-DD (optional):') || null;
  var e = _netData.find(function(x){return x.id===eventId;}); if (!e) return;
  var steps = (e.next_steps||[]).concat([{ text:text, done:false, due_date:due||null }]);
  try { await fetch('/api/networking/events/'+eventId, { method:'PATCH', headers:_authH(), body:JSON.stringify({ next_steps:steps }) }); } catch(err) {}
  await renderNetworking();
  if (typeof toast === 'function') toast('Step added');
}
async function addContactToEvent(eventId) {
  var name = prompt('Contact name:'); if (!name) return;
  var company = prompt('Company:') || '';
  var role = prompt('Role:') || '';
  var email = prompt('Email:') || '';
  var e = _netData.find(function(x){return x.id===eventId;}); if (!e) return;
  var contacts = (e.contacts||[]).concat([{ name:name, company:company, role:role, email:email }]);
  try { await fetch('/api/networking/events/'+eventId, { method:'PATCH', headers:_authH(), body:JSON.stringify({ contacts:contacts }) }); } catch(err) {}
  await renderNetworking();
  if (typeof toast === 'function') toast('Contact added');
}
async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  try { await fetch('/api/networking/events/'+id, { method:'DELETE', headers:_authFH() }); } catch(e) {}
  await renderNetworking();
}
async function showAddEventModal() {
  var title = prompt('Event title:'); if (!title) return;
  var date = prompt('Date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]); if (!date) return;
  var type = prompt('Type: coffee / interview / event / phone / video / other', 'other') || 'other';
  var location = prompt('Location (optional):') || '';
  try { await fetch('/api/networking/events', { method:'POST', headers:_authH(), body:JSON.stringify({ title:title, start_date:date, type:type, location:location }) }); } catch(e) {}
  await renderNetworking();
  if (typeof toast === 'function') toast('Event logged');
}

// ================================================================
// WINDOW BINDINGS
// ================================================================
window.renderDashboard = renderDashboard;
window.loadApps = loadApps;
window.renderApplications = renderApplications;
window._setAppStatusFilter = _setAppStatusFilter;
window._patchApp = _patchApp;
window._deleteApp = _deleteApp;
window._setDriveUrl = _setDriveUrl;
window._showAddAppModal = _showAddAppModal;
window._closeAddAppModal = _closeAddAppModal;
window._submitAddApp = _submitAddApp;
window._batchBuildPackages = _batchBuildPackages;
window.renderJobBoard = renderJobBoard;
window.snagLead = snagLead;
window.triggerCrawl = triggerCrawl;
window.renderNetworking = renderNetworking;
window.renderNetworkingContacts = renderNetworkingContacts;
window._toggleHiddenNet = _toggleHiddenNet;
window.hideEvent = hideEvent;
window.unhideEvent = unhideEvent;
window.saveEventNotes = saveEventNotes;
window.toggleNextStep = toggleNextStep;
window.addNextStep = addNextStep;
window.addContactToEvent = addContactToEvent;
window.deleteEvent = deleteEvent;
window.showAddEventModal = showAddEventModal;

// ================================================================
// EVENT DELEGATION
// Skip: row removed from DOM immediately, ID added to _skippedLeadIds.
// The batch flush in snagLead ensures all skips are persisted before
// the snag re-render fetches fresh data from the server.
// ================================================================
document.addEventListener('click', function(e) {
  var target = e.target;
  if (!target) return;

  if (target.classList.contains('hs-skip-btn')) {
    e.stopPropagation();
    var leadId = target.getAttribute('data-lead-id');
    if (leadId) {
      _skippedLeadIds.add(leadId);
      var row = target.closest('tr');
      if (row) row.remove();
      // Fire individual PATCH too (for instant persistence when snag isn't clicked).
      // The server lock ensures these don't stomp each other.
      fetch('/api/job-board/'+leadId, { method:'PATCH', headers: (function(){ var k=localStorage.getItem('hopespot_apikey'); if(k) return {'x-api-key':k,'Content-Type':'application/json'}; return {'x-auth-token':localStorage.getItem('hopespot_token')||'','Content-Type':'application/json'}; })(), body: JSON.stringify({ status: 'reviewed' }) }).then(function(r){ if(r && r.ok) { _skippedLeadIds.delete(leadId); var b=document.getElementById('badge-jobboard'); if(b){var n=parseInt(b.textContent)||0; if(n>0)b.textContent=n-1;} if(typeof toast==='function') toast('Skipped'); } }).catch(function(){});
    }
    return;
  }

  if (target.classList.contains('hs-snag-btn')) {
    e.stopPropagation();
    var leadId = target.getAttribute('data-lead-id');
    if (leadId) snagLead(leadId, target);
    return;
  }

  if (target.classList.contains('hs-set-drive')) {
    var appId = target.getAttribute('data-app-id');
    if (appId) _setDriveUrl(appId);
    return;
  }
});

// ================================================================
// MODAL + BADGE INJECTION
// ================================================================
(function inject() {
  function go() {
    if (!document.getElementById('add-app-modal')) {
      var modal = document.createElement('div');
      modal.id = 'add-app-modal';
      modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1001;align-items:center;justify-content:center';
      modal.onclick = function(e) { if (e.target===modal) _closeAddAppModal(); };
      modal.innerHTML = '<div style="background:#fff;border-radius:12px;width:480px;max-width:90%;padding:24px;box-shadow:0 24px 64px rgba(0,0,0,.22)"><h3 style="font-size:15px;font-weight:700;margin-bottom:16px">Log Application</h3><div style="display:flex;flex-direction:column;gap:10px"><input type="text" id="nac-company" placeholder="Company *" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><input type="text" id="nac-role" placeholder="Role *" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><input type="text" id="nac-url" placeholder="Apply URL" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><input type="text" id="nac-notion" placeholder="Notion package URL" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><input type="date" id="nac-date" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;outline:none"><textarea id="nac-notes" placeholder="Notes" rows="2" style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:7px;font-size:13px;resize:vertical"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px"><button onclick="_submitAddApp()" style="padding:8px 18px;background:#f97316;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer">Save</button><button onclick="_closeAddAppModal()" style="padding:8px 14px;background:#f3f4f6;color:#374151;border:none;border-radius:7px;font-size:13px;cursor:pointer">Cancel</button></div></div></div>';
      document.body.appendChild(modal);
    }
    fetch('/api/job-board?status=new', { headers: _authFH() }).then(function(r){return r.json();}).then(function(leads) {
      var b = document.getElementById('badge-jobboard'); if (b) b.textContent = Array.isArray(leads) ? leads.length : 0;
    }).catch(function(){});
    fetch('/api/networking/events', { headers: _authFH() }).then(function(r){return r.json();}).then(function(events) {
      var today = new Date().toISOString().split('T')[0];
      var overdue = (Array.isArray(events)?events:[]).filter(function(e){return !e.hidden;}).reduce(function(n,e){return n+(e.next_steps||[]).filter(function(ns){return !ns.done&&ns.due_date&&ns.due_date<=today;}).length;},0);
      var b = document.getElementById('badge-networking'); if (b) b.textContent = overdue||'';
    }).catch(function(){});
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', go);
  else setTimeout(go, 300);
})();
