import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

const SOURCE_COLORS = {
  linkedin: 'bg-blue-100 text-blue-700',
  indeed: 'bg-purple-100 text-purple-700',
  glassdoor: 'bg-green-100 text-green-700',
  wellfound: 'bg-rose-100 text-rose-700',
  builtin: 'bg-amber-100 text-amber-700',
  default: 'bg-gray-100 text-gray-600',
};

export default function JobBoardPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [skippedIds, setSkippedIds] = useState(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['job-board'],
    queryFn: () => api.get('/job-board'),
  });

  const snagMutation = useMutation({
    mutationFn: (lead_id) => api.post('/job-board/snag', { lead_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-board'] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Snagged! Added to applications.');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const skipMutation = useMutation({
    mutationFn: (id) => api.patch(`/job-board/${id}`, { status: 'reviewed' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-board'] });
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const crawlMutation = useMutation({
    mutationFn: () => api.post('/job-board/crawl'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-board'] });
      toast('Crawl started');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600 mb-2">{error.message}</p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['job-board'] })}
          className="text-sm text-[#F97316] hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const leads = (Array.isArray(data) ? data : data?.leads || []).filter(
    (l) => !skippedIds.has(l.id)
  );

  // Source counts
  const sourceCounts = {};
  leads.forEach((l) => {
    const src = l.source || 'unknown';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });

  const handleSkip = (id) => {
    setSkippedIds((prev) => new Set([...prev, id]));
    skipMutation.mutate(id);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-[#1F2D3D]">
            {leads.length} Lead{leads.length !== 1 ? 's' : ''}
          </h2>
          {Object.entries(sourceCounts).map(([src, count]) => (
            <span
              key={src}
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_COLORS[src] || SOURCE_COLORS.default}`}
            >
              {src} ({count})
            </span>
          ))}
        </div>
        <button
          onClick={() => crawlMutation.mutate()}
          disabled={crawlMutation.isPending}
          className="bg-[#1F2D3D] hover:bg-[#2C3E50] text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          {crawlMutation.isPending ? 'Crawling...' : 'Crawl Now'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium w-16">Fit</th>
              <th className="px-4 py-3 font-medium">Why</th>
              <th className="px-4 py-3 font-medium w-24">Found</th>
              <th className="px-4 py-3 font-medium w-40">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-10">
                  No new leads. Try crawling for more.
                </td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#1F2D3D]">{lead.title || lead.role}</div>
                    <div className="text-xs text-gray-500">
                      {lead.organization || lead.company}
                      {lead.location && ` \u00B7 ${lead.location}`}
                    </div>
                    {lead.source && (
                      <span
                        className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${SOURCE_COLORS[lead.source] || SOURCE_COLORS.default}`}
                      >
                        {lead.source}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-sm font-bold ${
                        (lead.fit_score || 0) >= 7
                          ? 'text-green-600'
                          : (lead.fit_score || 0) >= 4
                            ? 'text-amber-600'
                            : 'text-gray-400'
                      }`}
                    >
                      {lead.fit_score != null ? `${lead.fit_score}/10` : '--'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs max-w-xs">
                    {lead.fit_reason || lead.why || '--'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '--'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => snagMutation.mutate(lead.id)}
                        disabled={snagMutation.isPending}
                        className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-3 py-1.5 rounded transition-colors cursor-pointer font-medium disabled:opacity-50"
                      >
                        Snag
                      </button>
                      <button
                        onClick={() => handleSkip(lead.id)}
                        className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded transition-colors cursor-pointer"
                      >
                        Skip
                      </button>
                      {(lead.url || lead.posting_url) && (
                        <a
                          href={lead.url || lead.posting_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded transition-colors"
                        >
                          View
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
