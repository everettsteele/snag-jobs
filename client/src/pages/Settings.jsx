import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';

export default function SettingsPage() {
  const { profile, updateProfile } = useAuth();
  const { toast } = useToast();

  return (
    <div className="max-w-3xl space-y-8">
      <ProfileSection profile={profile} updateProfile={updateProfile} toast={toast} />
      <SignatureSection profile={profile} updateProfile={updateProfile} toast={toast} />
      <PreferencesSection profile={profile} updateProfile={updateProfile} toast={toast} />
      <GoogleSection profile={profile} toast={toast} />
      <CalendarPickerSection profile={profile} toast={toast} />
      <ApiKeySection toast={toast} />
      <BillingSection toast={toast} />
      <ResumeSection />
      <PrivacySection profile={profile} updateProfile={updateProfile} toast={toast} />
      <JobSearchSection toast={toast} />
    </div>
  );
}

function ProfileSection({ profile, updateProfile, toast }) {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    linkedin_url: '',
    location: '',
    background: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name || profile.fullName || '',
        phone: profile.phone || '',
        linkedin_url: profile.linkedin_url || profile.linkedinUrl || '',
        location: profile.location || '',
        background: profile.background_text || profile.backgroundText || '',
      });
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({
        full_name: form.full_name,
        phone: form.phone,
        linkedin_url: form.linkedin_url,
        location: form.location,
        background_text: form.background,
      });
      toast('Profile saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-4">Profile</h3>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Full Name"
            value={form.full_name}
            onChange={(v) => setForm({ ...form, full_name: v })}
          />
          <Field
            label="Phone"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <div className="text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
            {profile?.email || '--'}
          </div>
        </div>
        <Field
          label="LinkedIn URL"
          value={form.linkedin_url}
          onChange={(v) => setForm({ ...form, linkedin_url: v })}
          placeholder="https://linkedin.com/in/..."
        />
        <Field
          label="Location"
          value={form.location}
          onChange={(v) => setForm({ ...form, location: v })}
          placeholder="San Francisco, CA"
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Background</label>
          <textarea
            value={form.background}
            onChange={(e) => setForm({ ...form, background: e.target.value })}
            rows={5}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] resize-none"
            placeholder="Brief professional background..."
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreferencesSection({ profile, updateProfile, toast }) {
  const [targetRoles, setTargetRoles] = useState('');
  const [targetGeo, setTargetGeo] = useState('');
  const [dailyTarget, setDailyTarget] = useState(10);
  const [weeklyOutreach, setWeeklyOutreach] = useState(50);
  const [weeklyApps, setWeeklyApps] = useState(10);
  const [weeklyEvents, setWeeklyEvents] = useState(2);
  const [weeklyFollowups, setWeeklyFollowups] = useState(10);
  const [roleInput, setRoleInput] = useState('');
  const [geoInput, setGeoInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setTargetRoles(
        Array.isArray(profile.targetRoles || profile.target_roles)
          ? (profile.targetRoles || profile.target_roles).join(', ')
          : (profile.targetRoles || profile.target_roles) || ''
      );
      setTargetGeo(
        Array.isArray(profile.targetGeography || profile.target_geography)
          ? (profile.targetGeography || profile.target_geography).join(', ')
          : (profile.targetGeography || profile.target_geography) || ''
      );
      setDailyTarget(profile.dailyOutreachTarget || profile.daily_outreach_target || 10);
      setWeeklyOutreach(profile.weeklyOutreachTarget ?? profile.weekly_outreach_target ?? 50);
      setWeeklyApps(profile.weeklyAppsTarget ?? profile.weekly_apps_target ?? 10);
      setWeeklyEvents(profile.weeklyEventsTarget ?? profile.weekly_events_target ?? 2);
      setWeeklyFollowups(profile.weeklyFollowupsTarget ?? profile.weekly_followups_target ?? 10);
    }
  }, [profile]);

  const roles = targetRoles
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const geos = targetGeo
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  const addRole = () => {
    if (!roleInput.trim()) return;
    const updated = [...roles, roleInput.trim()].join(', ');
    setTargetRoles(updated);
    setRoleInput('');
  };

  const removeRole = (idx) => {
    const updated = roles.filter((_, i) => i !== idx).join(', ');
    setTargetRoles(updated);
  };

  const addGeo = () => {
    if (!geoInput.trim()) return;
    const updated = [...geos, geoInput.trim()].join(', ');
    setTargetGeo(updated);
    setGeoInput('');
  };

  const removeGeo = (idx) => {
    const updated = geos.filter((_, i) => i !== idx).join(', ');
    setTargetGeo(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({
        target_roles: roles,
        target_geography: geos,
        daily_outreach_target: dailyTarget,
        weekly_outreach_target: weeklyOutreach,
        weekly_apps_target: weeklyApps,
        weekly_events_target: weeklyEvents,
        weekly_followups_target: weeklyFollowups,
      });
      toast('Preferences saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-4">Job Search Preferences</h3>
      <div className="space-y-4">
        {/* Target Roles */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Target Roles</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {roles.map((role, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-[#F97316]/10 text-[#F97316] text-xs font-medium px-2 py-1 rounded-full"
              >
                {role}
                <button
                  onClick={() => removeRole(i)}
                  className="text-[#F97316] hover:text-[#EA580C] cursor-pointer"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRole())}
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              placeholder="Add role (e.g., VP Engineering)"
            />
            <button
              onClick={addRole}
              className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        {/* Target Geography */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Target Geography</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {geos.map((geo, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2 py-1 rounded-full"
              >
                {geo}
                <button
                  onClick={() => removeGeo(i)}
                  className="text-blue-700 hover:text-blue-900 cursor-pointer"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={geoInput}
              onChange={(e) => setGeoInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addGeo())}
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
              placeholder="Add location (e.g., Remote, NYC)"
            />
            <button
              onClick={addGeo}
              className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        {/* Daily Target */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Daily Outreach Target
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={dailyTarget}
            onChange={(e) => setDailyTarget(parseInt(e.target.value) || 10)}
            className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
          />
          <p className="text-xs text-gray-400 mt-1">How many outreach emails Morning Sync should draft each day.</p>
        </div>

        {/* Weekly targets */}
        <div className="border-t border-gray-100 pt-4">
          <div className="text-sm font-medium text-gray-700 mb-1">Weekly Targets (for Snag Metrics dashboard)</div>
          <p className="text-xs text-gray-400 mb-3">
            Your weekly goals. The dashboard shows progress toward these each week.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <TargetInput label="Outreach emails" value={weeklyOutreach} onChange={setWeeklyOutreach} max={500} hint="Emails sent to recruiters/CEOs/VCs" />
            <TargetInput label="Applications" value={weeklyApps} onChange={setWeeklyApps} max={100} hint="Jobs you formally apply to" />
            <TargetInput label="Networking events" value={weeklyEvents} onChange={setWeeklyEvents} max={20} hint="Coffees, meetups, calls" />
            <TargetInput label="Follow-ups handled" value={weeklyFollowups} onChange={setWeeklyFollowups} max={100} hint="Pending follow-ups to clear (lower is better)" />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleSection({ profile, toast }) {
  const [connecting, setConnecting] = useState(false);

  const googleEmail = profile?.google_email || profile?.preferences?.google_email;

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const data = await api.get('/google/auth');
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      toast(err.message, 'error');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.post('/google/disconnect');
      toast('Google disconnected');
      window.location.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-[#1F2D3D]">Google Integration</h3>
        <a
          href="https://github.com/everettsteele/meridian-recruiter-tracker/blob/main/docs/GOOGLE_SETUP.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-[#F97316] cursor-pointer"
        >
          Setup guide →
        </a>
      </div>
      {googleEmail ? (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">
              Connected as <span className="font-medium">{googleEmail}</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Gmail sending and calendar sync enabled</p>
          </div>
          <button
            onClick={handleDisconnect}
            className="text-sm text-red-600 hover:text-red-700 font-medium cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Connect your Google account for email sending</p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="bg-[#1F2D3D] hover:bg-[#2C3E50] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {connecting ? 'Connecting...' : 'Connect Google'}
          </button>
        </div>
      )}
    </div>
  );
}

function CalendarPickerSection({ profile, toast }) {
  const [calendars, setCalendars] = useState(null);
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const googleEmail = profile?.google_email || profile?.preferences?.google_email;

  useEffect(() => {
    if (!googleEmail) return;
    Promise.all([
      api.get('/google/calendar/list').catch(() => []),
      api.get('/networking/calendar-config').catch(() => ({})),
    ]).then(([cals, cfg]) => {
      setCalendars(cals);
      setConfig(cfg);
    });
  }, [googleEmail]);

  if (!googleEmail) return null;

  const whitelisted = config?.whitelisted_calendar_ids || [];
  const isPrimaryOnly = !config?.setup_complete || whitelisted.length === 0;

  const toggleCalendar = (calId) => {
    const next = whitelisted.includes(calId)
      ? whitelisted.filter((id) => id !== calId)
      : [...whitelisted, calId];
    setConfig({ ...config, whitelisted_calendar_ids: next });
  };

  const setPrimaryOnly = () => {
    setConfig({ ...config, whitelisted_calendar_ids: [], setup_complete: false });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const names = {};
      (calendars || []).forEach((c) => {
        if (whitelisted.includes(c.id)) names[c.id] = c.name;
      });
      await api.post('/networking/calendar-config', {
        whitelisted_calendar_ids: whitelisted,
        whitelisted_calendar_names: names,
        setup_complete: whitelisted.length > 0,
      });
      toast('Calendar config saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-2">Calendar Sync</h3>
      <p className="text-xs text-gray-500 mb-4">
        Pick which calendars to pull into Events. Default is your primary calendar only.
      </p>

      <div className="mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={isPrimaryOnly}
            onChange={setPrimaryOnly}
            className="w-4 h-4 accent-[#F97316]"
          />
          <span className="text-sm text-gray-700 font-medium">Primary calendar only (recommended)</span>
        </label>
        <p className="text-xs text-gray-400 ml-6 mt-0.5">
          Filters out all-day events, declined meetings, and cancellations.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input
            type="radio"
            checked={!isPrimaryOnly}
            onChange={() => { if (whitelisted.length === 0 && calendars?.length) toggleCalendar(calendars[0].id); }}
            className="w-4 h-4 accent-[#F97316]"
          />
          <span className="text-sm text-gray-700 font-medium">Pick specific calendars</span>
        </label>

        {!isPrimaryOnly && (
          <div className="ml-6 space-y-1.5 max-h-60 overflow-y-auto">
            {!calendars ? (
              <p className="text-xs text-gray-400">Loading calendars...</p>
            ) : calendars.length === 0 ? (
              <p className="text-xs text-gray-400">No calendars found.</p>
            ) : (
              calendars.map((c) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer bg-gray-50 px-3 py-1.5 rounded hover:bg-gray-100">
                  <input
                    type="checkbox"
                    checked={whitelisted.includes(c.id)}
                    onChange={() => toggleCalendar(c.id)}
                    className="w-4 h-4 accent-[#F97316]"
                  />
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: c.backgroundColor || '#888' }}
                  />
                  <span className="text-sm text-gray-700 truncate flex-1">{c.name}</span>
                  {c.primary && <span className="text-[10px] text-[#F97316] font-bold">PRIMARY</span>}
                </label>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end mt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Calendar Config'}
        </button>
      </div>
    </div>
  );
}

function ApiKeySection({ toast }) {
  const [apiKey, setApiKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);

  useEffect(() => {
    api.get('/auth/api-key').then((d) => { setApiKey(d.apiKey); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    try {
      const d = await api.post('/auth/api-key');
      setApiKey(d.apiKey);
      setShow(true);
      toast('API key generated — copy it now');
    } catch (err) { toast(err.message, 'error'); }
  };

  const handleRevoke = async () => {
    if (!window.confirm('Revoke this API key? Chrome extension will stop working until you generate a new one.')) return;
    try {
      await api.del('/auth/api-key');
      setApiKey(null);
      setShow(false);
      toast('API key revoked');
    } catch (err) { toast(err.message, 'error'); }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey);
    toast('Copied to clipboard');
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-2">API Key</h3>
      <p className="text-xs text-gray-500 mb-4">
        Used by the Snag Chrome extension to save jobs directly into your tracker. Keep it private.
      </p>
      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : apiKey ? (
        <div className="space-y-3">
          <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-2">
            <code className="text-xs font-mono text-gray-700 flex-1 truncate">
              {show ? apiKey : '•'.repeat(48)}
            </code>
            <button onClick={() => setShow(!show)} className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">
              {show ? 'Hide' : 'Show'}
            </button>
            <button onClick={handleCopy} className="text-xs bg-[#1F2D3D] hover:bg-[#2C3E50] text-white px-3 py-1.5 rounded cursor-pointer">
              Copy
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={handleRevoke} className="text-xs text-red-600 hover:text-red-700 cursor-pointer">
              Revoke
            </button>
            <button onClick={handleGenerate} className="text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded cursor-pointer">
              Regenerate
            </button>
          </div>
        </div>
      ) : (
        <button onClick={handleGenerate} className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer">
          Generate API Key
        </button>
      )}
    </div>
  );
}

function BillingSection({ toast }) {
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/billing/status').then(setBilling).catch(() => {});
  }, []);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const data = await api.post('/billing/checkout');
      if (data.url) window.location.href = data.url;
    } catch (err) {
      toast(err.message || 'Billing not available', 'error');
      setLoading(false);
    }
  };

  const handlePortal = async () => {
    try {
      const data = await api.post('/billing/portal');
      if (data.url) window.location.href = data.url;
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const isPro = billing?.plan === 'pro';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-4">Billing</h3>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Current Plan:</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isPro ? 'bg-[#F97316]/10 text-[#F97316]' : 'bg-gray-100 text-gray-600'}`}>
              {isPro ? 'Pro' : 'Free'}
            </span>
          </div>
          {!isPro && (
            <p className="text-xs text-gray-500 mt-1">Upgrade for unlimited AI, 4 resume angles, outreach tracking, and more.</p>
          )}
        </div>
        <div>
          {isPro ? (
            <button
              onClick={handlePortal}
              className="text-sm text-gray-600 hover:text-gray-800 font-medium cursor-pointer"
            >
              Manage Billing
            </button>
          ) : (
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Upgrade to Pro — $10/mo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResumeSection() {
  const { user, profile } = useAuth();
  const isPro = !!user?.isPro;
  const variantLimit = isPro ? 4 : 1;
  const [variants, setVariants] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedAngles, setSelectedAngles] = useState([]);
  const [customAngle, setCustomAngle] = useState('');
  const [previewSlug, setPreviewSlug] = useState(null);
  const { toast } = useToast();

  const loadVariants = async () => {
    try {
      const data = await api.get('/resumes');
      setVariants(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load resumes:', e);
    }
  };

  useEffect(() => { loadVariants(); }, []);

  const targetRoles = profile?.target_roles || profile?.targetRoles || [];

  // Base = the slug='base' row if present, else fall back to any legacy variant that has an uploaded PDF.
  const base =
    variants.find((v) => v.slug === 'base' && (v.filename || v.has_content)) ||
    variants.find((v) => v.filename);
  const angles = variants.filter((v) => v !== base && v.has_content);
  const legacyEmpty = variants.filter((v) => v !== base && !v.has_content && !v.filename);

  const handleBaseUpload = async (file) => {
    if (!file || file.type !== 'application/pdf') {
      toast('Please select a PDF file', 'error');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('snag_token') || localStorage.getItem('hopespot_token') || '';
      const res = await fetch('/api/resumes/base/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
      toast('Base resume uploaded');
      loadVariants();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (slug) => {
    try {
      await api.del(`/resumes/${slug}`);
      toast('Removed');
      loadVariants();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggleAngle = (name) => {
    setSelectedAngles((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= variantLimit) {
        toast(`${isPro ? 'Pro' : 'Free'} plan allows up to ${variantLimit} variant${variantLimit === 1 ? '' : 's'}.`, 'error');
        return prev;
      }
      return [...prev, name];
    });
  };

  const addCustomAngle = () => {
    const name = customAngle.trim();
    if (!name) return;
    toggleAngle(name);
    setCustomAngle('');
  };

  const handleGenerate = async () => {
    if (!base) { toast('Upload a base resume first', 'error'); return; }
    if (!selectedAngles.length) { toast('Pick at least one angle', 'error'); return; }
    setGenerating(true);
    try {
      const result = await api.post('/resumes/generate-variants', {
        angles: selectedAngles.map((name) => ({
          name,
          source: targetRoles.includes(name) ? 'target_role' : 'custom',
        })),
      });
      const ok = result.results?.filter((r) => r.ok).length || 0;
      const failed = result.results?.filter((r) => !r.ok).length || 0;
      toast(`Generated ${ok} variant${ok === 1 ? '' : 's'}${failed > 0 ? ` (${failed} failed)` : ''}`);
      setSelectedAngles([]);
      loadVariants();
    } catch (err) {
      toast(err.message || 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleCleanupLegacy = async () => {
    if (!window.confirm(`Remove ${legacyEmpty.length} unused legacy variant slot${legacyEmpty.length === 1 ? '' : 's'}?`)) return;
    try {
      for (const v of legacyEmpty) {
        await api.del(`/resumes/${v.slug}`);
      }
      toast('Cleaned up');
      loadVariants();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const previewVariant = variants.find((v) => v.slug === previewSlug);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-2">Resumes</h3>
      <p className="text-xs text-gray-500 mb-4">
        Upload one base resume. Then generate up to {variantLimit} AI-angled variants tuned to the kinds of
        jobs you're targeting — each variant keeps your facts intact but reshapes the emphasis.
        {!isPro && <span className="text-[#F97316]"> Pro plan unlocks all 4 angles.</span>}
      </p>

      {/* Base resume card */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-[#1F2D3D]">Base Resume</span>
          {base?.text_length > 0 && (
            <span className="text-[11px] text-gray-400">{Math.round((base.text_length || 0) / 100) / 10}K chars parsed</span>
          )}
        </div>
        {base ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[#1F2D3D] truncate">{base.filename || '(generated text)'}</div>
              <div className="text-[11px] text-gray-400">Used as the source for AI variants and cover letters.</div>
            </div>
            <div className="flex items-center gap-3 ml-3">
              <label className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer">
                {uploading ? 'Uploading...' : 'Replace'}
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleBaseUpload(e.target.files[0])}
                />
              </label>
            </div>
          </div>
        ) : (
          <label className={`flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg py-8 cursor-pointer hover:border-[#F97316] hover:bg-[#F97316]/5 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <span className="text-sm font-medium text-gray-600 mb-1">
              {uploading ? 'Uploading...' : 'Upload your base resume'}
            </span>
            <span className="text-[11px] text-gray-400">PDF, text-based (scanned images won't work)</span>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => handleBaseUpload(e.target.files[0])}
            />
          </label>
        )}
      </div>

      {/* Angle selection & generation */}
      {base && (
        <div className="bg-gradient-to-r from-[#1F2D3D] to-[#2C3E50] text-white rounded-lg p-4 mb-4">
          <div className="text-sm font-semibold mb-0.5">Generate angled variants</div>
          <div className="text-xs text-white/70 mb-3">
            Pick the positionings you want to target{isPro ? ` (up to 4)` : ` (1 on Free)`}. We'll rewrite your base resume for each.
          </div>

          {targetRoles.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-wide text-white/50 mb-1.5">From your target roles</div>
              <div className="flex flex-wrap gap-1.5">
                {targetRoles.map((role) => {
                  const on = selectedAngles.includes(role);
                  const atLimit = !on && selectedAngles.length >= variantLimit;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => toggleAngle(role)}
                      disabled={atLimit}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        on
                          ? 'bg-[#F97316] border-[#F97316] text-white'
                          : atLimit
                          ? 'bg-white/5 border-white/10 text-white/30 cursor-not-allowed'
                          : 'bg-white/5 border-white/20 text-white hover:bg-white/10 cursor-pointer'
                      }`}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 mb-3">
            <input
              value={customAngle}
              onChange={(e) => setCustomAngle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomAngle())}
              placeholder="Add a custom angle (e.g. Chief of Staff at a Series B startup)"
              className="flex-1 px-3 py-1.5 rounded text-sm bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
            <button
              type="button"
              onClick={addCustomAngle}
              className="text-sm bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded cursor-pointer"
            >
              Add
            </button>
          </div>

          {selectedAngles.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] uppercase tracking-wide text-white/50 mb-1.5">
                Selected ({selectedAngles.length}/{variantLimit})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedAngles.map((name) => (
                  <span key={name} className="inline-flex items-center gap-1.5 text-xs bg-[#F97316] text-white px-2.5 py-1 rounded-full">
                    {name}
                    <button
                      type="button"
                      onClick={() => toggleAngle(name)}
                      className="hover:text-white/70 cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedAngles.length}
              className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-semibold px-4 py-1.5 rounded cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              {generating ? 'Generating...' : `Generate ${selectedAngles.length || ''} variant${selectedAngles.length === 1 ? '' : 's'}`.trim()}
            </button>
          </div>
        </div>
      )}

      {/* Generated variants list */}
      {angles.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-[#1F2D3D] mb-2">Your angled variants</div>
          {angles.map((v) => (
            <div key={v.slug} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#1F2D3D] truncate">{v.label}</div>
                <div className="text-[11px] text-gray-400">
                  {v.has_content ? `${Math.round((v.text_length || 0) / 100) / 10}K chars · AI-generated` : 'empty'}
                  <span className="ml-2 font-mono text-gray-300">{v.slug}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 ml-3">
                <button
                  onClick={() => setPreviewSlug(v.slug)}
                  className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer"
                >
                  View
                </button>
                <button
                  onClick={() => handleDelete(v.slug)}
                  className="text-xs text-red-500 hover:text-red-600 cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legacy cleanup prompt */}
      {legacyEmpty.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <span>
            {legacyEmpty.length} unused legacy variant slot{legacyEmpty.length === 1 ? '' : 's'} ({legacyEmpty.map((v) => v.slug).join(', ')}) — carried over from the old 4-slot model.
          </span>
          <button
            onClick={handleCleanupLegacy}
            className="text-xs text-amber-700 hover:text-amber-900 font-medium cursor-pointer whitespace-nowrap ml-3"
          >
            Clean up
          </button>
        </div>
      )}

      {previewVariant && (
        <ResumePreviewModal slug={previewVariant.slug} label={previewVariant.label} onClose={() => setPreviewSlug(null)} />
      )}
    </div>
  );
}

function ResumePreviewModal({ slug, label, onClose }) {
  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api.get(`/resumes/${slug}/text`)
      .then((d) => { if (!cancelled) setText(d?.parsed_text || ''); })
      .catch(() => { if (!cancelled) setText(''); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-[#1F2D3D]">{label}</h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{slug}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none cursor-pointer">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-gray-400 py-10">Loading...</div>
          ) : text ? (
            <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-4">{text}</pre>
          ) : (
            <div className="text-center text-gray-400 py-10">No text available.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PrivacySection({ profile, updateProfile, toast }) {
  const [saving, setSaving] = useState(false);
  const optIn = !(profile?.analytics_opt_out ?? profile?.analyticsOptOut ?? false);

  const handleToggle = async (e) => {
    const checked = e.target.checked;
    setSaving(true);
    try {
      await updateProfile({ analytics_opt_out: !checked });
      toast(checked ? 'Analytics opt-in on' : 'Opted out — Snag will stop logging your anonymized events');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-2">Privacy</h3>
      <p className="text-xs text-gray-500 mb-4">
        Snag logs anonymized patterns from your usage (status changes, variant selections, response rates) to power personal insights and make the product smarter for everyone. Never includes raw text from your resumes, cover letters, job descriptions, or notes.
      </p>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={optIn}
          disabled={saving}
          onChange={handleToggle}
          className="mt-0.5 w-4 h-4 accent-[#F97316] cursor-pointer"
        />
        <div>
          <div className="text-sm font-medium text-[#1F2D3D]">Help Snag get smarter</div>
          <div className="text-xs text-gray-500 mt-0.5">
            On by default. Uncheck to stop logging your anonymized events.
          </div>
        </div>
      </label>
    </div>
  );
}

function JobSearchSection({ toast }) {
  const { user } = useAuth();
  const isPro = !!user?.isPro;
  const FREE_SOURCE_LIMIT = 3;
  const [sources, setSources] = useState([]);
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [allowInput, setAllowInput] = useState('');
  const [denyInput, setDenyInput] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/job-board/sources'),
      api.get('/job-board/config'),
    ]).then(([sourcesData, configData]) => {
      setSources(sourcesData);
      setConfig(configData);
    });
  }, []);

  if (!config) return null;

  const enabled = config.enabled_sources || [];
  const allows = config.location_allow || [];
  const denies = config.location_deny || [];

  const toggleSource = (name) => {
    const isOn = enabled.includes(name);
    if (!isOn && !isPro && enabled.length >= FREE_SOURCE_LIMIT) {
      toast(`Free plan is limited to ${FREE_SOURCE_LIMIT} job boards. Upgrade to Pro to enable all sources.`, 'error');
      return;
    }
    const updated = isOn
      ? enabled.filter((n) => n !== name)
      : [...enabled, name];
    setConfig({ ...config, enabled_sources: updated });
  };

  const toggleAll = () => {
    if (!isPro) return;
    const allNames = sources.map((s) => s.name);
    const allOn = allNames.every((n) => enabled.includes(n));
    setConfig({ ...config, enabled_sources: allOn ? [] : allNames });
  };

  const addTag = (type, value) => {
    if (!value.trim()) return;
    const field = type === 'allow' ? 'location_allow' : 'location_deny';
    setConfig({ ...config, [field]: [...(config[field] || []), value.trim()] });
    if (type === 'allow') setAllowInput('');
    else setDenyInput('');
  };

  const removeTag = (type, idx) => {
    const field = type === 'allow' ? 'location_allow' : 'location_deny';
    const updated = (config[field] || []).filter((_, i) => i !== idx);
    setConfig({ ...config, [field]: updated });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/job-board/config', {
        enabled_sources: enabled,
        location_allow: allows,
        location_deny: denies,
        min_score: config.min_score || 3,
      });
      toast('Job search config saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-2">Job Board Crawler</h3>
      <p className="text-xs text-gray-500 mb-4">
        Choose which job boards to crawl and filter leads. The crawler runs daily at 6 AM ET or on-demand.
        Your <strong>Target Geography</strong> from Preferences is used as a default allowlist — these fields only override when you need finer control.
      </p>

      <div className="space-y-5">
        {/* Sources grouped by category */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Enabled Sources
              {!isPro && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  ({enabled.length}/{FREE_SOURCE_LIMIT} on Free plan)
                </span>
              )}
            </label>
            {isPro && sources.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-medium text-[#F97316] hover:text-[#EA580C] cursor-pointer"
              >
                {sources.every((s) => enabled.includes(s.name)) ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>
          {Object.entries(
            sources.reduce((acc, s) => {
              const cat = s.category || 'General';
              if (!acc[cat]) acc[cat] = [];
              acc[cat].push(s);
              return acc;
            }, {})
          ).map(([category, list]) => (
            <div key={category} className="mb-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{category}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {list.map((s) => {
                  const checked = isPro
                    ? (enabled.length === 0 ? true : enabled.includes(s.name))
                    : enabled.includes(s.name);
                  const atLimit = !isPro && !checked && enabled.length >= FREE_SOURCE_LIMIT;
                  return (
                    <label
                      key={s.name}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded ${atLimit ? 'bg-gray-50 opacity-50 cursor-not-allowed' : 'bg-gray-50 hover:bg-gray-100 cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={atLimit}
                        onChange={() => toggleSource(s.name)}
                        className="w-4 h-4 accent-[#F97316]"
                      />
                      <span className="text-sm text-gray-700">{s.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          {isPro && enabled.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">All sources enabled by default (uncheck to exclude)</p>
          )}
          {!isPro && (
            <p className="text-xs text-gray-400 mt-1">
              Free plan: choose up to {FREE_SOURCE_LIMIT} job boards. <a href="#billing" className="text-[#F97316] hover:underline">Upgrade to Pro</a> to enable all sources.
            </p>
          )}
        </div>

        {/* Location allow */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location Allowlist Override</label>
          <p className="text-xs text-gray-400 mb-2">
            Leave empty to use Target Geography from Preferences. Add entries here only if you want a different allowlist for the crawler specifically.
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            {allows.map((loc, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-1 rounded-full">
                {loc}
                <button onClick={() => removeTag('allow', i)} className="text-green-700 hover:text-green-900 cursor-pointer">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={allowInput}
              onChange={(e) => setAllowInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag('allow', allowInput))}
              placeholder="e.g. atlanta, remote, hybrid"
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
            <button onClick={() => addTag('allow', allowInput)} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg cursor-pointer">Add</button>
          </div>
        </div>

        {/* Location deny */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location Denylist</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {denies.map((loc, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-red-50 text-red-700 text-xs font-medium px-2 py-1 rounded-full">
                {loc}
                <button onClick={() => removeTag('deny', i)} className="text-red-700 hover:text-red-900 cursor-pointer">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={denyInput}
              onChange={(e) => setDenyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag('deny', denyInput))}
              placeholder="e.g. san francisco, new york"
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
            <button onClick={() => addTag('deny', denyInput)} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg cursor-pointer">Add</button>
          </div>
        </div>

        {/* Min score */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Fit Score (0-10)</label>
          <input
            type="number"
            min={0}
            max={10}
            value={config.min_score || 3}
            onChange={(e) => setConfig({ ...config, min_score: parseInt(e.target.value) || 0 })}
            className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
          />
          <p className="text-xs text-gray-400 mt-1">
            Fit score is 0-10 based on how closely a job title matches your target roles.
            Jobs scoring below this are filtered out. Lower = more leads (includes rough matches);
            higher = fewer leads (tight matches only). Default: 3.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-5 py-2 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Job Search Config'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SignatureSection({ profile, updateProfile, toast }) {
  const [style, setStyle] = useState('script');
  const [closing, setClosing] = useState('Sincerely,');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setStyle(profile.signatureStyle || profile.signature_style || 'script');
      setClosing(profile.signatureClosing || profile.signature_closing || 'Sincerely,');
      setImageUrl(profile.signatureImageUrl || profile.signature_image_url || '');
    }
  }, [profile]);

  const fullName = profile?.full_name || profile?.fullName || 'Your Name';

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('snag_token') || localStorage.getItem('hopespot_token');
      const res = await fetch('/api/signature/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      const data = await res.json();
      setImageUrl(data.signature_image_url);
      setStyle('image');
      toast('Signature uploaded');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    try {
      await api.del('/signature');
      setImageUrl('');
      setStyle('script');
      toast('Signature removed');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ signature_style: style, signature_closing: closing });
      toast('Signature preferences saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const token = localStorage.getItem('snag_token') || localStorage.getItem('hopespot_token');
  const imageSrc = imageUrl ? `/api/signature/file/${imageUrl.split('/').pop()}?token=${encodeURIComponent(token || '')}` : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-2">Cover Letter Signature</h3>
      <p className="text-xs text-gray-500 mb-4">
        Pick how your signature appears on print-ready cover letters.
      </p>

      <div className="space-y-3 mb-4">
        <SignatureOption
          checked={style === 'script'}
          onChange={() => setStyle('script')}
          label="Cursive"
          description="Render your name in a script font"
          preview={<span style={{ fontFamily: '"Brush Script MT", "Lucida Handwriting", "Segoe Script", cursive', fontSize: 26, color: '#1a1a1a' }}>{fullName}</span>}
        />
        <SignatureOption
          checked={style === 'typed'}
          onChange={() => setStyle('typed')}
          label="Typed"
          description="Your name in bold after a space"
          preview={<span className="font-bold text-base">{fullName}</span>}
        />
        <SignatureOption
          checked={style === 'image'}
          onChange={() => setStyle('image')}
          label="Uploaded image"
          description="Use a PNG/JPEG of your actual signature (transparency recommended)"
          preview={
            imageSrc ? (
              <img src={imageSrc} alt="signature" style={{ maxHeight: 48, maxWidth: 180, objectFit: 'contain' }} />
            ) : (
              <span className="text-xs text-gray-400">No image uploaded yet</span>
            )
          }
        />
        <SignatureOption
          checked={style === 'none'}
          onChange={() => setStyle('none')}
          label="No signature"
          description="Leave the letter unsigned"
          preview={<span className="text-xs text-gray-400">—</span>}
        />
      </div>

      {/* Upload controls (available regardless of active style so user can pre-upload) */}
      <div className="bg-gray-50 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-gray-700">Signature image</div>
            <div className="text-[10px] text-gray-500">PNG with transparency works best. Max 2MB.</div>
          </div>
          <div className="flex items-center gap-2">
            {imageSrc && (
              <button onClick={handleRemove} className="text-xs text-red-600 hover:text-red-700 cursor-pointer">
                Remove
              </button>
            )}
            <label className={`text-xs bg-[#1F2D3D] hover:bg-[#2C3E50] text-white px-3 py-1.5 rounded cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              {uploading ? 'Uploading...' : imageSrc ? 'Replace' : 'Upload'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files[0])}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Closing line */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Closing line</label>
        <input
          value={closing}
          onChange={(e) => setClosing(e.target.value)}
          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
          placeholder="Sincerely,"
        />
        <p className="text-[10px] text-gray-400 mt-0.5">e.g. "Sincerely," "Best regards," "Warm regards,"</p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Signature'}
        </button>
      </div>
    </div>
  );
}

function SignatureOption({ checked, onChange, label, description, preview }) {
  return (
    <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${checked ? 'border-[#F97316] bg-[#F97316]/5' : 'border-gray-200 hover:bg-gray-50'}`}>
      <input type="radio" checked={checked} onChange={onChange} className="w-4 h-4 accent-[#F97316]" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#1F2D3D]">{label}</div>
        <div className="text-[10px] text-gray-500">{description}</div>
      </div>
      <div className="flex items-center justify-end min-w-[180px] max-w-[220px] overflow-hidden">
        {preview}
      </div>
    </label>
  );
}

function TargetInput({ label, value, onChange, max, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
      />
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]"
        placeholder={placeholder}
      />
    </div>
  );
}
