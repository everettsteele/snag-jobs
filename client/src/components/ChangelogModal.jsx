const VERSIONS = [
  {
    version: 'v10.0',
    date: 'Apr 12, 2026',
    label: 'Commercial rebase — Postgres, Stripe, resumes, AI email drafts',
    changes: [
      { tag: 'new', text: 'Full PostgreSQL multi-tenant architecture' },
      { tag: 'new', text: 'React SPA frontend (replaced legacy vanilla JS)' },
      { tag: 'new', text: 'Resume upload system with PDF parsing for AI context' },
      { tag: 'new', text: 'AI email draft generation (recruiter/CEO/VC prompts)' },
      { tag: 'new', text: 'Stripe billing with free/pro tiers' },
      { tag: 'new', text: 'Job board config UI with source selection and location filters' },
      { tag: 'new', text: 'AI usage tracking — 3/week free, unlimited Pro' },
      { tag: 'new', text: 'Chrome extension rewired to tracker API with dedup' },
    ],
  },
  {
    version: 'v9.0',
    date: 'Apr 10, 2026',
    label: 'React frontend — Queue, Events, Settings, Outreach',
    changes: [
      { tag: 'new', text: 'Complete React SPA with all pages migrated' },
      { tag: 'new', text: 'Google OAuth (Drive, Gmail, Calendar)' },
      { tag: 'new', text: 'Per-user crawler config and parameterized AI prompts' },
    ],
  },
  {
    version: 'v7.7',
    date: 'Apr 9, 2026',
    label: 'Skip persists, cover letters, async crawl',
    changes: [
      { tag: 'fix', text: 'Skip stays gone even when Snag re-renders' },
      { tag: 'fix', text: 'Build Queued Packages generates cover letters for LinkedIn' },
      { tag: 'fix', text: 'Crawl Now button resets immediately; runs in background' },
      { tag: 'new', text: 'Cover Letter button; opens printable page' },
    ],
  },
  {
    version: 'v7.6',
    date: 'Apr 8, 2026',
    label: 'Tab persistence, event delegation, Drive URL paste',
    changes: [
      { tag: 'new', text: 'Tab persists across refreshes via localStorage' },
      { tag: 'fix', text: 'Skip and Snag use document-level event delegation' },
      { tag: 'new', text: 'NO PKG badge clickable to paste Drive URL per app' },
    ],
  },
];

const TAG_STYLES = {
  new: 'bg-green-50 text-green-700',
  fix: 'bg-blue-50 text-blue-700',
  change: 'bg-amber-50 text-amber-700',
};

export default function ChangelogModal({ onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-[#1F2D3D]">Snag Changelog</h2>
            <p className="text-xs text-gray-500 mt-0.5">Built instead of applying.</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none cursor-pointer"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-6 space-y-6">
          {VERSIONS.map((v, idx) => (
            <div key={v.version}>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded ${idx === 0 ? 'bg-[#F97316] text-white' : 'bg-gray-100 text-gray-600'}`}
                >
                  {v.version}
                </span>
                <span className="text-xs text-gray-500 font-medium">{v.label}</span>
                <span className="text-xs text-gray-400 ml-auto">{v.date}</span>
              </div>
              <ul className="space-y-1 ml-1">
                {v.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded mt-0.5 ${TAG_STYLES[c.tag] || TAG_STYLES.change}`}>
                      {c.tag}
                    </span>
                    <span className="flex-1">{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
