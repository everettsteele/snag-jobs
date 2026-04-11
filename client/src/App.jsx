import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import QueuePage from './pages/Queue';
import ApplicationsPage from './pages/Applications';
import JobBoardPage from './pages/JobBoard';
import EventsPage from './pages/Events';
import SettingsPage from './pages/Settings';
import OutreachPage from './pages/Outreach';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#F97316] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/outreach/:pillar" element={<OutreachPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/job-board" element={<JobBoardPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
