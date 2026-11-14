'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useSettings } from '@/lib/theme';

export function Brandmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={'brand brand-' + size}>
      <span className="brand-mark">
        <Icon name="Mountain" size={size === 'lg' ? 22 : 18} stroke={2} />
      </span>
      <span className="brand-word">peakr</span>
    </span>
  );
}

export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onOut: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [active, ref, onOut]);
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
  useClickOutside(ref, onClose, open);

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
    </header>
  );
}
