import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

const DAYS_TO_SHOW = 14;

export default function DashboardPage() {
  const [syncOpen, setSyncOpen] = useState(false);
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/stats'),
  });

  const { data: apps } = useQuery({
    queryKey: ['applications'],
    queryFn: () => api.get('/applications'),
  });

  const { data: events } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/networking/events'),
  });

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const segmentsArr = Array.isArray(stats?.segments) ? stats.segments : [];
  const segments = {
    recruiters: segmentsArr.find((s) => s.label === 'Recruiters')?.contacted || 0,
    ceos: segmentsArr.find((s) => s.label === 'Direct CEO')?.contacted || 0,
    vcs: segmentsArr.find((s) => s.label === 'VC Firms')?.contacted || 0,
  };
  const daily = stats?.daily || [];
  const totals = {
    ...stats?.totals,
    sent: stats?.totals?.contacted || 0,
  };
  const slaStats = stats?.slaStats || {};

  const appList = Array.isArray(apps) ? apps : apps?.applications || [];
  const eventList = Array.isArray(events) ? events : events?.events || [];

  const activeApps = appList.filter((a) => !['rejected', 'withdrawn', 'closed'].includes(a.status)).length;
  const pendingApps = appList.filter((a) => a.status === 'applied').length;
  const interviewApps = appList.filter((a) => a.status === 'interviewing').length;
  const offerApps = appList.filter((a) => a.status === 'offer').length;

  const upcomingEvents = eventList.filter((e) => new Date(e.date) >= new Date()).length;
  const pastEvents = eventList.filter((e) => new Date(e.date) < new Date()).length;
  const totalContacts = eventList.reduce((sum, e) => sum + (e.contacts?.length || 0), 0);
  const pendingSteps = eventList.reduce(
    (sum, e) => sum + (e.next_steps?.filter((s) => !s.done)?.length || 0),
    0
  );

  // Daily chart data — fill in missing days
  const todayDate = new Date();
  const chartDays = [];
  for (let i = DAYS_TO_SHOW - 1; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const found = daily.find((x) => x.date === dateStr);
    chartDays.push(found || { date: dateStr, recruiters: 0, ceos: 0, vcs: 0, applications: 0, events: 0 });
  }
  const maxDaily = Math.max(
    1,
    ...chartDays.map((d) => (d.recruiters || 0) + (d.ceos || 0) + (d.vcs || 0) + (d.applications || 0) + (d.events || 0))
  );

  return (
    <div className="space-y-6">
      {/* Morning Sync */}
      <div className="flex justify-end">
        <button
          onClick={() => setSyncOpen(true)}
          className="inline-flex items-center gap-2 bg-[#1F2D3D] hover:bg-[#2C3E50] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Morning Sync
        </button>
      </div>

      {syncOpen && <MorningSyncModal onClose={() => setSyncOpen(false)} />}

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Email Outreach */}
        <KPICard
          title="Email Outreach"
          color="#3B82F6"
          items={[
            { label: 'Total Sent', value: totals.sent || 0 },
            { label: 'Recruiters', value: segments.recruiters || 0 },
            { label: 'CEOs', value: segments.ceos || 0 },
            { label: 'VCs', value: segments.vcs || 0 },
          ]}
        />

        {/* Applications */}
        <KPICard
          title="Applications"
          color="#F97316"
          items={[
            { label: 'Active', value: activeApps },
            { label: 'Applied', value: pendingApps },
            { label: 'Interviewing', value: interviewApps },
            { label: 'Offers', value: offerApps },
          ]}
        />

        {/* Networking */}
        <KPICard
          title="Networking"
          color="#10B981"
          items={[
            { label: 'Upcoming', value: upcomingEvents },
            { label: 'Completed', value: pastEvents },
            { label: 'Contacts', value: totalContacts },
            { label: 'Pending Steps', value: pendingSteps },
          ]}
        />
      </div>

      {/* Daily Activity Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-[#1F2D3D] mb-4">Daily Activity (Last 14 Days)</h3>
        <div className="flex items-end gap-1 h-40">
          {chartDays.map((day, i) => {
            const r = day.recruiters || 0;
            const c = day.ceos || 0;
            const v = day.vcs || 0;
            const a = day.applications || 0;
            const e = day.events || 0;
            const total = r + c + v + a + e;
            const pct = (val) => (val / maxDaily) * 100;
            const dateStr = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
            const tooltipLines = [
              `${new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
              r > 0 && `Recruiters: ${r}`,
              c > 0 && `CEOs: ${c}`,
              v > 0 && `VCs: ${v}`,
              a > 0 && `Applications: ${a}`,
              e > 0 && `Events: ${e}`,
              total === 0 && 'No activity',
            ].filter(Boolean);
            return (
              <div
                key={i}
                className="flex-1 flex flex-col items-center gap-1 group relative cursor-default"
                title={tooltipLines.join('\n')}
              >
                <div className="w-full flex flex-col-reverse" style={{ height: '128px' }}>
                  {r > 0 && <div className="w-full bg-blue-500" style={{ height: `${pct(r)}%` }} />}
                  {c > 0 && <div className="w-full bg-[#F97316]" style={{ height: `${pct(c)}%` }} />}
                  {v > 0 && <div className="w-full bg-green-500" style={{ height: `${pct(v)}%` }} />}
                  {a > 0 && <div className="w-full bg-purple-500" style={{ height: `${pct(a)}%` }} />}
                  {e > 0 && <div className="w-full bg-amber-500 rounded-t-sm" style={{ height: `${pct(e)}%` }} />}
                  {total === 0 && (
                    <div className="w-full bg-gray-100 rounded-t-sm" style={{ height: '2px' }} />
                  )}
                </div>
                <span className="text-[9px] text-gray-400 truncate w-full text-center">
                  {dateStr}
                </span>
                {/* Hover tooltip */}
                <div className="hidden group-hover:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[#1F2D3D] text-white text-xs rounded px-2 py-1.5 whitespace-nowrap z-10 shadow-lg pointer-events-none">
                  <div className="font-semibold">{tooltipLines[0]}</div>
                  {tooltipLines.slice(1).map((line, j) => <div key={j}>{line}</div>)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          <Legend color="bg-blue-500" label="Recruiters" />
          <Legend color="bg-[#F97316]" label="CEOs" />
          <Legend color="bg-green-500" label="VCs" />
          <Legend color="bg-purple-500" label="Applications" />
          <Legend color="bg-amber-500" label="Events" />
        </div>
      </div>

      {/* Snag Metrics */}
      <SnagMetricsCard />
    </div>
  );
}

function SnagMetricsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['snag-metrics'],
    queryFn: () => api.get('/snag-metrics'),
  });

  if (isLoading || !data) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-[#1F2D3D]">Snag Metrics</h3>
        <a href="/settings" className="text-xs text-gray-500 hover:text-[#F97316]">
          Edit targets →
        </a>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Your progress this week against the targets you set in Preferences. Green = on track, amber = behind, red = well off pace.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricBar metric={data.outreach} />
        <MetricBar metric={data.applications} />
        <MetricBar metric={data.events} />
        <MetricBar metric={data.followups} />
      </div>
    </div>
  );
}

function MetricBar({ metric }) {
  if (!metric) return null;
  const { count, target, label, inverted } = metric;
  const pct = target > 0 ? Math.min(100, Math.round((count / target) * 100)) : 0;
  // For inverted metrics (fewer is better, e.g. overdue follow-ups), flip the color logic
  const color = inverted
    ? (count === 0 ? 'bg-green-500' : count <= Math.ceil(target / 2) ? 'bg-amber-500' : 'bg-red-500')
    : (pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500');
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-[#1F2D3D]">
          {count}{target > 0 && <span className="text-gray-400"> / {target}</span>}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function KPICard({ title, color, items }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="text-sm font-semibold text-[#1F2D3D]">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="text-2xl font-bold text-[#1F2D3D]">{item.value}</div>
            <div className="text-xs text-gray-500">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-3 h-3 rounded-sm ${color}`} />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

function MorningSyncModal({ onClose }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [runResult, setRunResult] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['morning-sync'],
    queryFn: () => api.get('/morning-sync/status'),
  });

  const runMutation = useMutation({
    mutationFn: () => api.post('/morning-sync/run'),
    onSuccess: (resp) => {
      setRunResult(resp.summary);
      queryClient.invalidateQueries({ queryKey: ['morning-sync'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['job-board'] });
      const s = resp.summary;
      toast(
        `Sync done — ${s.outreach?.totalDrafted || 0} drafted · ${s.emails?.generated || 0} AI emails · ${s.crawl?.newLeads || 0} new leads`
      );
    },
    onError: (err) => toast(err.message || 'Morning sync failed', 'error'),
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-[#1F2D3D]">Morning Sync</h2>
            <p className="text-xs text-gray-500 mt-0.5">Run the morning routine and see today's priorities.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none cursor-pointer">×</button>
        </div>

        {/* Run action */}
        <div className="bg-gradient-to-r from-[#1F2D3D] to-[#2C3E50] px-6 py-4 text-white">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Run Morning Routine</div>
              <div className="text-xs text-white/70 mt-0.5">
                Allocates today's outreach queue, generates AI drafts, and crawls job boards.
              </div>
            </div>
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {runMutation.isPending ? 'Running...' : 'Run Now'}
            </button>
          </div>
          {runResult && (
            <div className="mt-3 pt-3 border-t border-white/10 text-xs space-y-2">
              {/* Outreach */}
              <div>
                <div className="text-white/70 font-semibold mb-1">Outreach Pool</div>
                <div className="grid grid-cols-3 gap-3">
                  {['firms', 'ceos', 'vcs'].map((k) => (
                    <div key={k}>
                      <div className="text-white/60">{k === 'firms' ? 'Recruiters' : k === 'ceos' ? 'CEOs' : 'VCs'}</div>
                      <div className="text-sm">
                        <span className="font-bold">{runResult.outreach?.newlyDrafted?.[k] || 0}</span>
                        <span className="text-white/50"> drafted</span>
                      </div>
                      <div className="text-[10px] text-white/40">
                        {runResult.outreach?.pool?.[k] || 0} eligible · {runResult.outreach?.allContacted?.[k] || 0} already contacted
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI Emails */}
              <div>
                <div className="text-white/70 font-semibold mb-1">AI Emails</div>
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold">{runResult.emails?.generated || 0}</span>
                  <span className="text-white/50">generated</span>
                  {runResult.emails?.failed > 0 && (
                    <span className="text-red-300">· {runResult.emails.failed} failed</span>
                  )}
                </div>
              </div>

              {/* Crawl */}
              <div>
                <div className="text-white/70 font-semibold mb-1">Job Board Crawl</div>
                {runResult.crawl?.error ? (
                  <div className="text-red-300">{runResult.crawl.error}</div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold">{runResult.crawl?.newLeads || 0}</span>
                      <span className="text-white/50">new leads</span>
                      {Object.keys(runResult.crawl?.sourceStats || {}).length > 0 && (
                        <span className="text-white/40 text-[10px]">· {Object.keys(runResult.crawl.sourceStats).length} sources</span>
                      )}
                    </div>
                    {runResult.crawl?.sourceStats && Object.keys(runResult.crawl.sourceStats).length > 0 && (
                      <details className="mt-1">
                        <summary className="text-white/50 cursor-pointer text-[10px]">per-source breakdown</summary>
                        <div className="mt-1 space-y-0.5 text-[10px] text-white/60">
                          {Object.entries(runResult.crawl.sourceStats).map(([src, stats]) => (
                            <div key={src}>
                              {src}: found {stats.urlsFound || 0}, kept {stats.added || 0}
                              {stats.filteredByLocation > 0 && `, location-filtered ${stats.filteredByLocation}`}
                              {stats.filteredByScore > 0 && `, score-filtered ${stats.filteredByScore}`}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>

              {runResult.errors?.length > 0 && (
                <div className="text-red-300">{runResult.errors.join(' · ')}</div>
              )}
            </div>
          )}
        </div>

        <div className="overflow-y-auto p-6 space-y-5">
          {isLoading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : data ? (
            <>
              <SyncSection
                title="Drafts Ready to Review"
                count={data.outreach?.draftsQueued || 0}
                items={[]}
                renderItem={() => null}
                emptyText={data.outreach?.draftsQueued ? `${data.outreach.draftsQueued} drafted emails waiting in the Queue page` : 'No drafts queued. Run Morning Sync to generate some.'}
              />
              <SyncSection
                title="Outreach Follow-ups Due"
                count={data.outreach?.dueFollowUps || 0}
                items={[]}
                renderItem={() => null}
                emptyText={data.outreach?.dueFollowUps ? `${data.outreach.dueFollowUps} contacts due for follow-up` : 'No outreach follow-ups due.'}
              />
              <SyncSection
                title="Applications Needing Packages"
                count={data.applications?.needsPackage || 0}
                items={data.applications?.needsPackageItems || []}
                renderItem={(a) => (
                  <div><span className="font-medium">{a.company}</span> <span className="text-gray-500">— {a.role}</span></div>
                )}
                emptyText="All queued applications have packages."
              />
              <SyncSection
                title="Application Follow-ups Due"
                count={data.applications?.followUpsDue || 0}
                items={data.applications?.followUpItems || []}
                renderItem={(a) => (
                  <div><span className="font-medium">{a.company}</span> <span className="text-gray-500">— {a.role}</span> <span className="text-xs text-red-600 ml-1">{a.status} · due {a.follow_up_date}</span></div>
                )}
                emptyText="No overdue application follow-ups."
              />
              <SyncSection
                title="Overdue Next Steps"
                count={data.networking?.overdueSteps || 0}
                items={data.networking?.overdueItems || []}
                renderItem={(s) => (
                  <div><span className="font-medium">{s.eventTitle}</span> <span className="text-gray-500">— {s.step}</span> <span className="text-xs text-red-600 ml-1">due {s.due}</span></div>
                )}
                emptyText="No overdue next steps."
              />
              <SyncSection
                title="Events Missing Notes"
                count={data.networking?.eventsNoNotes || 0}
                items={data.networking?.eventsNoNotesItems || []}
                renderItem={(e) => (
                  <div><span className="font-medium">{e.title}</span> <span className="text-gray-500 text-xs">— {e.start_date}</span></div>
                )}
                emptyText="All recent events have notes."
              />
              <SyncSection
                title="Top New Leads"
                count={data.jobBoard?.newLeads || 0}
                items={data.jobBoard?.topLeads || []}
                renderItem={(l) => (
                  <div>
                    <span className="font-medium">{l.title}</span>
                    {l.organization && <span className="text-gray-500"> — {l.organization}</span>}
                    <span className="text-xs text-[#F97316] ml-2">{l.fit_score}/10 · {l.source_label}</span>
                  </div>
                )}
                emptyText="No new leads. Try crawling."
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SyncSection({ title, count, items, renderItem, emptyText }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-[#1F2D3D]">{title}</h3>
        {count > 0 && (
          <span className="text-xs font-bold bg-[#F97316] text-white px-2 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1 text-sm text-gray-700">
          {items.map((item, i) => <li key={i} className="pl-2 border-l-2 border-[#F97316]/30">{renderItem(item)}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">{emptyText}</p>
      )}
    </div>
  );
}

function SLARow({ label, value }) {
  const pct = value != null ? Math.round(value) : null;
  const barColor = pct == null ? 'bg-gray-200' : pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-[#1F2D3D]">{pct != null ? `${pct}%` : '--'}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct || 0}%` }} />
      </div>
    </div>
  );
}
