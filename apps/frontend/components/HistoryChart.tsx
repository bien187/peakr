'use client';

import type { LiveStatus } from '@ch-alpineroute/shared';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function HistoryChart({ history }: { history: LiveStatus[] }) {
  if (history.length === 0) {
    return (
      <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
        Noch keine Verlaufsdaten. Sobald der Live-Worker läuft, erscheinen hier Schnee- und
        Temperaturverläufe.
      </p>
    );
  }

  const data = [...history].reverse().map((h) => ({
    time: new Date(h.capturedAt).toLocaleString('de-CH', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
    }),
    Schnee: h.snowDepthTopCm,
    Neuschnee: h.freshSnowCm,
    Temp: h.temperatureC,
  }));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="Schnee" stroke="#38bdf8" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="Neuschnee" stroke="#a78bfa" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="Temp" stroke="#f97316" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
