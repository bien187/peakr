/* Peakr — detail, dashboard and auth views */

function Sparkline({ pts, unit }) {
  const w = 520, h = 120, pad = 8;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((p, i) => [
    pad + (i / (pts.length - 1)) * (w - pad * 2),
    h - pad - ((p - min) / span) * (h - pad * 2),
  ]);
  const line = xy.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = `${line} L ${xy[xy.length - 1][0].toFixed(1)} ${h - pad} L ${xy[0][0].toFixed(1)} ${h - pad} Z`;
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark-svg">
        <path d={area} className="spark-area" />
        <path d={line} className="spark-line" />
        <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3.5" className="spark-end" />
      </svg>
      <div className="spark-axis">
        <span className="mono">vor 14 Tagen</span>
        <span className="mono">heute · {pts[pts.length - 1]}{unit}</span>
      </div>
    </div>
  );
}

function Fact({ label, value, unit }) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value">{value}{unit && <span className="fact-unit"> {unit}</span>}</span>
    </div>
  );
}

function DetailView({ id, onBack, onOpen, isFav, onFav }) {
  const d = DESTINATIONS.find((x) => x.id === id);
  if (!d) return <div className="page-pad">Nicht gefunden.</div>;
  const isSki = d.type === 'ski';
  const w = weatherInfo(d.weather);
  const hist = historyFor(d);
  const mapsG = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`;

  return (
    <div className="detail">
      <div className="detail-hero">
        <div className="map-terrain detail-hero-bg" />
        <div className="map-hillshade detail-hero-bg" />
        <div className="detail-hero-scrim" />
        <div className="detail-hero-inner">
          <button type="button" className="btn-ghost" onClick={onBack}>
            <Icon name="ArrowLeft" size={16} stroke={2} /> Zurück zur Karte
          </button>
          <div className="detail-hero-foot">
            <div>
              <p className="detail-kicker">{isSki ? 'Skigebiet' : 'Wanderziel'} · Kanton {d.canton}</p>
              <h1 className="detail-name">{d.name}</h1>
            </div>
            <ScoreDot score={Math.round(d.fame * 0.6 + (isSki ? (d.snowTop || 0) / 6 : 22))} size="lg" />
          </div>
        </div>
      </div>

      <div className="detail-body">
        <p className="detail-blurb">{d.blurb}</p>

        <div className="detail-actions">
          <button type="button" className={'btn' + (isFav ? ' btn-on' : '')} onClick={() => onFav(d.id)}>
            <Icon name="Star" size={16} stroke={2} style={{ fill: isFav ? 'currentColor' : 'none' }} />
            {isFav ? 'Gemerkt' : 'Merken'}
          </button>
          <a className="btn btn-soft" href={mapsG} target="_blank" rel="noreferrer">
            <Icon name="Navigation" size={16} stroke={2} /> Route
          </a>
          <a className="btn btn-soft" href={`https://de.wikipedia.org/wiki/${encodeURIComponent(d.wiki)}`}
             target="_blank" rel="noreferrer">
            <Icon name="BookOpen" size={16} stroke={2} /> Wikipedia
          </a>
        </div>

        <div className="facts">
          {isSki ? (
            <>
              <Fact label="Höhe Tal" value={d.baseM} unit="m" />
              <Fact label="Höhe Berg" value={d.topM} unit="m" />
              <Fact label="Schnee Berg" value={d.snowTop} unit="cm" />
              <Fact label="Neuschnee 24 h" value={d.fresh} unit="cm" />
              <Fact label="Lifte offen" value={`${d.liftsOpen}/${d.liftsTotal}`} />
              <Fact label="Bekanntheit" value={d.fame} unit="/100" />
            </>
          ) : (
            <>
              <Fact label="SAC-Grad" value={d.sac} />
              <Fact label="Höhe" value={d.topM} unit="m" />
              <Fact label="Aufstieg" value={d.ascent} unit="hm" />
              <Fact label="Distanz" value={d.distance} unit="km" />
              <Fact label="Bekanntheit" value={d.fame} unit="/100" />
              <Fact label="Wind" value={Math.round(d.wind)} unit="km/h" />
            </>
          )}
        </div>

        <section className="detail-card">
          <h2 className="detail-h2">Aktuelle Lage</h2>
          <div className="live-row">
            <WeatherChip code={d.weather} temp={d.temp} />
            <span className="live-item"><Icon name="Wind" size={15} stroke={1.75} /> {Math.round(d.wind)} km/h</span>
            {isSki && <AvalancheTag level={d.avalanche} />}
            <span className="live-stamp mono">Stand heute · 06:00</span>
          </div>
          {isSki && (
            <p className="detail-note">
              <Icon name="TriangleAlert" size={13} stroke={2} />
              Lawineneinschätzung ersetzt nicht das offizielle SLF-Bulletin auf whiterisk.ch.
            </p>
          )}
        </section>

        <section className="detail-card">
          <h2 className="detail-h2">{isSki ? 'Schneeverlauf' : 'Beliebtheit'} · 14 Tage</h2>
          <Sparkline pts={hist} unit={isSki ? ' cm' : ''} />
        </section>
      </div>
    </div>
  );
}

