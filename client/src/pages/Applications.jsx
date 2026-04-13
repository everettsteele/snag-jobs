import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import ApplicationRow, { STATUS_INFO } from '../components/applications/ApplicationRow';

export default function ApplicationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [coverLetterApp, setCoverLetterApp] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [quickInput, setQuickInput] = useState('');
  const [prefill, setPrefill] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['applications'],
    queryFn: () => api.get('/applications'),
  });

  const { data: variants = [] } = useQuery({
    queryKey: ['resume-variants'],
    queryFn: () => api.get('/resumes'),
  });

  const addMutation = useMutation({
    mutationFn: (app) => api.post('/applications', app),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Application added');
      setShowModal(false);
      setPrefill(null);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...fields }) => api.patch(`/applications/${id}`, fields),
    onMutate: async ({ id, ...fields }) => {
      await queryClient.cancelQueries({ queryKey: ['applications'] });
      const prev = queryClient.getQueryData(['applications']);
      queryClient.setQueryData(['applications'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((a) => (a.id === id ? { ...a, ...fields } : a));
      });
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      queryClient.setQueryData(['applications'], ctx?.prev);
      toast(err.message, 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.del(`/applications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Deleted');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const buildMutation = useMutation({
    mutationFn: () => api.post('/applications/batch-packages'),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast(d?.message || 'Package build started');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const generateAllMutation = useMutation({
    mutationFn: () => api.post('/applications/batch-generate-letters'),
    onSuccess: (d) => {
      toast(d?.message || 'Generating cover letters');
      const poll = setInterval(() => queryClient.invalidateQueries({ queryKey: ['applications'] }), 4000);
      setTimeout(() => clearInterval(poll), 120000);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const bulkMutation = useMutation({
    mutationFn: ({ action, value }) => api.post('/applications/bulk', {
      ids: Array.from(selected), action, value,
    }),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast(d?.message || `Updated ${d?.updated || 0} · ${d?.failed || 0} failed`);
      setSelected(new Set());
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const parseUrlMutation = useMutation({
    mutationFn: (url) => api.post('/applications/parse-url', { url }),
    onSuccess: (d) => {
      setPrefill({ company: d.company, role: d.role, source_url: d.source_url });
      setShowModal(true);
      setQuickInput('');
    },
    onError: (err) => toast(err.message || 'Could not parse URL', 'error'),
  });

  const generateLetterMutation = useMutation({
    mutationFn: (id) => api.post(`/applications/${id}/generate-letter`),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Cover letter generated');
      if (d?.application) setCoverLetterApp(d.application);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const appList = Array.isArray(data) ? data : data?.applications || [];
  const todayStr = new Date().toISOString().slice(0, 10);

  const sorted = useMemo(() => {
    return [...appList].sort((a, b) => {
      const ta = new Date(a.created_at || a.applied_date || 0).getTime();
      const tb = new Date(b.created_at || b.applied_date || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [appList]);

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
        <button onClick={() => queryClient.invalidateQueries({ queryKey: ['applications'] })}
                className="text-sm text-[#F97316] hover:underline cursor-pointer">Retry</button>
      </div>
    );
  }

  const filtered = sorted.filter((a) => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (filter === 'all' && a.snoozed_until && a.snoozed_until > todayStr) return false;
    return true;
  });

  const needsPackages = appList.some((a) => a.status === 'ready_to_apply');
  const identifiedNeedingLetter = appList.filter((a) => a.status === 'identified' && !a.cover_letter_text);

  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    if (prev.size === filtered.length) return new Set();
    return new Set(filtered.map((a) => a.id));
  });

  const handleQuick = () => {
    const v = quickInput.trim();
    if (!v) return;
    if (/^https?:\/\//i.test(v)) {
      parseUrlMutation.mutate(v);
    } else {
      setPrefill({ company: v });
      setShowModal(true);
      setQuickInput('');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-[#1F2D3D]">
            {filtered.length} Application{filtered.length !== 1 ? 's' : ''}
          </h2>
          {needsPackages && (
            <button onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending}
                    className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
              Build Packages
            </button>
          )}
          {identifiedNeedingLetter.length > 0 && (
            <button onClick={() => generateAllMutation.mutate()} disabled={generateAllMutation.isPending}
                    className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
              {generateAllMutation.isPending ? 'Starting...' : `Generate All (${identifiedNeedingLetter.length})`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQuick()}
            placeholder="Paste URL or type company"
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#F97316] w-56"
          />
          <button onClick={handleQuick} disabled={parseUrlMutation.isPending}
                  className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
            {parseUrlMutation.isPending ? '...' : '+ Add'}
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#F97316]">
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_INFO).map(([k, { label }]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          onStatus={(s) => bulkMutation.mutate({ action: 'set_status', value: s })}
          onDelete={() => {
            if (window.confirm(`Delete ${selected.size} application(s)?`))
              bulkMutation.mutate({ action: 'delete' });
          }}
          onGenerate={() => bulkMutation.mutate({ action: 'generate_letter' })}
          onSnooze={(d) => bulkMutation.mutate({ action: 'snooze', value: d })}
          onClear={() => setSelected(new Set())}
          busy={bulkMutation.isPending}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/50">
              <th className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  className="w-4 h-4 accent-[#F97316] cursor-pointer"
                />
              </th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Added</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Follow-up</th>
              <th className="px-2 py-3 font-medium w-[90px]">Resume</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-gray-400 py-10">No applications found</td></tr>
            ) : (
              filtered.map((app) => (
                <ApplicationRow
                  key={app.id}
                  app={app}
                  variants={variants}
                  selected={selected.has(app.id)}
                  onToggleSelect={() => toggleRow(app.id)}
                  onUpdate={(fields) => updateMutation.mutate({ id: app.id, ...fields })}
                  onShowCoverLetter={(a) => setCoverLetterApp(a)}
                  onDelete={() => {
                    if (window.confirm('Delete this application?')) deleteMutation.mutate(app.id);
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddApplicationModal
          prefill={prefill}
          onClose={() => { setShowModal(false); setPrefill(null); }}
          onSave={(d) => addMutation.mutate(d)}
          saving={addMutation.isPending}
        />
      )}
      {coverLetterApp && (
        <CoverLetterModal
          app={coverLetterApp}
          onClose={() => setCoverLetterApp(null)}
          onGenerate={(a) => generateLetterMutation.mutate(a.id)}
          generating={generateLetterMutation.isPending}
        />
      )}
    </div>
  );
}

function BulkBar({ count, onStatus, onDelete, onGenerate, onSnooze, onClear, busy }) {
  const [snoozeDate, setSnoozeDate] = useState('');
  return (
    <div className="flex items-center gap-2 bg-[#F97316]/10 border border-[#F97316]/30 rounded-lg px-4 py-2 flex-wrap">
      <span className="text-sm font-medium text-[#1F2D3D] mr-2">{count} selected</span>
      <select
        defaultValue=""
        onChange={(e) => { if (e.target.value) { onStatus(e.target.value); e.target.value = ''; } }}
        disabled={busy}
        className="text-xs border border-gray-300 rounded px-2 py-1 cursor-pointer bg-white"
      >
        <option value="" disabled>Change status…</option>
        {Object.entries(STATUS_INFO).map(([k, { label }]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      <button onClick={onGenerate} disabled={busy}
              className="text-xs bg-white hover:bg-gray-50 border border-gray-300 px-2 py-1 rounded cursor-pointer disabled:opacity-50">
        Generate Letters
      </button>
      <div className="flex items-center gap-1">
        <input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)}
               className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white" />
        <button onClick={() => { if (snoozeDate) { onSnooze(snoozeDate); setSnoozeDate(''); } }}
                disabled={!snoozeDate || busy}
                className="text-xs bg-white hover:bg-gray-50 border border-gray-300 px-2 py-1 rounded cursor-pointer disabled:opacity-50">
          Snooze
        </button>
      </div>
      <button onClick={onDelete} disabled={busy}
              className="text-xs bg-white hover:bg-red-50 border border-gray-300 text-red-600 px-2 py-1 rounded cursor-pointer disabled:opacity-50">
        Delete
      </button>
      <button onClick={onClear} className="text-xs text-gray-500 hover:text-gray-700 ml-auto cursor-pointer">
        Clear
      </button>
    </div>
  );
}

function AddApplicationModal({ prefill, onClose, onSave, saving }) {
  const [form, setForm] = useState({
    company: prefill?.company || '',
    role: prefill?.role || '',
    url: prefill?.source_url || '',
    notes: '',
    created_at: new Date().toISOString().split('T')[0],
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.company.trim()) return;
    onSave(form);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#1F2D3D]">Log Application</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl cursor-pointer">
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company *</label>
            <input
              required
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <input
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              placeholder="VP of Engineering"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job URL</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={form.created_at}
              onChange={(e) => setForm({ ...form, created_at: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] resize-none"
              placeholder="Any notes about this application..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CoverLetterModal({ app, onClose, onGenerate, generating }) {
  const [editedText, setEditedText] = useState(app.cover_letter_text || '');

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-[#1F2D3D]">Cover Letter</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {app.company} — {app.role}
              {app.resume_variant && <span className="ml-2 text-[#F97316]">· {app.resume_variant} variant</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none cursor-pointer">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {app.cover_letter_text ? (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={20}
              className="w-full p-3 border border-gray-200 rounded-lg text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No cover letter generated yet.</p>
              <button
                onClick={() => onGenerate(app)}
                disabled={generating}
                className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-semibold px-5 py-2.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {generating ? 'Generating (30-60s)...' : 'Generate Cover Letter'}
              </button>
              <p className="text-xs text-gray-400 mt-2">
                Uses your resume, this role's JD, and AI to write a custom letter.
              </p>
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
          {app.cover_letter_text && (
            <a
              href={`/api/applications/${app.id}/cover-letter?token=${encodeURIComponent((localStorage.getItem('snag_token') || localStorage.getItem('hopespot_token')) || '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg cursor-pointer"
            >
              Print-ready version
            </a>
          )}
          <button
            onClick={onClose}
            className="bg-[#1F2D3D] hover:bg-[#2C3E50] text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
