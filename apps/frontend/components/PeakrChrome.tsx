'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { NewListDialog } from './Lists';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useSettings } from '@/lib/theme';

/**
 * Peakr-Bildmarke: offener Wegpunkt-Ring, den der Gipfel von unten durchbricht – die
 * Spitze liegt im Ringmittelpunkt. Konstruktion und Varianten: docs/brand.
 * Farben über die Tokens --brand (Ring) und --brand-accent (Gipfel), siehe lib/theme.
 */
export function BrandSymbol({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        className="brand-ring"
        d="M11.88 38.54A19.9 19.9 0 1 1 36.12 38.54L33.59 34.16A14.9 14.9 0 1 0 14.41 34.16Z"
      />
      <path className="brand-peak" d="M24 22.75L36.99 45.25L11.01 45.25Z" />
    </svg>
  );
}

export function Brandmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={'brand brand-' + size}>
      <BrandSymbol className="brand-mark" />
      <span className="brand-word">peakr</span>
    </span>
  );
}

/**
 * Schliesst bei Klick ausserhalb. `scope: 'parent'` zählt den umgebenden Block
 * mit (dort sitzt der Knopf, der das Fenster öffnet) – so schliesst ein zweiter
 * Klick auf denselben Knopf das Fenster, statt es zu schliessen und gleich
 * wieder zu öffnen.
 */
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onOut: () => void,
  active: boolean,
  scope: 'self' | 'parent' = 'self',
) {
  useEffect(() => {
    if (!active) return;
    // pointerdown statt mousedown: auf dem Handy unterdrückt die Karte die Maus-Ersatzereignisse
    // beim Tippen – dann käme ein Tipp auf die Karte hier nie an.
    const h = (e: PointerEvent) => {
      const el = ref.current;
      const root = scope === 'parent' ? (el?.parentElement ?? el) : el;
      if (root && !root.contains(e.target as Node)) onOut();
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [active, ref, onOut, scope]);
}

/** Abstand zum Bildschirmrand, den ein Popover mindestens einhält. */
const POP_MARGIN = 8;

export function Popover({
  open,
  onClose,
  children,
  align = 'left',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Der öffnende Knopf liegt im selben Block wie das Fenster: erneut klicken schliesst.
  useClickOutside(ref, onClose, open, 'parent');

  // Escape schliesst.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Im sichtbaren Bereich halten: auf dem Handy ist die Zelle oft schmaler als das
  // Popover und es ragte über den Rand. Seitlich verschieben, Höhe begrenzen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const place = () => {
      el.style.setProperty('--pop-shift', '0px');
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      let dx = 0;
      if (r.left < POP_MARGIN) dx = POP_MARGIN - r.left;
      else if (r.right > vw - POP_MARGIN) dx = vw - POP_MARGIN - r.right;
      el.style.setProperty('--pop-shift', `${Math.round(dx)}px`);
      el.style.maxHeight = `${Math.max(220, window.innerHeight - r.top - POP_MARGIN)}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  if (!open) return null;
  return (
    <div className={'pop pop-' + align} ref={ref}>
      {children}
    </div>
  );
}


export function TopBar({ centerSlot }: { centerSlot?: ReactNode }) {
  const router = useRouter();
  const { s, set } = useSettings();
  const { user, token, logout } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [menu, setMenu] = useState(false);
  const [newList, setNewList] = useState(false);
  const mref = useRef<HTMLDivElement>(null);
  useClickOutside(mref, () => setMenu(false), menu);
  useEffect(() => setMounted(true), []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    logout();
    setMenu(false);
    router.push('/');
  };

  const name = user?.displayName ?? user?.email ?? '';

  return (
    <header className="topbar">
      <Link href="/" className="topbar-brand">
        <Brandmark />
      </Link>

      {centerSlot && <div className="topbar-center">{centerSlot}</div>}

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          title="Hell/Dunkel"
          onClick={() => set({ mode: s.mode === 'dark' ? 'light' : 'dark' })}
        >
          <Icon name={s.mode === 'dark' ? 'Sun' : 'Moon'} size={18} stroke={2} />
        </button>

        {mounted && token ? (
          <div className="acct" ref={mref}>
            <button type="button" className="acct-btn" onClick={() => setMenu((v) => !v)}>
              <span className="avatar">{(name[0] ?? 'U').toUpperCase()}</span>
              <span className="acct-name">{name}</span>
              <Icon name="ChevronDown" size={15} stroke={2} />
            </button>
            {menu && (
              <div className="pop pop-right">
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    router.push('/dashboard');
                    setMenu(false);
                  }}
                >
                  <Icon name="Star" size={15} stroke={2} /> Favoriten
                </button>
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    router.push('/lists');
                    setMenu(false);
                  }}
                >
                  <Icon name="List" size={15} stroke={2} /> Listen
                </button>
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    setNewList(true);
                    setMenu(false);
                  }}
                >
                  <Icon name="ListPlus" size={15} stroke={2} /> Neue Liste
                </button>
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    router.push('/');
                    setMenu(false);
                  }}
                >
                  <Icon name="Map" size={15} stroke={2} /> Karte
                </button>
                <button type="button" className="pop-item" onClick={handleLogout}>
                  <Icon name="LogOut" size={15} stroke={2} /> Abmelden
                </button>
              </div>
            )}
          </div>
        ) : mounted ? (
          <Link href="/login" className="btn btn-sm">
            Anmelden
          </Link>
        ) : null}
      </div>
      <NewListDialog open={newList} onClose={() => setNewList(false)} />
    </header>
  );
}
