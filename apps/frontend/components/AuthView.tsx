'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from './Icon';
import { Brandmark } from './PeakrChrome';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export function AuthView({ kind }: { kind: 'login' | 'register' }) {
  const isLogin = kind === 'login';
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = isLogin
        ? await api.login({ email, password: pw })
        : await api.register({ email, password: pw, displayName: name.trim() || undefined });
      setAuth(r.token, r.user);
      router.push(isLogin ? '/' : '/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : isLogin
            ? 'Login fehlgeschlagen.'
            : 'Registrierung fehlgeschlagen.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <button type="button" className="btn-ghost auth-back" onClick={() => router.push('/')}>
          <Icon name="ArrowLeft" size={16} stroke={2} /> Karte
        </button>
        <div className="auth-brand">
          <Brandmark />
        </div>
        <h1 className="auth-title">{isLogin ? 'Willkommen zurück' : 'Konto erstellen'}</h1>
        <p className="auth-sub">
          {isLogin
            ? 'Melde dich an, um Favoriten zu sichern.'
            : 'Sichere deine Ziele auf allen Geräten.'}
        </p>

        <form className="auth-form" onSubmit={submit}>
          {!isLogin && (
            <label className="field">
              <span className="field-label">Anzeigename</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Lena" />
            </label>
          )}
          <label className="field">
            <span className="field-label">E-Mail</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Passwort</span>
            <input
              className="input"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="mind. 8 Zeichen"
              minLength={isLogin ? undefined : 8}
              required
            />
          </label>
          {error && (
            <p className="detail-note" style={{ color: 'var(--accent-2)' }}>
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-block" disabled={loading}>
            {loading ? '…' : isLogin ? 'Anmelden' : 'Registrieren'}
          </button>
        </form>

        <p className="auth-switch">
          {isLogin ? 'Noch kein Konto?' : 'Bereits registriert?'}{' '}
          <button type="button" className="link" onClick={() => router.push(isLogin ? '/register' : '/login')}>
            {isLogin ? 'Registrieren' : 'Anmelden'}
          </button>
        </p>
      </div>
    </div>
  );
}
