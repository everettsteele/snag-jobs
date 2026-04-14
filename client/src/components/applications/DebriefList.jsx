import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import DebriefLogModal from './DebriefLogModal';

export default function DebriefList({ app }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['app-debriefs', app.id],
    queryFn: () => api.get(`/applications/${app.id}/debriefs`),
    enabled: !!user?.isPro,
  });

  const createMut = useMutation({
    mutationFn: (transcript) => api.post(`/applications/${app.id}/debriefs`, { transcript }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-debriefs', app.id] });
      qc.invalidateQueries({ queryKey: ['applications'] });
      setModalOpen(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (debriefId) => api.del(`/applications/${app.id}/debriefs/${debriefId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-debriefs', app.id] }),
  });

  if (!user?.isPro) return null;

  const debriefs = data?.debriefs || [];

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-[#1F2D3D]">Debriefs</div>
        <button
          onClick={() => setModalOpen(true)}
          className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded cursor-pointer"
        >
          + Log debrief
        </button>
      </div>

      {isLoading && <div className="text-xs text-gray-400">Loading...</div>}
      {error && <div className="text-xs text-red-600">{error.message}</div>}
      {!isLoading && debriefs.length === 0 && (
        <div className="text-xs text-gray-400">No debriefs yet. Log one after your interview.</div>
      )}

      <div className="space-y-3">
        {debriefs.map((d) => (
          <DebriefCard key={d.id} debrief={d} onDelete={() => {
            if (window.confirm('Delete this debrief?')) deleteMut.mutate(d.id);
          }} />
        ))}
      </div>

      {createMut.error && (
        <div className="text-xs text-red-600 mt-2">{createMut.error.message}</div>
      )}

      {modalOpen && (
        <DebriefLogModal
          onClose={() => setModalOpen(false)}
          onSave={(transcript) => createMut.mutate(transcript)}
          saving={createMut.isPending}
        />
      )}
    </div>
  );
}

function DebriefCard({ debrief, onDelete }) {
  const [copied, setCopied] = useState(false);
  const copyThankYou = () => {
    if (!debrief.thank_you_draft) return;
    navigator.clipboard.writeText(debrief.thank_you_draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-3">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] text-gray-400">
          {debrief.created_at ? new Date(debrief.created_at).toLocaleString() : ''}
        </div>
        <button onClick={onDelete} className="text-[11px] text-gray-400 hover:text-red-600 cursor-pointer">Delete</button>
      </div>

      {debrief.summary && (
        <p className="text-sm text-gray-800 mb-3 leading-relaxed">{debrief.summary}</p>
      )}

      {Array.isArray(debrief.topics_covered) && debrief.topics_covered.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {debrief.topics_covered.map((t, i) => (
            <span key={i} className="text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 text-[11px]">
        {['strengths', 'watchouts', 'follow_ups'].map((field) => {
          const items = debrief[field] || [];
          if (items.length === 0) return null;
          const label = field === 'strengths' ? 'What worked'
                       : field === 'watchouts' ? 'Watch out for'
                       : 'Follow-ups';
          const sign = field === 'strengths' ? '+' : field === 'watchouts' ? '−' : '→';
          const color = field === 'strengths' ? 'text-green-600'
                       : field === 'watchouts' ? 'text-rose-600'
                       : 'text-[#F97316]';
          return (
            <div key={field}>
              <div className="font-semibold text-gray-700 mb-1">{label}</div>
              <ul className="space-y-0.5">
                {items.map((it, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className={`${color} mt-0.5`}>{sign}</span>
                    <span className="flex-1 text-gray-700">{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {debrief.thank_you_draft && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-semibold text-gray-700">Thank-you draft</div>
            <button
              onClick={copyThankYou}
              className="text-[11px] text-[#F97316] hover:text-[#EA580C] cursor-pointer"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="text-[11px] text-gray-800 bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap font-sans">{debrief.thank_you_draft}</pre>
        </div>
      )}
    </div>
  );
}
