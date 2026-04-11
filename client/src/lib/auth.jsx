import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('hopespot_token');
    if (!token) { setLoading(false); return; }
    try {
      const data = await api.get('/auth/me');
      setUser(data.user);
      setProfile(data.profile);
    } catch {
      localStorage.removeItem('hopespot_token');
    }
    setLoading(false);
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    localStorage.setItem('hopespot_token', data.token);
    setUser(data.user);
    await checkAuth(); // Hydrate full profile
    return data;
  };

  const register = async (fullName, email, password) => {
    const data = await api.post('/auth/register', { full_name: fullName, email, password });
    localStorage.setItem('hopespot_token', data.token);
    setUser(data.user);
    await checkAuth();
    return data;
  };

  const logout = () => {
    localStorage.removeItem('hopespot_token');
    setUser(null);
    setProfile(null);
  };

  const updateProfile = async (fields) => {
    const data = await api.patch('/auth/profile', fields);
    if (data.profile) setProfile(data.profile);
    return data;
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, register, logout, updateProfile, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
