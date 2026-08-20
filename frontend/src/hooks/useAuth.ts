import { useState, useEffect, useRef, useCallback } from 'react';
import { login as apiLogin, register as apiRegister, anonymousAccess, getCurrentUser, migrateMarkers } from '../services/api';
import type { User } from '../types';

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function useAuth() {
  const [user, setUser] = useState<User>(() => {
    const token = localStorage.getItem('auth_token');
    const deviceId = localStorage.getItem('device_id') || uuid();
    localStorage.setItem('device_id', deviceId);
    return { token, deviceId, userId: '', username: '', isAnonymous: !token, profile: null };
  });
  const tokenRef = useRef(user.token);
  useEffect(() => { tokenRef.current = user.token; }, [user.token]);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<'idle' | 'syncing' | 'failed'>('idle');
  const [migrationVersion, setMigrationVersion] = useState(0);
  const migrationJobRef = useRef<{ oldToken: string; newToken: string } | null>(null);

  const startMigration = useCallback((oldToken: string | null, newToken: string) => {
    if (!oldToken || oldToken === newToken) return;
    migrationJobRef.current = { oldToken, newToken };
    setMigrationStatus('syncing');
    void (async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await migrateMarkers(oldToken, newToken);
          if (migrationJobRef.current?.newToken === newToken) {
            migrationJobRef.current = null;
            setMigrationStatus('idle');
            setMigrationVersion(version => version + 1);
          }
          return;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      if (migrationJobRef.current?.newToken === newToken) setMigrationStatus('failed');
    })();
  }, []);

  // 初始化：恢复token或匿名登录
  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          try {
            const profile = await getCurrentUser(token);
            setUser(prev => ({ ...prev, token, userId: profile.id, username: profile.username, isAnonymous: Boolean(profile.is_anonymous ?? false), profile }));
            return;
          } catch { localStorage.removeItem('auth_token'); }
        }
        const deviceId = localStorage.getItem('device_id') || uuid();
        localStorage.setItem('device_id', deviceId);
        try {
          const res = await anonymousAccess(deviceId);
          localStorage.setItem('auth_token', res.access_token);
          setUser(prev => ({ ...prev, token: res.access_token, deviceId, userId: res.user_id, username: res.username, isAnonymous: true }));
        } catch (e) { console.error('匿名访问失败', e); }
      } finally {
        setAuthReady(true);
      }
    };
    initAuth();
  }, []);

  const handleAuthSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const oldToken = user.token;
      if (authMode === 'login') {
        const res = await apiLogin(authUsername, authPassword);
        localStorage.setItem('auth_token', res.access_token);
        const profile = await getCurrentUser(res.access_token);
        setUser(prev => ({ ...prev, token: res.access_token, userId: res.user_id, username: res.username, isAnonymous: false, profile }));
        startMigration(oldToken, res.access_token);
      } else {
        const res = await apiRegister(authUsername, authPassword, user.deviceId);
        localStorage.setItem('auth_token', res.access_token);
        const profile = await getCurrentUser(res.access_token);
        setUser(prev => ({ ...prev, token: res.access_token, userId: res.user_id, username: res.username, isAnonymous: false, profile }));
        startMigration(oldToken, res.access_token);
      }
      setShowAuthModal(false);
      setAuthUsername('');
      setAuthPassword('');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : '操作失败');
    }
  }, [authMode, authUsername, authPassword, user.deviceId, user.token, startMigration]);

  const retryMigration = useCallback(() => {
    const job = migrationJobRef.current;
    if (job) startMigration(job.oldToken, job.newToken);
  }, [startMigration]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('auth_token');
    setUser(prev => ({ ...prev, token: null, userId: '', username: '', profile: null }));
  }, []);

  return {
    user, tokenRef, authReady,
    showAuthModal, setShowAuthModal,
    authMode, setAuthMode,
    authUsername, setAuthUsername,
    authPassword, setAuthPassword,
    authError, handleAuthSubmit, handleLogout,
    migrationStatus, migrationVersion, retryMigration,
  };
}
