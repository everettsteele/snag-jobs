import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const DAYS_TO_SHOW = 14;

export default function DashboardPage() {
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

  const segments = stats?.segments || {};
  const daily = stats?.daily || [];
  const totals = stats?.totals || {};
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

  // Daily chart data
  const chartDays = daily.slice(-DAYS_TO_SHOW);
  const maxDaily = Math.max(
    1,
    ...chartDays.map((d) => (d.recruiters || 0) + (d.ceos || 0) + (d.vcs || 0))
  );

  return (
    <div className="space-y-6">
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
            const total = r + c + v;
            const pct = (val) => (val / maxDaily) * 100;
            const dateStr = new Date(day.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col-reverse" style={{ height: '128px' }}>
                  {r > 0 && (
                    <div
                      className="w-full bg-blue-500 rounded-t-sm"
                      style={{ height: `${pct(r)}%` }}
                      title={`Recruiters: ${r}`}
                    />
                  )}
                  {c > 0 && (
                    <div
                      className="w-full bg-[#F97316]"
                      style={{ height: `${pct(c)}%` }}
                      title={`CEOs: ${c}`}
                    />
                  )}
                  {v > 0 && (
                    <div
                      className="w-full bg-green-500 rounded-t-sm"
                      style={{ height: `${pct(v)}%` }}
                      title={`VCs: ${v}`}
                    />
                  )}
                  {total === 0 && (
                    <div className="w-full bg-gray-100 rounded-t-sm" style={{ height: '2px' }} />
                  )}
                </div>
                <span className="text-[9px] text-gray-400 truncate w-full text-center">
                  {dateStr}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3">
          <Legend color="bg-blue-500" label="Recruiters" />
          <Legend color="bg-[#F97316]" label="CEOs" />
          <Legend color="bg-green-500" label="VCs" />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SLA Compliance */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-[#1F2D3D] mb-4">SLA Compliance</h3>
          <div className="space-y-3">
            <SLARow label="Recruiter Follow-ups" value={slaStats.recruiterCompliance} />
            <SLARow label="CEO Follow-ups" value={slaStats.ceoCompliance} />
            <SLARow label="VC Follow-ups" value={slaStats.vcCompliance} />
            <SLARow label="Application Follow-ups" value={slaStats.appCompliance} />
          </div>
        </div>

        {/* Template Performance */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-[#1F2D3D] mb-4">Template Performance</h3>
          {stats?.templateStats?.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Template</th>
                  <th className="pb-2 font-medium text-right">Sent</th>
                  <th className="pb-2 font-medium text-right">Replies</th>
                  <th className="pb-2 font-medium text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.templateStats.map((t, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-[#1F2D3D]">{t.template || t.name || `Template ${i + 1}`}</td>
                    <td className="py-2 text-right text-gray-600">{t.sent || 0}</td>
                    <td className="py-2 text-right text-gray-600">{t.replies || 0}</td>
                    <td className="py-2 text-right font-medium text-[#1F2D3D]">
                      {t.sent ? `${Math.round(((t.replies || 0) / t.sent) * 100)}%` : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400">No template data yet</p>
          )}
        </div>
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
