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

  // 初始化：恢复token或匿名登录
  useEffect(() => {
    const initAuth = async () => {
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
    };
    initAuth();
  }, []);

  const handleAuthSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (authMode === 'login') {
        const oldUserId = user.userId;
        const res = await apiLogin(authUsername, authPassword);
        localStorage.setItem('auth_token', res.access_token);
        const profile = await getCurrentUser(res.access_token);
        setUser(prev => ({ ...prev, token: res.access_token, userId: res.user_id, username: res.username, isAnonymous: false, profile }));
        // 迁移匿名期徽标到登录账号
        if (oldUserId && oldUserId !== res.user_id) {
          migrateMarkers(oldUserId, res.user_id).catch(() => {});
        }
      } else {
        const res = await apiRegister(authUsername, authPassword, user.deviceId);
        localStorage.setItem('auth_token', res.access_token);
        const profile = await getCurrentUser(res.access_token);
        setUser(prev => ({ ...prev, token: res.access_token, userId: res.user_id, username: res.username, isAnonymous: false, profile }));
      }
      setShowAuthModal(false);
      setAuthUsername('');
      setAuthPassword('');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : '操作失败');
    }
  }, [authMode, authUsername, authPassword, user.deviceId]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('auth_token');
    setUser(prev => ({ ...prev, token: null, userId: '', username: '', profile: null }));
  }, []);

  return {
    user, tokenRef,
    showAuthModal, setShowAuthModal,
    authMode, setAuthMode,
    authUsername, setAuthUsername,
    authPassword, setAuthPassword,
    authError, handleAuthSubmit, handleLogout,
  };
}
