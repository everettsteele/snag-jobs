import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

const APP_STATUSES = {
  identified: { label: 'Identified', color: 'bg-gray-100 text-gray-700' },
  researching: { label: 'Researching', color: 'bg-blue-50 text-blue-700' },
  materials_prep: { label: 'Materials Prep', color: 'bg-indigo-50 text-indigo-700' },
  ready_to_apply: { label: 'Ready to Apply', color: 'bg-purple-50 text-purple-700' },
  applied: { label: 'Applied', color: 'bg-[#F97316]/10 text-[#F97316]' },
  interviewing: { label: 'Interviewing', color: 'bg-amber-50 text-amber-700' },
  offer: { label: 'Offer', color: 'bg-green-50 text-green-700' },
  rejected: { label: 'Rejected', color: 'bg-red-50 text-red-700' },
  withdrawn: { label: 'Withdrawn', color: 'bg-gray-50 text-gray-500' },
  closed: { label: 'Closed', color: 'bg-gray-50 text-gray-500' },
};

export default function ApplicationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [coverLetterApp, setCoverLetterApp] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['applications'],
    queryFn: () => api.get('/applications'),
  });

  const addMutation = useMutation({
    mutationFn: (app) => api.post('/applications', app),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Application added');
      setShowModal(false);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...fields }) => api.patch(`/applications/${id}`, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Updated');
    },
    onError: (err) => toast(err.message, 'error'),
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast(data?.message || 'Package build started');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const generateLetterMutation = useMutation({
    mutationFn: (id) => api.post(`/applications/${id}/generate-letter`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast('Cover letter generated');
      if (data?.application) setCoverLetterApp(data.application);
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
          onClick={() => queryClient.invalidateQueries({ queryKey: ['applications'] })}
          className="text-sm text-[#F97316] hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const appList = Array.isArray(data) ? data : data?.applications || [];
  const filtered = filter === 'all' ? appList : appList.filter((a) => a.status === filter);
  const needsPackages = appList.some((a) => a.status === 'materials_prep' || a.status === 'ready_to_apply');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[#1F2D3D]">
            {filtered.length} Application{filtered.length !== 1 ? 's' : ''}
          </h2>
          {needsPackages && (
            <button
              onClick={() => buildMutation.mutate()}
              disabled={buildMutation.isPending}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              Build Queued Packages
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#F97316]"
          >
            <option value="all">All Statuses</option>
            {Object.entries(APP_STATUSES).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowModal(true)}
            className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            + Log Application
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Added</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Follow-up</th>
              <th className="px-4 py-3 font-medium">Resume</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-10">
                  No applications found
                </td>
              </tr>
            ) : (
              filtered.map((app) => (
                <ApplicationRow
                  key={app.id}
                  app={app}
                  onUpdate={(fields) => updateMutation.mutate({ id: app.id, ...fields })}
                  onShowCoverLetter={(a) => setCoverLetterApp(a)}
                  onDelete={() => {
                    if (window.confirm('Delete this application?')) {
                      deleteMutation.mutate(app.id);
                    }
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      {showModal && (
        <AddApplicationModal
          onClose={() => setShowModal(false)}
          onSave={(data) => addMutation.mutate(data)}
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

function ApplicationRow({ app, onUpdate, onDelete, onShowCoverLetter }) {
  const statusInfo = APP_STATUSES[app.status] || APP_STATUSES.identified;
  const followUp = app.follow_up_date || app.followup_date;
  const sourceUrl = app.source_url || app.url;
  const hasCoverLetter = !!app.cover_letter_text;

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50">
      <td className="px-4 py-3">
        <div className="font-medium text-[#1F2D3D]">{app.company}</div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#F97316] hover:underline"
          >
            View posting
          </a>
        )}
      </td>
      <td className="px-4 py-3 text-gray-700">{app.role || app.title || '--'}</td>
      <td className="px-4 py-3 text-gray-500 text-xs">
        {app.applied_date ? new Date(app.applied_date + 'T12:00:00').toLocaleDateString()
          : app.created_at ? new Date(app.created_at).toLocaleDateString() : '--'}
      </td>
      <td className="px-4 py-3">
        <select
          value={app.status}
          onChange={(e) => onUpdate({ status: e.target.value })}
          className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${statusInfo.color}`}
        >
          {Object.entries(APP_STATUSES).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {followUp ? new Date(followUp + 'T12:00:00').toLocaleDateString() : '--'}
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 max-w-32 truncate">
        {app.resume_variant || '--'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 flex-wrap">
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-2 py-1 rounded transition-colors"
              title="Open the job posting"
            >
              Apply
            </a>
          ) : (
            <span className="text-xs text-gray-300 px-2 py-1" title="No source URL">Apply</span>
          )}
          <button
            onClick={() => onShowCoverLetter(app)}
            className={`text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
              hasCoverLetter
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-600'
            }`}
            title={hasCoverLetter ? 'View cover letter' : 'Generate cover letter'}
          >
            {hasCoverLetter ? 'View CL' : 'Gen CL'}
          </button>
          {sourceUrl && (
            <a
              href={`/api/applications/${app.id}/cover-letter`}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-xs px-2 py-1 rounded transition-colors ${
                hasCoverLetter ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 text-gray-400 pointer-events-none'
              }`}
              title="Print-ready cover letter"
              onClick={(e) => !hasCoverLetter && e.preventDefault()}
            >
              Print
            </a>
          )}
          <button
            onClick={onDelete}
            className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded transition-colors cursor-pointer"
          >
            Del
          </button>
        </div>
      </td>
    </tr>
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
              href={`/api/applications/${app.id}/cover-letter`}
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

function AddApplicationModal({ onClose, onSave, saving }) {
  const [form, setForm] = useState({
    company: '',
    role: '',
    url: '',
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
