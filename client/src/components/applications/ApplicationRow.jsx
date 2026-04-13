import { useState } from 'react';

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
          {app.applied_date ? new Date(app.applied_date + 'T12:00:00').toLocaleDateString()
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
          {followUp ? new Date(followUp + 'T12:00:00').toLocaleDateString() : '--'}
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
            <div className="text-xs text-gray-400">Expanded details coming in the next task.</div>
          </td>
        </tr>
      )}
    </>
  );
}

export const STATUS_INFO = {
  identified: { label: 'Identified', color: 'bg-gray-100 text-gray-700' },
  ready_to_apply: { label: 'Ready to Apply', color: 'bg-purple-50 text-purple-700' },
  applied: { label: 'Applied', color: 'bg-[#F97316]/10 text-[#F97316]' },
  interviewing: { label: 'Interviewing', color: 'bg-amber-50 text-amber-700' },
  closed: { label: 'Closed', color: 'bg-gray-100 text-gray-500' },
};
