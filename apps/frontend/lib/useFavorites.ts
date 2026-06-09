'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuthStore } from './store';

const FAVS_KEY = 'peakr-favs';

/** Favoriten: angemeldet kontogebunden über die API, sonst lokal (localStorage).
 *  Toggle ist optimistisch und rollt bei API-Fehlern zurück. */
export function useFavorites() {
  const token = useAuthStore((s) => s.token);
  const [favs, setFavs] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    if (token) {
      api
        .favorites()
        .then((f) => {
          if (!cancelled) setFavs(new Set(f.map((x) => x.id)));
        })
        .catch(() => undefined);
    } else {
      try {
        setFavs(new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || '[]') as string[]));
      } catch {
        setFavs(new Set());
      }
    }
    return () => {
      cancelled = true;
    };
  }, [token]);

  const toggle = async (id: string) => {
    const has = favs.has(id);
    const optimistic = new Set(favs);
    if (has) optimistic.delete(id);
    else optimistic.add(id);
    setFavs(optimistic);

    if (token) {
      try {
        if (has) await api.removeFavorite(id);
        else await api.addFavorite(id);
      } catch {
        setFavs(favs); // zurückrollen
      }
    } else {
      try {
        localStorage.setItem(FAVS_KEY, JSON.stringify([...optimistic]));
      } catch {
        /* ignore */
      }
    }
  };

  return { favs, toggle, isFav: (id: string) => favs.has(id) };
}
