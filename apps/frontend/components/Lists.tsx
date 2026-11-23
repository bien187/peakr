'use client';

import { LIST_NAME_MAX, type ListDetail, type ListSummary } from '@ch-alpineroute/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Popover } from './PeakrChrome';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/** Einladungslink einer Liste (öffnet die Beitrittsseite). */
export function listInviteUrl(token: string): string {
  return `${window.location.origin}/lists/join/${token}`;
}

/** Anmeldeseite, die danach hierher zurückführt. */
export function loginHref(next: string, kind: 'login' | 'register' = 'login'): string {
  return `/${kind}?next=${encodeURIComponent(next)}`;
}

export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Name eingeben und Liste anlegen; optional gleich mit einem Ziel. */
export function NewListForm({
  destinationId,
  onCreated,
  onCancel,
  autoFocus = true,
}: {
  destinationId?: string;
  onCreated: (list: ListDetail) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createList(name.trim(), destinationId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Liste konnte nicht erstellt werden.');
      setBusy(false);
    }
  };

  return (
    <form className="list-form" onSubmit={submit}>
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="z. B. Herbsttour Berner Oberland"
        maxLength={LIST_NAME_MAX}
        autoFocus={autoFocus}
        aria-label="Name der Liste"
      />
      {error && <p className="list-err">{error}</p>}
      <div className="list-form-btns">
        {onCancel && (
          <button type="button" className="btn btn-soft btn-sm" onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button type="submit" className="btn btn-sm" disabled={!name.trim() || busy}>
          {busy ? '…' : 'Erstellen'}
        </button>
      </div>
    </form>
  );
}

/**
 * Dialog «Neue Liste» (aus dem Kontomenü und der Listenübersicht). Direkt in
 * den App-Rahmen (.app trägt die Farbvariablen des Themas): die Kopfleiste hat
 * einen backdrop-filter, und darin wäre `position: fixed` an die Kopfleiste
 * gebunden statt an das Fenster.
 */
export function NewListDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Neue Liste">
        <div className="modal-head">
          <h2 className="modal-title">Neue Liste</h2>
          <button type="button" className="wx-pop-x" onClick={onClose} aria-label="Schliessen">
            <Icon name="X" size={16} stroke={2} />
          </button>
        </div>
        <p className="modal-sub">Sammle Ziele und lade andere per Link ein.</p>
        <NewListForm
          onCancel={onClose}
          onCreated={(list) => {
            onClose();
            router.push(`/lists/${list.id}`);
          }}
        />
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}

/**
 * «Liste»-Knopf der Detailansicht: Ziel in eigene oder geteilte Listen legen
 * bzw. daraus entfernen, oder dafür eine neue Liste anlegen.
 */
export function AddToListButton({ destinationId }: { destinationId: string }) {
  const token = useAuthStore((s) => s.token);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(new Set<string>());

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!token) {
      setLists(null);
      return;
    }
    let cancelled = false;
    api
      .lists(destinationId)
      .then((l) => !cancelled && setLists(l))
      .catch(() => !cancelled && setLists([]));
    return () => {
      cancelled = true;
    };
  }, [token, destinationId]);
  useEffect(() => {
    if (!open) {
      setCreating(false);
      setError(null);
    }
  }, [open]);

  const toggle = async (l: ListSummary) => {
    if (busy.current.has(l.id)) return;
    busy.current.add(l.id);
    const add = !l.contains;
    const patch = (contains: boolean, delta: number) =>
      setLists((all) => all?.map((x) => (x.id === l.id ? { ...x, contains, itemCount: x.itemCount + delta } : x)) ?? all);
    patch(add, add ? 1 : -1);
    setError(null);
    try {
      if (add) await api.addToList(l.id, destinationId);
      else await api.removeFromList(l.id, destinationId);
    } catch (err) {
      patch(!add, add ? -1 : 1);
      setError(err instanceof ApiError ? err.message : 'Das hat nicht geklappt.');
    } finally {
      busy.current.delete(l.id);
    }
  };

  const inLists = lists?.filter((l) => l.contains).length ?? 0;
  const here = mounted ? window.location.pathname + window.location.search : '/';

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className={'btn' + (inLists > 0 ? ' btn-on' : ' btn-soft')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon name={inLists > 0 ? 'List' : 'ListPlus'} size={16} stroke={2} />
        {inLists > 1 ? `In ${inLists} Listen` : inLists === 1 ? 'In Liste' : 'Liste'}
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        {!mounted || !token ? (
          <div className="list-pop-anon">
            <p className="list-pop-text">Melde dich an, um Ziele in Listen zu sammeln und mit anderen zu teilen.</p>
            <a className="btn btn-sm" href={loginHref(here)}>
              Anmelden
            </a>
          </div>
        ) : (
          <>
            <p className="pop-title">Zur Liste hinzufügen</p>
            {lists === null ? (
              <p className="list-pop-text mono">Lädt …</p>
            ) : (
              <div className="pop-list">
                {lists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={'pop-item list-pop-item' + (l.contains ? ' is-on' : '')}
                    onClick={() => void toggle(l)}
                    aria-pressed={l.contains}
                  >
                    <span className={'list-check' + (l.contains ? ' is-on' : '')}>
                      {l.contains && <Icon name="Check" size={12} stroke={3} />}
                    </span>
                    <span className="list-pop-name">{l.name}</span>
                    {l.memberCount > 1 && <Icon name="Users" size={13} stroke={2} />}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="list-err">{error}</p>}
            {creating ? (
              <NewListForm
                destinationId={destinationId}
                onCancel={() => setCreating(false)}
                onCreated={(list) => {
                  setLists((all) => [{ ...list, contains: true }, ...(all ?? [])]);
                  setCreating(false);
                }}
              />
            ) : (
              <button type="button" className="pop-item list-pop-new" onClick={() => setCreating(true)}>
                <Icon name="Plus" size={15} stroke={2} /> Neue Liste
              </button>
            )}
          </>
        )}
      </Popover>
    </div>
  );
}
