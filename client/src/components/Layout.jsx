import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import ChangelogModal from './ChangelogModal';

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: DashboardIcon },
    ],
  },
  {
    label: 'Email Outreach',
    items: [
      { to: '/queue', label: 'Queue', icon: QueueIcon, badgeKey: 'queue' },
      { to: '/outreach/recruiters', label: 'Recruiters', icon: RecruitersIcon },
      { to: '/outreach/ceos', label: 'Direct CEO', icon: CeoIcon },
      { to: '/outreach/vcs', label: 'VC Firms', icon: VcIcon },
    ],
  },
  {
    label: 'Applications',
    items: [
      { to: '/applications', label: 'Applications', icon: AppsIcon, badgeKey: 'apps' },
      { to: '/job-board', label: 'Job Board', icon: BoardIcon, badgeKey: 'board' },
    ],
  },
  {
    label: 'Networking',
    items: [
      { to: '/events', label: 'Events & Meetings', icon: EventsIcon },
    ],
  },
];

function getPageTitle(pathname) {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/queue') return 'Morning Queue';
  if (pathname === '/outreach/recruiters') return 'Recruiter Outreach';
  if (pathname === '/outreach/ceos') return 'Direct CEO Outreach';
  if (pathname === '/outreach/vcs') return 'VC Firm Outreach';
  if (pathname === '/applications') return 'Applications';
  if (pathname === '/job-board') return 'Job Board';
  if (pathname === '/events') return 'Events & Meetings';
  if (pathname === '/settings') return 'Settings';
  if (pathname === '/admin') return 'Admin';
  return 'Snag';
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const pageTitle = getPageTitle(location.pathname);

  const navSections = user?.isAdmin
    ? [...NAV_SECTIONS, { label: 'Admin', items: [{ to: '/admin', label: 'Admin', icon: AdminIcon }] }]
    : NAV_SECTIONS;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-[#1F2D3D] text-white flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
          <div className="w-8 h-8 bg-[#F97316] rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">Snag</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {navSections.map((section) => (
            <div key={section.label} className="mb-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 px-3 mb-2">
                {section.label}
              </p>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5 ${
                      isActive
                        ? 'bg-[#F97316]/15 text-[#F97316] border-l-3 border-[#F97316]'
                        : 'text-gray-300 hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 px-4 py-4">
          <div className="text-xs text-gray-400 truncate mb-2">{user?.email}</div>
          <div className="flex items-center justify-between">
            <NavLink
              to="/settings"
              onClick={() => setSidebarOpen(false)}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Settings
            </NavLink>
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
            >
              Logout
            </button>
          </div>
          <button
            onClick={() => setChangelogOpen(true)}
            className="text-[10px] text-gray-500 hover:text-[#F97316] mt-2 cursor-pointer transition-colors"
          >
            v10.0 — changelog
          </button>
        </div>
      </aside>

      {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 lg:px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-600 hover:text-gray-900 cursor-pointer"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-[#1F2D3D]">{pageTitle}</h1>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/* ── Icon Components ── */

function DashboardIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function QueueIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function RecruitersIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function CeoIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

function VcIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function AppsIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function BoardIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function EventsIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function AdminIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}
