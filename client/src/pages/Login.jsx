import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(fullName, email, password);
      }
      navigate('/');
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-[#F97316] rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#1F2D3D]">Snag</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-[#1F2D3D] mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {mode === 'login'
              ? 'Sign in to your Snag account'
              : 'Get started with Snag'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent"
                  placeholder="John Smith"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent"
                placeholder={mode === 'register' ? '8+ characters' : '********'}
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#F97316] hover:bg-[#EA580C] text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>
          </form>

          <div className="mt-4 text-center">
            {mode === 'login' ? (
              <p className="text-sm text-gray-500">
                Don&apos;t have an account?{' '}
                <button
                  onClick={() => { setMode('register'); setError(''); }}
                  className="text-[#F97316] hover:underline font-medium cursor-pointer"
                >
                  Sign up
                </button>
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                Already have an account?{' '}
                <button
                  onClick={() => { setMode('login'); setError(''); }}
                  className="text-[#F97316] hover:underline font-medium cursor-pointer"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