function DashboardView({ favs, onOpen, onFav, onExplore, user }) {
  const list = DESTINATIONS.filter((d) => favs.has(d.id));
  return (
    <div className="dash">
      <div className="dash-head">
        <p className="detail-kicker">Dein Konto</p>
        <h1 className="dash-title">Gemerkte Ziele</h1>
        <p className="dash-sub">{user ? `Angemeldet als ${user}` : 'Demo-Modus'} · {list.length} {list.length === 1 ? 'Favorit' : 'Favoriten'}</p>
      </div>

      {list.length === 0 ? (
        <div className="empty empty-lg">
          <Icon name="Star" size={28} stroke={1.5} />
          <p className="empty-title">Noch keine Favoriten</p>
          <p className="empty-sub">Markiere Ziele mit dem Stern, um sie hier zu sammeln.</p>
          <button type="button" className="btn" onClick={onExplore}>
            <Icon name="Compass" size={16} stroke={2} /> Ziele entdecken
          </button>
        </div>
      ) : (
        <div className="dash-grid">
          {list.map((d) => {
            const isSki = d.type === 'ski';
            return (
              <article key={d.id} className="fav-card" onClick={() => onOpen(d.id)}>
                <div className="fav-card-top">
                  <ScoreDot score={Math.round(d.fame * 0.6 + (isSki ? (d.snowTop || 0) / 6 : 22))} />
                  <button type="button" className="icon-btn" onClick={(e) => { e.stopPropagation(); onFav(d.id); }}
                          title="Favorit entfernen">
                    <Icon name="Star" size={17} stroke={2} style={{ fill: 'var(--accent)', color: 'var(--accent)' }} />
                  </button>
                </div>
                <h3 className="fav-name">{d.name}</h3>
                <p className="fav-meta">{isSki ? 'Skigebiet' : 'Wanderziel'} · {d.canton}</p>
                <div className="fav-stats">
                  {isSki
                    ? <><span className="mono">{d.snowTop} cm</span><span className="dot-sep" /><span>{d.liftsOpen}/{d.liftsTotal} Lifte</span></>
                    : <><span>{d.sac}</span><span className="dot-sep" /><span className="mono">{d.distance} km</span></>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AuthView({ kind, onAuth, onSwitch, onBack }) {
  const isLogin = kind === 'login';
  const [email, setEmail] = React.useState(isLogin ? 'demo@peakr.ch' : '');
  const [pw, setPw] = React.useState('');
  const [name, setName] = React.useState('');
  const submit = (e) => {
    e.preventDefault();
    onAuth((name || email.split('@')[0] || 'Gast'));
  };
  return (
    <div className="auth">
      <div className="auth-card">
        <button type="button" className="btn-ghost auth-back" onClick={onBack}>
          <Icon name="ArrowLeft" size={16} stroke={2} /> Karte
        </button>
        <div className="auth-brand"><Brandmark /> </div>
        <h1 className="auth-title">{isLogin ? 'Willkommen zurück' : 'Konto erstellen'}</h1>
        <p className="auth-sub">{isLogin ? 'Melde dich an, um Favoriten zu sichern.' : 'Sichere deine Ziele auf allen Geräten.'}</p>

        <form className="auth-form" onSubmit={submit}>
          {!isLogin && (
            <label className="field">
              <span className="field-label">Anzeigename</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Lena" />
            </label>
          )}
          <label className="field">
            <span className="field-label">E-Mail</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Passwort</span>
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                   placeholder="mind. 8 Zeichen" required />
          </label>
          <button type="submit" className="btn btn-block">
            {isLogin ? 'Anmelden' : 'Registrieren'}
          </button>
        </form>

        <p className="auth-switch">
          {isLogin ? 'Noch kein Konto?' : 'Bereits registriert?'}{' '}
          <button type="button" className="link" onClick={onSwitch}>
            {isLogin ? 'Registrieren' : 'Anmelden'}
          </button>
        </p>
      </div>
    </div>
  );
}

Object.assign(window, { Sparkline, Fact, DetailView, DashboardView, AuthView });
