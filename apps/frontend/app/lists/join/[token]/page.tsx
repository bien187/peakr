'use client';

import type { ListInvite } from '@ch-alpineroute/shared';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { countLabel, loginHref } from '@/components/Lists';
import { Brandmark } from '@/components/PeakrChrome';
import { CompassLoader } from '@/components/PeakrUI';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/** Einladung in eine Liste: Vorschau für alle, Beitreten nach der Anmeldung. */
export default function JoinListPage() {
  const { token: inviteToken } = useParams<{ token: string }>();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [mounted, setMounted] = useState(false);
  const [invite, setInvite] = useState<ListInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || !inviteToken) return;
    api
      .listInvite(inviteToken)
      .then(setInvite)
      .catch((e: unknown) =>
        setError(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'Dieser Einladungslink ist ungültig.' : 'Die Einladung konnte nicht geladen werden.'),
      );
  }, [mounted, inviteToken, token]);

  const join = async () => {
    setJoining(true);
    try {
      const { id } = await api.joinList(inviteToken);
      router.replace(`/lists/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Beitreten fehlgeschlagen.');
      setJoining(false);
    }
  };

  const here = `/lists/join/${inviteToken}`;

  return (
    <div className="auth">
      <div className="auth-card">
        <button type="button" className="btn-ghost auth-back" onClick={() => router.push('/')}>
          <Icon name="ArrowLeft" size={16} stroke={2} /> Karte
        </button>
        <div className="auth-brand">
          <Brandmark />
        </div>
        {error ? (
          <>
            <h1 className="auth-title">Einladung</h1>
            <p className="auth-sub">{error}</p>
          </>
        ) : !invite ? (
          <CompassLoader label="Einladung wird geladen …" />
        ) : (
          <>
            <p className="detail-kicker">Einladung zur Liste</p>
            <h1 className="auth-title">{invite.name}</h1>
            <p className="auth-sub">
              {invite.ownerName ?? 'Jemand'} lädt dich ein, gemeinsam Ziele zu sammeln.{' '}
              <span className="list-invite-meta">
                {countLabel(invite.itemCount, 'Ziel', 'Ziele')} · {countLabel(invite.memberCount, 'Person', 'Personen')}
              </span>
            </p>
            {mounted && token ? (
              invite.isMember ? (
                <button type="button" className="btn btn-block" onClick={() => router.push(`/lists/${invite.id}`)}>
                  Liste öffnen
                </button>
              ) : (
                <button type="button" className="btn btn-block" onClick={() => void join()} disabled={joining}>
                  <Icon name="UserPlus" size={16} stroke={2} /> {joining ? '…' : 'Beitreten'}
                </button>
              )
            ) : (
              <>
                <a className="btn btn-block" href={loginHref(here)}>
                  Anmelden und beitreten
                </a>
                <p className="auth-switch">
                  Noch kein Konto?{' '}
                  <a className="link" href={loginHref(here, 'register')}>
                    Registrieren
                  </a>
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
