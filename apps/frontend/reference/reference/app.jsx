/* Peakr — app shell: brand, top bar, controls, routing, tweaks */

function Brandmark({ size = 'md' }) {
  return (
    <span className={'brand brand-' + size}>
      <span className="brand-mark"><Icon name="Mountain" size={size === 'lg' ? 22 : 18} stroke={2} /></span>
      <span className="brand-word">peakr</span>
    </span>
  );
}

function useClickOutside(ref, onOut, active) {
  React.useEffect(() => {
    if (!active) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onOut(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [active]);
}

function Popover({ open, onClose, anchorClass, children, align = 'left' }) {
  const ref = React.useRef(null);
  useClickOutside(ref, onClose, open);
  if (!open) return null;
  return (
    <div className={'pop pop-' + align} ref={ref}>{children}</div>
  );
}

/* ---- top control capsule ------------------------------------------------- */
function Controls({ params, set, onLocate, locating }) {
  const [openOrigin, setOpenOrigin] = React.useState(false);
  const [openAdjust, setOpenAdjust] = React.useState(false);

  return (
    <div className="capsule">
      {/* origin */}
      <div className="cap-cell origin-cell">
        <Icon name="MapPin" size={16} stroke={2} className="cap-ico" />
        <button type="button" className="cap-btn" onClick={() => setOpenOrigin((v) => !v)}>
          <span className="cap-key">Start</span>
          <span className="cap-val">{params.originLabel}</span>
        </button>
        <Popover open={openOrigin} onClose={() => setOpenOrigin(false)}>
          <p className="pop-title">Startort</p>
          <div className="pop-list">
            {ORIGINS.map((o) => (
              <button key={o.id} type="button"
                      className={'pop-item' + (params.origin.id === o.id ? ' is-on' : '')}
                      onClick={() => { set({ origin: o, originLabel: o.label }); setOpenOrigin(false); }}>
                <Icon name="Circle" size={8} stroke={2} style={{ fill: 'currentColor' }} />
                {o.label}
              </button>
            ))}
          </div>
          <button type="button" className="pop-locate" disabled={locating}
                  onClick={() => { onLocate(); setOpenOrigin(false); }}>
            <Icon name="LocateFixed" size={15} stroke={2} />
            {locating ? 'Wird ermittelt …' : 'Mein Standort'}
          </button>
        </Popover>
      </div>

      <span className="cap-div" />

      {/* mode */}
      <div className="cap-cell">
        <div className="seg seg-mode">
          {[['ski', 'Ski', 'Snowflake'], ['hike', 'Wandern', 'Footprints']].map(([v, l, ic]) => (
            <button key={v} type="button" className={'seg-btn' + (params.mode === v ? ' is-on' : '')}
                    onClick={() => set({ mode: v })}>
              <Icon name={ic} size={15} stroke={2} /> {l}
            </button>
          ))}
        </div>
      </div>

      <span className="cap-div" />

      {/* drive time + advanced */}
      <div className="cap-cell">
        <button type="button" className="cap-btn" onClick={() => setOpenAdjust((v) => !v)}>
          <span className="cap-key">Fahrzeit</span>
          <span className="cap-val mono">≤ {fmtDrive(params.maxMin)}</span>
        </button>
        <Icon name="SlidersHorizontal" size={15} stroke={2} className="cap-ico cap-ico-r" />
        <Popover open={openAdjust} onClose={() => setOpenAdjust(false)} align="right">
          <p className="pop-title">Filter</p>
          <div className="pop-slider">
            <div className="pop-slider-lbl"><span>Max. Fahrzeit</span><span className="mono">{params.maxMin} min</span></div>
            <input type="range" min={15} max={240} step={5} value={params.maxMin}
                   onChange={(e) => set({ maxMin: +e.target.value })} className="range" />
          </div>
          <div className="pop-slider">
            <div className="pop-slider-lbl"><span>Toleranz · Vorschläge</span><span className="mono">+{params.tolMin} min</span></div>
            <input type="range" min={0} max={60} step={5} value={params.tolMin}
                   onChange={(e) => set({ tolMin: +e.target.value })} className="range" />
          </div>
          {params.mode === 'hike' && (
            <>
              <div className="pop-field">
                <span className="field-label">Zieltyp</span>
                <div className="chip-row">
                  {HIKE_KINDS.map((k) => (
                    <button key={k.value} type="button"
                            className={'chip' + (params.hikeKind === k.value ? ' is-on' : '')}
                            onClick={() => set({ hikeKind: k.value })}>{k.label}</button>
                  ))}
                </div>
              </div>
              <div className="pop-field">
                <span className="field-label">Max. SAC-Schwierigkeit</span>
                <div className="chip-row">
                  <button type="button" className={'chip' + (!params.maxSac ? ' is-on' : '')}
                          onClick={() => set({ maxSac: '' })}>egal</button>
                  {SAC.map((s) => (
                    <button key={s} type="button" className={'chip' + (params.maxSac === s ? ' is-on' : '')}
                            onClick={() => set({ maxSac: s })}>{s}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}

function TopBar({ params, set, onLocate, locating, t, setTweak, user, route, go }) {
  const [menu, setMenu] = React.useState(false);
  const mref = React.useRef(null);
  useClickOutside(mref, () => setMenu(false), menu);
  return (
    <header className="topbar">
      <button type="button" className="topbar-brand" onClick={() => go({ name: 'search' })}>
        <Brandmark />
      </button>

      {route.name === 'search' && (
        <div className="topbar-center">
          <Controls params={params} set={set} onLocate={onLocate} locating={locating} />
        </div>
      )}

      <div className="topbar-actions">
        <button type="button" className="icon-btn" title="Hell/Dunkel"
                onClick={() => setTweak('darkMode', !t.darkMode)}>
          <Icon name={t.darkMode ? 'Sun' : 'Moon'} size={18} stroke={2} />
        </button>
        {user ? (
          <div className="acct" ref={mref}>
            <button type="button" className="acct-btn" onClick={() => setMenu((v) => !v)}>
              <span className="avatar">{user[0].toUpperCase()}</span>
              <span className="acct-name">{user}</span>
              <Icon name="ChevronDown" size={15} stroke={2} />
            </button>
            <Popover open={menu} onClose={() => setMenu(false)} align="right">
              <button type="button" className="pop-item" onClick={() => { go({ name: 'dashboard' }); setMenu(false); }}>
                <Icon name="Star" size={15} stroke={2} /> Favoriten
              </button>
              <button type="button" className="pop-item" onClick={() => { go({ name: 'search' }); setMenu(false); }}>
                <Icon name="Map" size={15} stroke={2} /> Karte
              </button>
              <button type="button" className="pop-item" onClick={() => { setTweak('user', ''); setMenu(false); }}>
                <Icon name="LogOut" size={15} stroke={2} /> Abmelden
              </button>
            </Popover>
          </div>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => go({ name: 'login' })}>Anmelden</button>
        )}
      </div>
    </header>
  );
}

/* ---- root app ------------------------------------------------------------ */
const DEFAULT_PARAMS = {
  origin: ORIGINS[0], originLabel: ORIGINS[0].label, mode: 'ski',
  maxMin: 120, tolMin: 20, hikeKind: 'any', maxSac: '',
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "direction": "pine",
  "darkMode": false,
  "density": "regular",
  "alwaysLabels": true,
  "user": ""
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [params, setParams] = React.useState(() => {
    try { const r = localStorage.getItem('peakr-params'); if (r) return { ...DEFAULT_PARAMS, ...JSON.parse(r) }; } catch {}
    return DEFAULT_PARAMS;
  });
  const [route, setRoute] = React.useState({ name: 'search' });
  const [selectedId, setSelectedId] = React.useState(null);
  const [sort, setSort] = React.useState('score');
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const [favs, setFavs] = React.useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('peakr-favs') || '[]')); } catch { return new Set(); }
  });

  const set = (patch) => setParams((p) => ({ ...p, ...patch }));
  const go = (r) => { setRoute(r); window.scrollTo(0, 0); };

  React.useEffect(() => { try { localStorage.setItem('peakr-params', JSON.stringify(params)); } catch {} }, [params]);
  React.useEffect(() => { try { localStorage.setItem('peakr-favs', JSON.stringify([...favs])); } catch {} }, [favs]);

  const onLocate = () => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { set({ origin: { id: 'me', lat: pos.coords.latitude, lng: pos.coords.longitude }, originLabel: 'Mein Standort' }); setLocating(false); },
      () => { setLocating(false); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const onFav = (id) => setFavs((f) => { const n = new Set(f); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const built = React.useMemo(
    () => buildResults(params.origin, params.mode, params.maxMin, params.tolMin, params.hikeKind, params.maxSac),
    [params],
  );
  const results = sortResults(built.filter((r) => !r.suggestion), sort);
  const suggestions = sortResults(built.filter((r) => r.suggestion), sort);
  const user = t.user || null;

  const themeStyle = themeVars(t.direction, t.darkMode ? 'dark' : 'light');

  return (
    <div className="app" data-density={t.density} data-labels={t.alwaysLabels ? '1' : '0'} style={themeStyle}>
      {route.name !== 'detail' && route.name !== 'login' && route.name !== 'register' && (
        <TopBar params={params} set={set} onLocate={onLocate} locating={locating}
                t={t} setTweak={setTweak} user={user} route={route} go={go} />
      )}

      {route.name === 'search' && (
        <div className="stage">
          <ReliefMap results={[...results, ...suggestions]} originPt={params.origin}
                     originLabel={params.originLabel} selectedId={selectedId}
                     onSelect={(id) => { setSelectedId(id); setSheetOpen(true); }}
                     mode={params.mode} dir={t.direction} alwaysLabels={t.alwaysLabels} />
          <ResultsPanel results={results} suggestions={suggestions} selectedId={selectedId}
                        onSelect={setSelectedId} onOpen={(id) => go({ name: 'detail', id })}
                        favs={favs} onFav={onFav} originLabel={params.originLabel}
                        mode={params.mode} sort={sort} onSort={setSort} count={results.length}
                        sheetOpen={sheetOpen} onSheetToggle={() => setSheetOpen((v) => !v)} />
        </div>
      )}

      {route.name === 'detail' && (
        <DetailView id={route.id} onBack={() => go({ name: 'search' })} onOpen={(id) => go({ name: 'detail', id })}
                    isFav={favs.has(route.id)} onFav={onFav} />
      )}

      {route.name === 'dashboard' && (
        <DashboardView favs={favs} onOpen={(id) => go({ name: 'detail', id })} onFav={onFav}
                       onExplore={() => go({ name: 'search' })} user={user} />
      )}

      {(route.name === 'login' || route.name === 'register') && (
        <AuthView kind={route.name}
                  onAuth={(name) => { setTweak('user', name); go({ name: 'dashboard' }); }}
                  onSwitch={() => go({ name: route.name === 'login' ? 'register' : 'login' })}
                  onBack={() => go({ name: 'search' })} />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Design-Richtung" />
        <TweakRadio label="Richtung" value={t.direction}
                    options={[{ value: 'paper', label: 'Paper' }, { value: 'glacier', label: 'Gletscher' }, { value: 'pine', label: 'Tannwald' }]}
                    onChange={(v) => setTweak('direction', v)} />
        <p className="twk-hint">{DIRECTIONS[t.direction].sub}</p>
        <TweakToggle label="Dark Mode" value={t.darkMode} onChange={(v) => setTweak('darkMode', v)} />
        <TweakSection label="Darstellung" />
        <TweakRadio label="Dichte" value={t.density} options={['compact', 'regular', 'comfy']}
                    onChange={(v) => setTweak('density', v)} />
        <TweakToggle label="Kartenlabels beim Zoomen" value={t.alwaysLabels}
                     onChange={(v) => setTweak('alwaysLabels', v)} />
        <p className="twk-hint">Zeigt alle Zielnamen, sobald du in die Karte hineinzoomst.</p>
      </TweaksPanel>
    </div>
  );
}

Object.assign(window, { Brandmark, App });
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
