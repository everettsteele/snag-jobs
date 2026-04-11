import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

const PILLAR_LABELS = {
  recruiter: { label: 'Recruiter', color: 'bg-blue-100 text-blue-700' },
  ceo: { label: 'CEO', color: 'bg-[#F97316]/10 text-[#F97316]' },
  vc: { label: 'VC', color: 'bg-green-100 text-green-700' },
};

export default function QueuePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [logModal, setLogModal] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['queue'],
    queryFn: () => api.get('/due'),
  });

  const runQueueMutation = useMutation({
    mutationFn: () => api.post('/cron/run'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      toast('Queue run complete');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const markDraftsMutation = useMutation({
    mutationFn: () => api.post('/mark-drafts-sent'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      toast('Drafts marked as sent');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const markSentMutation = useMutation({
    mutationFn: (id) => api.patch(`/due/${id}`, { status: 'sent' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      toast('Marked as sent');
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const logFollowUpMutation = useMutation({
    mutationFn: (body) => api.post('/follow-ups', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      toast('Follow-up logged');
      setLogModal(null);
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
          onClick={() => queryClient.invalidateQueries({ queryKey: ['queue'] })}
          className="text-sm text-[#F97316] hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const items = Array.isArray(data) ? data : data?.items || data?.due || [];

  const drafts = items.filter((i) => i.status === 'draft' || i.type === 'draft');
  const followUps = items.filter((i) => i.status === 'follow_up' || i.type === 'follow_up' || i.overdue);

  // Group drafts by pillar
  const groupedDrafts = {};
  drafts.forEach((d) => {
    const pillar = d.pillar || 'recruiter';
    if (!groupedDrafts[pillar]) groupedDrafts[pillar] = [];
    groupedDrafts[pillar].push(d);
  });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Date Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#1F2D3D]">{today}</h2>
          <p className="text-sm text-gray-500">
            {drafts.length} draft{drafts.length !== 1 ? 's' : ''} to send,{' '}
            {followUps.length} follow-up{followUps.length !== 1 ? 's' : ''} due
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runQueueMutation.mutate()}
            disabled={runQueueMutation.isPending}
            className="bg-[#1F2D3D] hover:bg-[#2C3E50] text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {runQueueMutation.isPending ? 'Running...' : 'Run Queue'}
          </button>
          {drafts.length > 0 && (
            <button
              onClick={() => markDraftsMutation.mutate()}
              disabled={markDraftsMutation.isPending}
              className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {markDraftsMutation.isPending ? 'Marking...' : 'Mark Drafts Sent'}
            </button>
          )}
        </div>
      </div>

      {/* Send Now Section */}
      {drafts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[#1F2D3D] uppercase tracking-wide">
            Send Now
          </h3>
          {Object.entries(groupedDrafts).map(([pillar, items]) => {
            const info = PILLAR_LABELS[pillar] || PILLAR_LABELS.recruiter;
            return (
              <div key={pillar} className="bg-white rounded-xl border border-gray-200">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${info.color}`}>
                    {info.label}
                  </span>
                  <span className="text-xs text-gray-500">{items.length} draft{items.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {items.map((item) => (
                    <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-[#1F2D3D] truncate">
                          {item.firm_name || item.contact_name || item.name || 'Unknown'}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {item.contact_email || item.email || ''}
                          {item.subject && ` \u2014 ${item.subject}`}
                        </div>
                      </div>
                      <button
                        onClick={() => markSentMutation.mutate(item.id)}
                        disabled={markSentMutation.isPending}
                        className="shrink-0 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Mark Sent
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Follow Up Today Section */}
      {followUps.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[#1F2D3D] uppercase tracking-wide">
            Follow Up Today
          </h3>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {followUps.map((item) => (
              <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-[#1F2D3D] truncate">
                      {item.firm_name || item.contact_name || item.name || 'Unknown'}
                    </span>
                    {item.pillar && (
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          PILLAR_LABELS[item.pillar]?.color || 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {PILLAR_LABELS[item.pillar]?.label || item.pillar}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {item.contact_email || item.email || ''}
                    {item.days_overdue != null && ` \u2022 ${item.days_overdue}d overdue`}
                  </div>
                </div>
                <button
                  onClick={() =>
                    setLogModal({
                      id: item.id,
                      name: item.firm_name || item.contact_name || item.name || '',
                      email: item.contact_email || item.email || '',
                    })
                  }
                  className="shrink-0 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  Log
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {drafts.length === 0 && followUps.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <div className="text-4xl mb-3">&#10003;</div>
          <p className="text-gray-500">All caught up! No items due today.</p>
        </div>
      )}

      {/* Log Follow-up Modal */}
      {logModal && (
        <LogFollowUpModal
          contact={logModal}
          onClose={() => setLogModal(null)}
          onSave={(data) => logFollowUpMutation.mutate(data)}
          saving={logFollowUpMutation.isPending}
        />
      )}
    </div>
  );
}

function LogFollowUpModal({ contact, onClose, onSave, saving }) {
  const [note, setNote] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      item_id: contact.id,
      contact_name: contact.name,
      contact_email: contact.email,
      note,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#1F2D3D]">Log Follow-up</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl cursor-pointer">
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
            <div className="text-sm text-[#1F2D3D]">{contact.name}</div>
            {contact.email && <div className="text-xs text-gray-500">{contact.email}</div>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] resize-none"
              placeholder="What happened in this follow-up?"
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
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
