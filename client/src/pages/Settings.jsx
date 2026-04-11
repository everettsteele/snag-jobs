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
      <ResumeSection profile={profile} />
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
        full_name: profile.full_name || '',
        phone: profile.phone || '',
        linkedin_url: profile.linkedin_url || '',
        location: profile.location || '',
        background: profile.background || '',
      });
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile(form);
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
  const [roleInput, setRoleInput] = useState('');
  const [geoInput, setGeoInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile?.preferences) {
      const prefs = profile.preferences;
      setTargetRoles(
        Array.isArray(prefs.target_roles)
          ? prefs.target_roles.join(', ')
          : prefs.target_roles || ''
      );
      setTargetGeo(
        Array.isArray(prefs.target_geography)
          ? prefs.target_geography.join(', ')
          : prefs.target_geography || ''
      );
      setDailyTarget(prefs.daily_outreach_target || 10);
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
        preferences: {
          target_roles: roles,
          target_geography: geos,
          daily_outreach_target: dailyTarget,
        },
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
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-4">Google Integration</h3>
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

function ResumeSection({ profile }) {
  const variants = profile?.resume_variants || profile?.preferences?.resume_variants || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-[#1F2D3D] mb-4">Resume Variants</h3>
      {variants.length > 0 ? (
        <div className="space-y-2">
          {variants.map((v, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
            >
              <div>
                <span className="text-sm font-medium text-[#1F2D3D]">{v.label || v.slug}</span>
                {v.slug && v.label && (
                  <span className="ml-2 text-xs text-gray-400">{v.slug}</span>
                )}
              </div>
              <span className="text-xs text-gray-400">Read-only</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No resume variants configured yet.</p>
      )}
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
