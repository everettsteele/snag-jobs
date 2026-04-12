import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

const PILLAR_CONFIG = {
  recruiters: {
    label: 'Recruiter',
    endpoint: '/firms',
    nameKey: 'name',
    statusKey: 'status',
  },
  ceos: {
    label: 'CEO',
    endpoint: '/ceos',
    nameKey: 'company',
    statusKey: 'status',
  },
  vcs: {
    label: 'VC',
    endpoint: '/vcs',
    nameKey: 'firm',
    statusKey: 'status',
  },
};

const STATUSES = ['all', 'draft', 'contacted', 'in_convo', 'replied', 'bounced', 'dead'];

const STATUS_COLORS = {
  draft: 'bg-gray-400',
  contacted: 'bg-blue-500',
  in_convo: 'bg-green-500',
  replied: 'bg-green-500',
  bounced: 'bg-red-500',
  dead: 'bg-gray-300',
};

const TIER_COLORS = {
  '1': 'bg-[#F97316] text-white',
  '2': 'bg-amber-100 text-amber-700',
  '3': 'bg-gray-100 text-gray-600',
  A: 'bg-[#F97316] text-white',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-gray-100 text-gray-600',
};

export default function OutreachPage() {
  const { pillar } = useParams();
  const config = PILLAR_CONFIG[pillar] || PILLAR_CONFIG.recruiters;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['outreach', pillar],
    queryFn: () => api.get(config.endpoint),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...fields }) => api.patch(`${config.endpoint}/${id}`, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outreach', pillar] });
      toast('Saved');
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
          onClick={() => queryClient.invalidateQueries({ queryKey: ['outreach', pillar] })}
          className="text-sm text-[#F97316] hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const items = Array.isArray(data) ? data : data?.firms || data?.ceos || data?.vcs || data?.items || [];

  // Status counts
  const statusCounts = { all: items.length };
  items.forEach((item) => {
    const s = item[config.statusKey] || 'draft';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  // Sector list (CEOs only)
  const sectors = pillar === 'ceos'
    ? [...new Set(items.map((i) => i.sector).filter(Boolean))].sort()
    : [];

  // Filter
  let filtered = items;
  if (statusFilter !== 'all') {
    filtered = filtered.filter((i) => (i[config.statusKey] || 'draft') === statusFilter);
  }
  if (sectorFilter !== 'all' && pillar === 'ceos') {
    filtered = filtered.filter((i) => i.sector === sectorFilter);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((i) => {
      const name = (i[config.nameKey] || i.name || '').toLowerCase();
      const contact = (i.contact_name || i.contact_email || '').toLowerCase();
      return name.includes(q) || contact.includes(q);
    });
  }

  return (
    <div className="space-y-4">
      {/* Stats Bar */}
      <div className="flex flex-wrap gap-3">
        {['all', 'draft', 'contacted', 'in_convo', 'bounced'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer ${
              statusFilter === s
                ? 'bg-[#F97316] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'all' ? 'Total' : s === 'in_convo' ? 'In Convo' : s.charAt(0).toUpperCase() + s.slice(1)}{' '}
            ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* Search + Sector Filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            placeholder={`Search ${config.label.toLowerCase()}s...`}
          />
        </div>
        {pillar === 'ceos' && sectors.length > 0 && (
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
          >
            <option value="all">All Sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-400">No {config.label.toLowerCase()}s match your filters</p>
          </div>
        ) : (
          filtered.map((item) => (
            <OutreachCard
              key={item.id}
              item={item}
              config={config}
              pillar={pillar}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onSave={(fields) => updateMutation.mutate({ id: item.id, ...fields })}
            />
          ))
        )}
      </div>

      <div className="text-xs text-gray-400 text-center py-2">
        Showing {filtered.length} of {items.length} {config.label.toLowerCase()}s
      </div>
    </div>
  );
}

function OutreachCard({ item, config, pillar, expanded, onToggle, onSave }) {
  const { toast } = useToast();
  const name = item[config.nameKey] || item.name || 'Unknown';
  const status = item[config.statusKey] || 'draft';
  const statusColor = STATUS_COLORS[status] || 'bg-gray-400';
  const tier = item.tier ? String(item.tier) : null;
  const tierColor = tier ? TIER_COLORS[tier] || 'bg-gray-100 text-gray-600' : null;

  const [notes, setNotes] = useState(item.notes || '');
  const [editStatus, setEditStatus] = useState(status);
  const [followupDate, setFollowupDate] = useState(
    item.followup_date || item.follow_up_date || ''
  );
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const typeMap = { recruiters: 'recruiter', ceos: 'ceo', vcs: 'vc' };

  const extractDraft = () => {
    const marker = '--- AI Draft ---';
    if (notes.includes(marker)) {
      return notes.split(marker).pop().trim();
    }
    return notes.trim();
  };

  const firstEmail = item.contact_email || (item.contacts?.find((c) => c.email)?.email) || '';

  const handleSendGmail = async () => {
    const body = extractDraft();
    if (!body || body.length < 20) {
      toast('Write or generate a draft first', 'error');
      return;
    }
    if (!firstEmail) {
      toast('No recipient email on this contact', 'error');
      return;
    }
    const subject = `Reaching out — ${name}`;
    setSending(true);
    try {
      await api.post('/google/gmail/draft', { to: firstEmail, subject, body });
      toast('Draft created in Gmail');
    } catch (err) {
      toast(err.message || 'Failed to create Gmail draft', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleDraftEmail = async () => {
    const contactName = item.contact_name || (item.contacts?.[0]?.name) || name;
    const company = item.company_name || name;
    const contactRole = item.contact_title || (item.contacts?.[0]?.title) || '';
    setDrafting(true);
    try {
      const data = await api.post('/draft-email', {
        recipientName: contactName,
        company,
        recipientRole: contactRole,
        type: typeMap[pillar] || 'recruiter',
      });
      setNotes((prev) => (prev ? prev + '\n\n--- AI Draft ---\n' + data.draft : data.draft));
      toast('Email draft generated');
    } catch (err) {
      toast(err.message || 'Failed to generate draft', 'error');
    } finally {
      setDrafting(false);
    }
  };

  const handleSave = () => {
    const fields = {};
    if (notes !== (item.notes || '')) fields.notes = notes;
    if (editStatus !== status) fields.status = editStatus;
    if (followupDate !== (item.followup_date || item.follow_up_date || ''))
      fields.followup_date = followupDate;
    if (Object.keys(fields).length > 0) onSave(fields);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Collapsed Header */}
      <div
        className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-gray-50/50"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColor}`} />
          <span className="font-medium text-sm text-[#1F2D3D] truncate">{name}</span>
          {tierColor && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tierColor}`}>
              T{tier}
            </span>
          )}
          {pillar === 'ceos' && item.sector && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700">
              {item.sector}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.contact_name && (
            <span className="text-xs text-gray-400 hidden sm:inline">{item.contact_name}</span>
          )}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
          {/* Why / Reason */}
          {(item.why || item.reason) && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Why</label>
              <p className="text-sm text-gray-700">{item.why || item.reason}</p>
            </div>
          )}

          {/* Contacts */}
          {(item.contacts?.length > 0 || item.contact_name) && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Contacts</label>
              {item.contacts ? (
                <div className="space-y-1">
                  {item.contacts.map((c, i) => (
                    <div key={i} className="text-sm text-gray-700">
                      {c.name} {c.email && <span className="text-xs text-gray-400">&lt;{c.email}&gt;</span>}
                      {c.title && <span className="text-xs text-gray-400 ml-1">({c.title})</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-700">
                  {item.contact_name}{' '}
                  {item.contact_email && (
                    <span className="text-xs text-gray-400">&lt;{item.contact_email}&gt;</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] resize-none"
              placeholder="Notes..."
            />
          </div>

          {/* Status + Follow-up */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              >
                {STATUSES.filter((s) => s !== 'all').map((s) => (
                  <option key={s} value={s}>
                    {s === 'in_convo' ? 'In Conversation' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Follow-up Date</label>
              <input
                type="date"
                value={followupDate ? followupDate.split('T')[0] : ''}
                onChange={(e) => setFollowupDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 flex-wrap">
            <button
              onClick={handleDraftEmail}
              disabled={drafting}
              className="bg-[#1F2D3D] hover:bg-[#2C3E50] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {drafting ? 'Drafting...' : 'Draft Email'}
            </button>
            {firstEmail && (
              <button
                onClick={handleSendGmail}
                disabled={sending}
                className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                title={`Create Gmail draft to ${firstEmail}`}
              >
                {sending ? 'Sending...' : 'Create Gmail Draft'}
              </button>
            )}
            <button
              onClick={handleSave}
              className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
