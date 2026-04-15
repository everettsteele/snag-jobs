import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import InterviewChat from './InterviewChat';
import PrepBriefCard from './PrepBriefCard';
import DebriefList from './DebriefList';

export default function ApplicationRow({
  app, variants = [], selected, onToggleSelect,
  onUpdate, onDelete, onShowCoverLetter,
}) {
  const [expanded, setExpanded] = useState(false);

  const statusInfo = STATUS_INFO[app.status] || STATUS_INFO.identified;
  const followUp = app.follow_up_date || app.followup_date;
  const sourceUrl = app.source_url || app.url;
  const hasCoverLetter = !!app.cover_letter_text;
  const snoozed = !!app.snoozed_until;

  return (
    <>
      <tr
        className={`border-b border-gray-50 hover:bg-gray-50/50 ${expanded ? 'bg-gray-50' : ''}`}
        onClick={(e) => {
          const tag = (e.target.tagName || '').toUpperCase();
          if (['INPUT', 'SELECT', 'BUTTON', 'A', 'OPTION', 'LABEL', 'TEXTAREA'].includes(tag)) return;
          if (e.target.closest('.row-action')) return;
          setExpanded((v) => !v);
        }}
      >
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="w-4 h-4 accent-[#F97316] cursor-pointer"
          />
        </td>
        <td className="px-4 py-3">
          <div className="font-medium text-[#1F2D3D] flex items-center gap-1.5">
            {app.company}
            {snoozed && <span title={`Snoozed until ${app.snoozed_until}`}>💤</span>}
          </div>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
               className="text-xs text-[#F97316] hover:underline"
               onClick={(e) => e.stopPropagation()}>View posting</a>
          )}
        </td>
        <td className="px-4 py-3 text-gray-700">{app.role || '--'}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">
          {app.applied_date ? new Date(String(app.applied_date).slice(0, 10) + 'T12:00:00').toLocaleDateString()
            : app.created_at ? new Date(app.created_at).toLocaleDateString() : '--'}
        </td>
        <td className="px-4 py-3">
          <select
            value={app.status}
            onChange={(e) => onUpdate({ status: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${statusInfo.color}`}
          >
            {Object.entries(STATUS_INFO).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          {app.status === 'closed' && app.closed_reason && (
            <span className="ml-2 text-[10px] text-gray-500 uppercase tracking-wide">
              {app.closed_reason}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">
          {followUp ? new Date(String(followUp).slice(0, 10) + 'T12:00:00').toLocaleDateString() : '--'}
        </td>
        <td className="px-2 py-3 text-xs">
          <select
            value={app.resume_variant || ''}
            onChange={(e) => onUpdate({ resume_variant: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            title={variants.find((v) => v.slug === app.resume_variant)?.label || app.resume_variant || 'No resume selected'}
            className="text-xs border border-gray-200 rounded px-1 py-1 cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[#F97316] w-[82px] truncate"
          >
            <option value="">—</option>
            {variants.map((v) => (
              <option key={v.slug} value={v.slug} title={v.label || v.slug}>{v.slug}</option>
            ))}
            {app.resume_variant && !variants.some((v) => v.slug === app.resume_variant) && (
              <option value={app.resume_variant}>{app.resume_variant}</option>
            )}
          </select>
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="row-action flex items-center gap-1">
            <button
              type="button"
              disabled={!sourceUrl || !hasCoverLetter}
              onClick={() => {
                if (sourceUrl) window.open(sourceUrl, '_blank', 'noopener');
                if (app.drive_url) window.open(app.drive_url, '_blank', 'noopener');
                if (app.status === 'ready_to_apply') onUpdate({ status: 'applied' });
              }}
              title={!sourceUrl ? 'No posting URL' : !hasCoverLetter ? 'Generate a cover letter first' : 'Open posting + Drive, mark applied'}
              className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-2 py-1 rounded disabled:opacity-40 cursor-pointer"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => onShowCoverLetter(app)}
              title="View cover letter"
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded cursor-pointer"
            >
              CL
            </button>
            <button
              type="button"
              onClick={onDelete}
              title="Delete"
              className="text-xs bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-600 px-2 py-1 rounded cursor-pointer"
            >
              ×
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={8} className="px-6 py-4">
            <ExpandedDetail app={app} onUpdate={onUpdate} variants={variants} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetail({ app, onUpdate, variants }) {
  const [tab, setTab] = useState(app.status === 'interviewing' ? 'interview' : 'timeline');
  const activity = Array.isArray(app.activity) ? app.activity : [];
  const variantRow = variants.find((v) => v.slug === app.resume_variant);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="flex items-center gap-1 border-b border-gray-100 px-3 pt-2">
        {[
          ['timeline', 'Timeline'],
          ['company', 'Company'],
          ['notes', 'Notes'],
          ['people', 'People'],
          ['materials', 'Materials'],
          ...(app.status === 'interviewing' ? [['interview', 'Interview Prep']] : []),
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`text-xs font-medium px-3 py-1.5 border-b-2 cursor-pointer ${
              tab === k ? 'border-[#F97316] text-[#F97316]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'timeline' && <TimelineTab activity={activity} />}
        {tab === 'company' && <CompanyTab app={app} />}
        {tab === 'notes' && <NotesTab app={app} onUpdate={onUpdate} />}
        {tab === 'people' && <PeopleTab app={app} />}
        {tab === 'materials' && <MaterialsTab app={app} variantRow={variantRow} />}
        {tab === 'interview' && <InterviewTabLazy app={app} />}
      </div>
    </div>
  );
}

function TimelineTab({ activity }) {
  if (!activity.length) return <div className="text-xs text-gray-400">No activity yet.</div>;
  const reversed = [...activity].reverse();
  return (
    <ul className="space-y-1.5 max-h-64 overflow-y-auto">
      {reversed.map((e, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          <span className="text-gray-400 whitespace-nowrap w-20">{e.date || ''}</span>
          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded font-medium uppercase tracking-wide text-[10px]">
            {e.type}
          </span>
          <span className="flex-1 text-gray-600">{e.note || ''}</span>
        </li>
      ))}
    </ul>
  );
}

function NotesTab({ app, onUpdate }) {
  const [text, setText] = useState(app.notes || '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setText(app.notes || ''); setDirty(false); }, [app.id]);

  const save = () => {
    if (!dirty) return;
    onUpdate({ notes: text });
    setDirty(false);
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setDirty(true); }}
        onBlur={save}
        rows={6}
        placeholder="Notes about this application..."
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#F97316]"
      />
      <div className="mt-1 text-[10px] text-gray-400">
        {dirty ? 'Unsaved — click outside to save' : 'Saved'}
      </div>
    </div>
  );
}

function MaterialsTab({ app, variantRow }) {
  const [resumeText, setResumeText] = useState(null);
  useEffect(() => {
    let cancel = false;
    if (!app.resume_variant) { setResumeText(''); return; }
    api.get(`/resumes/${app.resume_variant}/text`)
      .then((d) => { if (!cancel) setResumeText(d?.parsed_text || ''); })
      .catch(() => { if (!cancel) setResumeText(''); });
    return () => { cancel = true; };
  }, [app.resume_variant]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-[#1F2D3D]">Cover Letter</span>
          {app.cover_letter_text && (
            <button
              onClick={() => navigator.clipboard.writeText(app.cover_letter_text)}
              className="text-[10px] text-[#F97316] hover:underline cursor-pointer"
            >Copy</button>
          )}
        </div>
        <pre className="text-xs bg-gray-50 rounded border border-gray-200 p-3 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
          {app.cover_letter_text || '(not generated yet)'}
        </pre>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-[#1F2D3D]">
            Resume — {variantRow?.label || app.resume_variant || '(none)'}
          </span>
          {resumeText && (
            <button
              onClick={() => navigator.clipboard.writeText(resumeText)}
              className="text-[10px] text-[#F97316] hover:underline cursor-pointer"
            >Copy</button>
          )}
        </div>
        <pre className="text-xs bg-gray-50 rounded border border-gray-200 p-3 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
          {resumeText === null ? 'Loading...' : (resumeText || '(no variant attached)')}
        </pre>
      </div>
    </div>
  );
}

const CONTACT_KINDS = [
  { value: 'hiring_manager', label: 'Hiring Manager' },
  { value: 'recruiter',      label: 'Recruiter' },
  { value: 'interviewer',    label: 'Interviewer' },
  { value: 'referrer',       label: 'Referrer' },
  { value: 'other',          label: 'Other' },
];

function PeopleTab({ app }) {
  const qc = useQueryClient();
  const { data: contacts = [] } = useQuery({
    queryKey: ['app-contacts', app.id],
    queryFn: () => api.get(`/applications/${app.id}/contacts`),
  });

  const createMut = useMutation({
    mutationFn: (data) => api.post(`/applications/${app.id}/contacts`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-contacts', app.id] }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => api.patch(`/applications/contacts/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-contacts', app.id] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => api.del(`/applications/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-contacts', app.id] }),
  });

  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="space-y-2 mb-3">
        {contacts.length === 0 && !adding && (
          <div className="text-xs text-gray-400">No people yet.</div>
        )}
        {contacts.map((c) => (
          <ContactRow key={c.id} contact={c}
                      onUpdate={(data) => updateMut.mutate({ id: c.id, ...data })}
                      onDelete={() => deleteMut.mutate(c.id)} />
        ))}
      </div>
      {adding ? (
        <ContactForm onSave={(d) => { createMut.mutate(d); setAdding(false); }}
                     onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)}
                className="text-xs text-[#F97316] hover:text-[#EA580C] cursor-pointer">
          + Add person
        </button>
      )}
    </div>
  );
}

function ContactRow({ contact, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const kindLabel = CONTACT_KINDS.find((k) => k.value === contact.kind)?.label || contact.kind;
  if (editing) {
    return <ContactForm initial={contact} onSave={(d) => { onUpdate(d); setEditing(false); }}
                        onCancel={() => setEditing(false)} />;
  }
  return (
    <div className="flex items-start gap-3 border border-gray-200 rounded-lg bg-white px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#1F2D3D]">
          {contact.name}
          {contact.title && <span className="text-gray-500 font-normal"> — {contact.title}</span>}
        </div>
        <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
          <span className="uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded font-medium">{kindLabel}</span>
          {contact.email && <a href={`mailto:${contact.email}`} className="hover:text-[#F97316]">{contact.email}</a>}
          {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer"
                                     className="hover:text-[#F97316]">LinkedIn</a>}
        </div>
        {contact.notes && <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{contact.notes}</div>}
      </div>
      <button onClick={() => setEditing(true)} className="text-[11px] text-gray-500 hover:text-[#F97316] cursor-pointer">Edit</button>
      <button onClick={onDelete} className="text-[11px] text-gray-400 hover:text-red-600 cursor-pointer">×</button>
    </div>
  );
}

function ContactForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    title: initial?.title || '',
    email: initial?.email || '',
    linkedin_url: initial?.linkedin_url || '',
    kind: initial?.kind || 'interviewer',
    notes: initial?.notes || '',
  });
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const canSave = f.name.trim().length > 0;

  return (
    <div className="border border-[#F97316]/30 bg-[#F97316]/5 rounded-lg px-3 py-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input placeholder="Name *" value={f.name} onChange={(e) => set('name', e.target.value)}
               className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
        <input placeholder="Title" value={f.title} onChange={(e) => set('title', e.target.value)}
               className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
        <input placeholder="Email" value={f.email} onChange={(e) => set('email', e.target.value)}
               className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
        <input placeholder="LinkedIn URL" value={f.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)}
               className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
        <select value={f.kind} onChange={(e) => set('kind', e.target.value)}
                className="text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#F97316]">
          {CONTACT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <textarea placeholder="Notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
                className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#F97316]" />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">Cancel</button>
        <button onClick={() => canSave && onSave(f)} disabled={!canSave}
                className="text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-3 py-1 rounded cursor-pointer disabled:opacity-50">
          Save
        </button>
      </div>
    </div>
  );
}

function CompanyTab({ app }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['app-dossier', app.id],
    queryFn: () => api.get(`/applications/${app.id}/dossier`),
  });

  const buildMut = useMutation({
    mutationFn: (body) => api.post(`/applications/${app.id}/dossier/build`, body || {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-dossier', app.id] }),
  });

  if (isLoading) return <div className="text-xs text-gray-400 py-4">Loading dossier...</div>;
  if (error) return <div className="text-xs text-red-600 py-4">{error.message}</div>;

  const { dossier, stale, quota } = data || {};
  const isPro = !!quota?.pro;
  const remaining = quota?.remaining ?? 0;

  if (!dossier) {
    if (!isPro && remaining <= 0) {
      return (
        <div className="text-center py-6">
          <div className="text-sm font-semibold text-[#1F2D3D] mb-1">You've used your weekly dossier quota</div>
          <p className="text-xs text-gray-500 mb-3">
            Upgrade to Pro for unlimited company dossiers and refresh-on-demand.
          </p>
          <a href="/settings#billing" className="inline-block text-xs bg-[#F97316] hover:bg-[#EA580C] text-white px-4 py-2 rounded-lg">
            Upgrade to Pro
          </a>
        </div>
      );
    }
    return (
      <div className="text-center py-6">
        <p className="text-xs text-gray-500 mb-3">
          No dossier for this company yet. Build one to see a summary, key facts, and detected links.
        </p>
        <button
          onClick={() => buildMut.mutate()}
          disabled={buildMut.isPending}
          className="text-sm bg-[#F97316] hover:bg-[#EA580C] text-white px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          {buildMut.isPending
            ? 'Building...'
            : isPro ? 'Build dossier' : `Build dossier (${remaining} left this week)`}
        </button>
        {buildMut.error && (
          <div className="text-xs text-red-600 mt-2">{buildMut.error.message}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stale && (
        <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2 flex items-center justify-between">
          <span>Dossier is over 30 days old.</span>
          {isPro ? (
            <button
              onClick={() => buildMut.mutate({ refresh: true })}
              disabled={buildMut.isPending}
              className="text-xs bg-white hover:bg-amber-100 border border-amber-300 px-2 py-0.5 rounded cursor-pointer disabled:opacity-50"
            >
              {buildMut.isPending ? 'Refreshing...' : 'Refresh'}
            </button>
          ) : (
            <a href="/settings#billing" className="text-xs underline hover:text-amber-900">Upgrade to refresh</a>
          )}
        </div>
      )}

      <div>
        <div className="text-sm font-semibold text-[#1F2D3D] mb-1">
          {dossier.display_name}
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">{dossier.summary}</p>
      </div>

      {Array.isArray(dossier.facts) && dossier.facts.length > 0 && (
        <ul className="space-y-1">
          {dossier.facts.map((f, i) => (
            <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
              <span className="w-1 h-1 rounded-full bg-[#F97316] mt-1.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}

      {dossier.links && Object.keys(dossier.links).length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {Object.entries(dossier.links).map(([k, v]) => (
            <a
              key={k}
              href={v}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full"
            >
              {k}
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1">
        <span>
          Last refreshed {dossier.updated_at ? new Date(dossier.updated_at).toLocaleDateString() : 'unknown'}
        </span>
        {isPro && !stale && (
          <button
            onClick={() => buildMut.mutate({ refresh: true })}
            disabled={buildMut.isPending}
            className="hover:text-[#F97316] cursor-pointer"
          >
            {buildMut.isPending ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );
}

function InterviewTabLazy({ app }) {
  return (
    <div>
      <PrepBriefCard app={app} />
      <InterviewChat app={app} />
      <DebriefList app={app} />
    </div>
  );
}

export const STATUS_INFO = {
  identified: { label: 'Identified', color: 'bg-gray-100 text-gray-700' },
  ready_to_apply: { label: 'Ready to Apply', color: 'bg-purple-50 text-purple-700' },
  applied: { label: 'Applied', color: 'bg-[#F97316]/10 text-[#F97316]' },
  interviewing: { label: 'Interviewing', color: 'bg-amber-50 text-amber-700' },
  closed: { label: 'Closed', color: 'bg-gray-100 text-gray-500' },
};
