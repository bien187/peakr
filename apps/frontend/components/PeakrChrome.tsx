'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { DIRECTIONS, useSettings, type Density, type Direction } from '@/lib/theme';

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
  if (!open) return null;
  return (
    <div className={'pop pop-' + align} ref={ref}>
      {children}
    </div>
  );
}

/** Seg-Schalter als On/Off oder Auswahl — nutzt die bestehenden .seg-Styles. */
function Seg<T extends string | boolean>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={'seg-btn' + (value === o.value ? ' is-on' : '')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsMenu() {
  const { s, set } = useSettings();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" className="icon-btn" title="Einstellungen" onClick={() => setOpen((v) => !v)}>
        <Icon name="Settings" size={18} stroke={2} />
      </button>
      {open && (
        <div className="pop pop-right">
          <div className="pop-field">
            <span className="field-label">Design-Richtung</span>
            <Seg<Direction>
              options={[
                { value: 'paper', label: 'Paper' },
                { value: 'glacier', label: 'Gletscher' },
                { value: 'pine', label: 'Tannwald' },
              ]}
              value={s.direction}
              onChange={(v) => set({ direction: v })}
            />
            <p className="twk-hint">{DIRECTIONS[s.direction].sub}</p>
          </div>

          <div className="pop-field">
            <span className="field-label">Modus</span>
            <Seg<'light' | 'dark'>
              options={[
                { value: 'light', label: 'Hell' },
                { value: 'dark', label: 'Dunkel' },
              ]}
              value={s.mode}
              onChange={(v) => set({ mode: v })}
            />
          </div>

          <div className="pop-field">
            <span className="field-label">Dichte</span>
            <Seg<Density>
              options={[
                { value: 'compact', label: 'Kompakt' },
                { value: 'regular', label: 'Regulär' },
                { value: 'comfy', label: 'Komfort' },
              ]}
              value={s.density}
              onChange={(v) => set({ density: v })}
            />
          </div>

          <div className="pop-field">
            <span className="field-label">Kartenlabels beim Zoomen</span>
            <Seg<boolean>
              options={[
                { value: true, label: 'An' },
                { value: false, label: 'Aus' },
              ]}
              value={s.alwaysLabels}
              onChange={(v) => set({ alwaysLabels: v })}
            />
            <p className="twk-hint">Zeigt alle Zielnamen, sobald du in die Karte hineinzoomst.</p>
          </div>
        </div>
      )}
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

        <SettingsMenu />

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
