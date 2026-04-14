import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const STORAGE_PREFIX = 'prep-brief-open:';

export default function PrepBriefCard({ app }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_PREFIX + app.id) !== '0'; } catch (_) { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_PREFIX + app.id, open ? '1' : '0'); } catch (_) {}
  }, [open, app.id]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['app-prep-brief', app.id],
    queryFn: () => api.get(`/applications/${app.id}/prep-brief`),
    enabled: !!user?.isPro,
  });

  const buildMut = useMutation({
    mutationFn: (body) => api.post(`/applications/${app.id}/prep-brief/build`, body || {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-prep-brief', app.id] }),
  });

  if (!user?.isPro) return null;

  if (isLoading) {
    return <div className="text-xs text-gray-400 py-3">Loading prep brief...</div>;
  }
  if (error) {
    return <div className="text-xs text-red-600 py-3">{error.message}</div>;
  }

  const brief = data?.brief || null;

  if (!brief) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 mb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[#1F2D3D]">Prep Brief</div>
            <div className="text-[11px] text-gray-500">Generate a structured brief with likely questions, company research, and what to ask.</div>
          </div>
          <button
            onClick={() => buildMut.mutate()}
            disabled={buildMut.isPending}
            className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-3 py-1.5 rounded cursor-pointer disabled:opacity-50"
          >
            {buildMut.isPending ? 'Building...' : 'Build prep brief'}
          </button>
        </div>
        {buildMut.error && (
          <div className="text-xs text-red-600 mt-2">{buildMut.error.message}</div>
        )}
      </div>
    );
  }

  const sections = [
    { key: 'likely', label: 'Likely Questions', items: brief.likely_questions || [] },
    { key: 'highlights', label: 'Resume Highlights', items: brief.resume_highlights || [] },
    { key: 'to_ask', label: 'Questions To Ask', items: brief.questions_to_ask || [] },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
      >
        <div className="text-left">
          <div className="text-sm font-semibold text-[#1F2D3D]">Prep Brief</div>
          <div className="text-[10px] text-gray-400">
            Refreshed {brief.updated_at ? new Date(brief.updated_at).toLocaleDateString() : 'unknown'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (window.confirm('Regenerate the prep brief?')) buildMut.mutate({ refresh: true }); }}
            disabled={buildMut.isPending}
            className="text-[11px] text-gray-500 hover:text-[#F97316] cursor-pointer disabled:opacity-50"
          >
            {buildMut.isPending ? 'Regenerating...' : 'Regenerate'}
          </button>
          <span className="text-xs text-gray-400">{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-4">
          {brief.company_research && (
            <div>
              <div className="text-xs font-semibold text-[#1F2D3D] mb-1">Company Research</div>
              <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{brief.company_research}</p>
            </div>
          )}
          {sections.map((s) => (
            s.items.length > 0 && (
              <div key={s.key}>
                <div className="text-xs font-semibold text-[#1F2D3D] mb-1">{s.label}</div>
                <ul className="space-y-0.5">
                  {s.items.map((item, i) => (
                    <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-[#F97316] mt-1.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
