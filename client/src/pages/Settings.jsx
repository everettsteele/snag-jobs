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
      <PreferencesSection profile={profile} updateProfile={updateProfile} toast={toast} />
      <GoogleSection profile={profile} toast={toast} />
      <BillingSection toast={toast} />
      <ResumeSection />
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
  const [variants, setVariants] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [targetRole, setTargetRole] = useState('');
  const { toast } = useToast();

  const loadVariants = async () => {
    try {
      const data = await api.get('/resumes');
      setVariants(data);
    } catch (e) {
      console.error('Failed to load resumes:', e);
    }
  };

  useEffect(() => { loadVariants(); }, []);

  const handleUpload = async (slug, file) => {
    if (!file || file.type !== 'application/pdf') {
      toast('Please select a PDF file', 'error');
      return;
    }
    setUploading(slug);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/resumes/${slug}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('hopespot_token')}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      toast('Resume uploaded');
      loadVariants();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(null);
    }
  };

  const handleRemove = async (slug) => {
    try {
      await api.del(`/resumes/${slug}/file`);
      toast('Resume removed');
      loadVariants();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleSetDefault = async (slug) => {
    try {
      await api.patch(`/resumes/${slug}/default`);
      toast('Default updated');
      loadVariants();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleGenerate = async () => {
    const base = variants.find((v) => v.is_default) || variants[0];
    if (!base) { toast('Set a default variant first', 'error'); return; }
    setGenerating(true);
    try {
      const result = await api.post('/resumes/generate', {
        baseSlug: base.slug,
        targetRole: targetRole || 'senior operations leadership',
        angles: ['operator', 'partner', 'builder', 'innovator'],
      });
      const succeeded = result.results.filter((r) => r.ok).length;
      const failed = result.results.filter((r) => !r.ok).length;
      toast(
        `Generated ${succeeded} variant${succeeded !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`
      );
      loadVariants();
    } catch (err) {
      toast(err.message || 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const hasBase = variants.some((v) => v.has_content || v.filename);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-2">Resume Variants</h3>
      <p className="text-xs text-gray-500 mb-4">
        Upload your base resume as a PDF, then generate AI variants tailored to different positioning angles.
        Free plan gets 1 angle; Pro gets all 4.
      </p>

      {hasBase && (
        <div className="bg-gradient-to-r from-[#1F2D3D] to-[#2C3E50] text-white rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-sm font-semibold">Generate Variants from Base Resume</div>
              <div className="text-xs text-white/70 mt-0.5">
                AI rewrites your resume 4 ways — operator, partner, builder, innovator — keeping your facts but shifting emphasis.
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="Target role (e.g. Chief of Staff at a Series B startup)"
              className="flex-1 px-3 py-1.5 rounded text-sm bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-semibold px-4 py-1.5 rounded cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>
      )}

      {variants.length > 0 ? (
        <div className="space-y-3">
          {variants.map((v) => (
            <div
              key={v.slug}
              className="py-3 px-4 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#1F2D3D]">{v.label}</span>
                  <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">{v.slug}</span>
                  {v.is_default && (
                    <span className="text-xs text-[#F97316] bg-[#F97316]/10 px-1.5 py-0.5 rounded font-medium">default</span>
                  )}
                </div>
                {!v.is_default && v.filename && (
                  <button
                    onClick={() => handleSetDefault(v.slug)}
                    className="text-xs text-gray-500 hover:text-[#F97316] cursor-pointer"
                  >
                    Set as default
                  </button>
                )}
              </div>
              {v.filename ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">
                    {v.filename}
                    {v.has_content && (
                      <span className="ml-2 text-green-600">· {Math.round((v.text_length || 0) / 100) / 10}K chars parsed</span>
                    )}
                  </span>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer">
                      Replace
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => handleUpload(v.slug, e.target.files[0])}
                      />
                    </label>
                    <button
                      onClick={() => handleRemove(v.slug)}
                      className="text-xs text-red-500 hover:text-red-600 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : v.has_content ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-green-600">
                    AI-generated · {Math.round((v.text_length || 0) / 100) / 10}K chars
                  </span>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer">
                      Upload PDF
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => handleUpload(v.slug, e.target.files[0])}
                      />
                    </label>
                    <button
                      onClick={() => handleRemove(v.slug)}
                      className="text-xs text-red-500 hover:text-red-600 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              ) : (
                <label className={`flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg py-3 cursor-pointer hover:border-[#F97316] hover:bg-[#F97316]/5 transition-colors ${uploading === v.slug ? 'opacity-50 pointer-events-none' : ''}`}>
                  <span className="text-xs text-gray-500">
                    {uploading === v.slug ? 'Uploading...' : 'Drop PDF or click to upload'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => handleUpload(v.slug, e.target.files[0])}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No resume variants configured yet.</p>
      )}
    </div>
  );
}

function JobSearchSection({ toast }) {
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
    const updated = enabled.includes(name)
      ? enabled.filter((n) => n !== name)
      : [...enabled, name];
    setConfig({ ...config, enabled_sources: updated });
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
          <label className="block text-sm font-medium text-gray-700 mb-2">Enabled Sources</label>
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
                {list.map((s) => (
                  <label key={s.name} className="flex items-center gap-2 cursor-pointer bg-gray-50 px-2.5 py-1.5 rounded hover:bg-gray-100">
                    <input
                      type="checkbox"
                      checked={enabled.length === 0 ? true : enabled.includes(s.name)}
                      onChange={() => toggleSource(s.name)}
                      className="w-4 h-4 accent-[#F97316]"
                    />
                    <span className="text-sm text-gray-700">{s.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {enabled.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">All sources enabled by default (uncheck to exclude)</p>
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
