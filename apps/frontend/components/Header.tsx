'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export function Header() {
  const { user, token, logout } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    logout();
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 backdrop-blur">
      <Link href="/" className="flex items-center gap-2 text-lg font-bold">
        🏔️ <span className="hidden sm:inline">CH-AlpineRoute</span>
      </Link>
      <nav className="flex items-center gap-2 text-sm">
        {mounted && token ? (
          <>
            <Link href="/dashboard" className="rounded-lg px-3 py-2 hover:bg-slate-800">
              Dashboard
            </Link>
            <span className="hidden text-slate-400 sm:inline">
              {user?.displayName ?? user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="min-h-11 rounded-lg bg-slate-800 px-3 py-2 hover:bg-slate-700"
            >
              Logout
            </button>
          </>
        ) : mounted ? (
          <>
            <Link href="/login" className="rounded-lg px-3 py-2 hover:bg-slate-800">
              Login
            </Link>
            <Link
              href="/register"
              className="min-h-11 rounded-lg bg-sky-600 px-3 py-2 font-semibold text-white hover:bg-sky-500"
            >
              Registrieren
            </Link>
          </>
        ) : null}
      </nav>
    </header>
  );
}
