'use client';

import { LIST_NAME_MAX, type ListDetail } from '@ch-alpineroute/shared';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { countLabel, listInviteUrl, loginHref } from '@/components/Lists';
import { CompassLoader, TypeChip, WeatherChip } from '@/components/PeakrUI';
import { TopBar } from '@/components/PeakrChrome';
import { ShareButton } from '@/components/Share';
import { api, ApiError } from '@/lib/api';
import { adaptFavorite } from '@/lib/peakr';
import { useAuthStore } from '@/lib/store';

function initial(name: string | null): string {
  return (name?.trim()[0] ?? '?').toUpperCase();
}

export default function ListPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const me = useAuthStore((s) => s.user?.displayName ?? s.user?.email ?? null);
  const [mounted, setMounted] = useState(false);
  const [list, setList] = useState<ListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.replace(loginHref(`/lists/${id}`));
  }, [mounted, token, router, id]);
  useEffect(() => {
    if (!token || !id) return;
    api
      .list(id)
      .then((l) => {
        setList(l);
        setInviteUrl(listInviteUrl(l.inviteToken));
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.status === 404 ? 'Diese Liste gibt es nicht oder du bist nicht Mitglied.' : 'Die Liste konnte nicht geladen werden.'),
      );
  }, [token, id]);

  if (!mounted || !token) return null;

  const isOwner = list?.role === 'owner';

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!list || !name.trim()) return;
    try {
      setList(await api.renameList(list.id, name.trim()));
      setEditing(false);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Umbenennen fehlgeschlagen.');
    }
  };

  const remove = async (destinationId: string) => {
    if (!list) return;
    const before = list;
    setList({ ...list, items: list.items.filter((x) => x.id !== destinationId), itemCount: list.itemCount - 1 });
    try {
      await api.removeFromList(list.id, destinationId);
    } catch {
      setList(before);
    }
  };

  const dropOrLeave = async () => {
    if (!list) return;
    const ask = isOwner
      ? `Liste «${list.name}» für alle Mitglieder löschen?`
      : `Liste «${list.name}» verlassen? Du kannst nur über einen neuen Einladungslink zurück.`;
    if (!window.confirm(ask)) return;
    try {
      await api.deleteList(list.id);
      router.push('/lists');
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Das hat nicht geklappt.');
    }
  };

  return (
    <>
      <TopBar />
      <div className="dash">
        {error ? (
          <div className="empty empty-lg">
            <Icon name="List" size={28} stroke={1.5} />
            <p className="empty-title">{error}</p>
            <button type="button" className="btn" onClick={() => router.push('/lists')}>
              Zu meinen Listen
            </button>
          </div>
        ) : !list ? (
          <CompassLoader label="Liste wird geladen …" />
        ) : (
          <>
            <div className="dash-head">
              <button type="button" className="btn-text list-back" onClick={() => router.push('/lists')}>
                <Icon name="ArrowLeft" size={15} stroke={2} /> Listen
              </button>
              {editing ? (
                <form className="list-rename" onSubmit={rename}>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={LIST_NAME_MAX}
                    autoFocus
                    aria-label="Name der Liste"
                  />
                  <button type="submit" className="btn btn-sm" disabled={!name.trim()}>
                    Speichern
                  </button>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => setEditing(false)}>
                    Abbrechen
                  </button>
                </form>
              ) : (
                <h1 className="dash-title list-title">
                  {list.name}
                  {isOwner && (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Umbenennen"
                      onClick={() => {
                        setName(list.name);
                        setEditing(true);
                      }}
                    >
                      <Icon name="Pencil" size={16} stroke={2} />
                    </button>
                  )}
                </h1>
              )}
              <p className="dash-sub">
                {countLabel(list.itemCount, 'Ziel', 'Ziele')} · {countLabel(list.memberCount, 'Person', 'Personen')}
              </p>

              <div className="list-members">
                {list.members.map((m, i) => (
                  <span key={i} className="list-member" title={m.role === 'owner' ? 'hat die Liste erstellt' : undefined}>
                    <span className="avatar">{initial(m.isMe ? (m.name ?? me) : m.name)}</span>
                    {m.isMe ? 'Du' : (m.name ?? 'Ohne Namen')}
                    {m.role === 'owner' && <Icon name="Star" size={11} stroke={2.4} />}
                  </span>
                ))}
              </div>

              <div className="detail-actions list-actions">
                {inviteUrl && (
                  <ShareButton
                    url={inviteUrl}
                    title={`Liste «${list.name}» auf Peakr`}
                    text={`Plane mit mir: «${list.name}» auf Peakr`}
                    label="Einladen"
                    icon="UserPlus"
                    className="btn"
                  />
                )}
                <button type="button" className="btn btn-soft" onClick={() => void dropOrLeave()}>
                  <Icon name={isOwner ? 'Trash2' : 'DoorOpen'} size={16} stroke={2} />
                  {isOwner ? 'Liste löschen' : 'Liste verlassen'}
                </button>
              </div>
            </div>

            {list.items.length === 0 ? (
              <div className="empty empty-lg">
                <Icon name="MapPin" size={28} stroke={1.5} />
                <p className="empty-title">Noch keine Ziele</p>
                <p className="empty-sub">Öffne ein Ziel und tippe auf «Liste», um es hier zu sammeln.</p>
                <button type="button" className="btn" onClick={() => router.push('/')}>
                  <Icon name="Compass" size={16} stroke={2} /> Ziele entdecken
                </button>
              </div>
            ) : (
              <div className="dash-grid">
                {list.items.map((item) => {
                  const d = adaptFavorite(item);
                  return (
                    <article key={d.id} className="fav-card" onClick={() => router.push(`/destinations/${d.id}`)}>
                      <div className="fav-card-top">
                        <TypeChip kind={d.kind} />
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(d.id);
                          }}
                          title="Aus der Liste entfernen"
                        >
                          <Icon name="X" size={16} stroke={2} />
                        </button>
                      </div>
                      <h3 className="fav-name">{d.name}</h3>
                      <p className="fav-meta">
                        {d.canton ? `Kanton ${d.canton}` : 'Schweiz'}
                        {d.topM != null ? ` · ${d.topM} m` : ''}
                      </p>
                      <div className="fav-stats">
                        {d.type === 'ski' ? (
                          <span className="mono">Schnee {d.snowTop != null ? `${d.snowTop} cm` : '–'}</span>
                        ) : (
                          <WeatherChip code={d.weather} temp={d.temp} approx={d.tempAdjusted} />
                        )}
                        {item.addedBy && list.memberCount > 1 && <span className="list-added">von {item.addedBy}</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
