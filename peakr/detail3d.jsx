/* Peakr — detail media: animated 3D terrain (MapLibre + swisstopo), photo slot,
 * and the 7-day weather window. Free, keyless data:
 *   imagery  ch.swisstopo.swissimage  (real Swiss aerial photos)
 *   terrain  AWS terrarium DEM         (global elevation, 3D relief)
 */

function shortName(name) {
  return name.split(' – ')[0].split(' (')[0];
}

/* DOM marker for the 3D map (park / peak). */
function makeMarker(kind, label) {
  const el = document.createElement('div');
  el.className = 't3d-marker t3d-marker-' + kind;
  const pin = document.createElement('span');
  pin.className = 't3d-pin t3d-pin-' + kind;
  if (kind === 'park') pin.textContent = 'P';
  const tip = document.createElement('span');
  tip.className = 't3d-tip';
  tip.textContent = label;
  el.appendChild(pin);
  el.appendChild(tip);
  return el;
}

function Terrain3D({ d }) {
  const hostRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const [status, setStatus] = React.useState('loading'); // loading | ready | error
  const [spin, setSpin] = React.useState(true);
  const spinRef = React.useRef(true);
  const geo = React.useMemo(() => routeGeo(d), [d.id]);

  React.useEffect(() => { spinRef.current = spin; }, [spin]);

  React.useEffect(() => {
    if (!window.maplibregl) { setStatus('error'); return; }
    let cancelled = false;
    let raf = 0;

    const map = new maplibregl.Map({
      container: hostRef.current,
      attributionControl: false,
      antialias: true,
      maxPitch: 80,
      center: geo.peak,
      zoom: 13.2,
      pitch: 64,
      bearing: -28,
      style: {
        version: 8,
        sources: {
          img: {
            type: 'raster', tileSize: 256, attribution: '© swisstopo',
            tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'],
          },
          dem: {
            type: 'raster-dem', tileSize: 256, encoding: 'terrarium', maxzoom: 14,
            tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
          },
        },
        layers: [
          { id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun-intensity': 8 } },
          { id: 'img', type: 'raster', source: 'img' },
        ],
        terrain: { source: 'dem', exaggeration: 1.7 },
      },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');

    const stopSpin = () => setSpin(false);
    map.on('dragstart', stopSpin);
    map.on('wheel', stopSpin);
    map.on('touchstart', stopSpin);

    map.on('load', () => {
      if (cancelled) return;

      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: geo.line } } });
      map.addLayer({
        id: 'route-casing', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9, 'line-blur': 0.6 },
      });
      map.addLayer({
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e8542b', 'line-width': 4.5 },
      });

      new maplibregl.Marker({ element: makeMarker('park', geo.parkLabel), anchor: 'bottom' }).setLngLat(geo.park).addTo(map);
      new maplibregl.Marker({ element: makeMarker('peak', geo.peakLabel), anchor: 'bottom' }).setLngLat(geo.peak).addTo(map);

      const b = new maplibregl.LngLatBounds();
      geo.line.forEach((p) => b.extend(p));
      map.fitBounds(b, { padding: { top: 80, bottom: 70, left: 60, right: 60 }, pitch: 64, bearing: -28, maxZoom: 15.2, duration: 0 });

      setStatus('ready');

      let bearing = map.getBearing();
      const spinFrame = () => {
        if (cancelled) return;
        if (spinRef.current && !map.isMoving()) {
          bearing += 0.09;
          map.setBearing(bearing);
        } else {
          bearing = map.getBearing();
        }
        raf = requestAnimationFrame(spinFrame);
      };
      raf = requestAnimationFrame(spinFrame);
    });

    return () => { cancelled = true; cancelAnimationFrame(raf); try { map.remove(); } catch (e) {} };
  }, [d.id]);

  const replay = () => {
    const map = mapRef.current; if (!map) return;
    setSpin(false);
    const b = new maplibregl.LngLatBounds();
    geo.line.forEach((p) => b.extend(p));
    map.fitBounds(b, { padding: { top: 80, bottom: 70, left: 60, right: 60 }, pitch: 64, bearing: -28, maxZoom: 15.2, duration: 200 });
    setTimeout(() => map.flyTo({
      center: geo.peak, zoom: 14.6, pitch: 74, bearing: 150, duration: 9000, essential: true,
    }), 350);
  };

  return (
    <div className="t3d">
      <div className="t3d-map" ref={hostRef} />

      {status === 'ready' && (
        <>
          <div className="t3d-controls">
            <button type="button" className={'t3d-btn' + (spin ? ' is-on' : '')} onClick={() => setSpin((v) => !v)}>
              <Icon name={spin ? 'Pause' : 'RotateCw'} size={14} stroke={2} /> {spin ? 'Drehung' : 'Drehen'}
            </button>
            <button type="button" className="t3d-btn" onClick={replay}>
              <Icon name="Play" size={14} stroke={2} /> Überflug
            </button>
          </div>
          <div className="t3d-legend">
            <span className="t3d-leg"><span className="t3d-leg-dot t3d-leg-park">P</span> {geo.parkLabel}</span>
            <span className="t3d-leg"><span className="t3d-leg-route" /> Route</span>
            <span className="t3d-leg"><span className="t3d-leg-dot t3d-leg-peak" /> {geo.peakLabel}</span>
          </div>
        </>
      )}

      {status !== 'ready' && (
        <div className={'t3d-overlay' + (status === 'error' ? ' is-err' : '')}>
          <div className="map-terrain t3d-fallback-bg" />
          <div className="map-hillshade t3d-fallback-bg" />
          <div className="t3d-overlay-inner">
            {status === 'error' ? (
              <>
                <Icon name="MountainSnow" size={26} stroke={1.6} />
                <p className="t3d-overlay-t">3D-Gelände nicht verfügbar</p>
                <p className="t3d-overlay-s">Für die 3D-Ansicht wird eine Internetverbindung benötigt. Wechsle auf „Foto".</p>
              </>
            ) : (
              <>
                <span className="t3d-spinner" />
                <p className="t3d-overlay-t">3D-Gelände wird geladen …</p>
                <p className="t3d-overlay-s">Satellitenbild &amp; Höhenmodell der Schweiz</p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="t3d-attrib">3D · swisstopo Luftbild · Höhenmodell</div>
    </div>
  );
}

function RoutePhoto({ d }) {
  return React.createElement('image-slot', {
    id: 'peakr-photo-' + d.id,
    shape: 'rect',
    fit: 'cover',
    class: 't3d-photo',
    placeholder: 'Foto von ' + shortName(d.name) + ' hierherziehen',
  });
}

/* 7-day weather window, opened from the live conditions row. */
function WeatherWindow({ d, onClose }) {
  const days = React.useMemo(() => forecastFor(d), [d.id]);
  return (
    <div className="wx-pop" role="dialog" aria-label="7-Tage-Wetter">
      <div className="wx-pop-head">
        <div>
          <p className="wx-pop-kicker">7-Tage-Prognose</p>
          <p className="wx-pop-place">{shortName(d.name)}{d.topM ? ` · ${d.topM} m` : ''}</p>
        </div>
        <button type="button" className="wx-pop-x" onClick={onClose} aria-label="Schliessen">
          <Icon name="X" size={16} stroke={2} />
        </button>
      </div>
      <div className="wx-grid">
        {days.map((day, i) => {
          const w = weatherInfo(day.code);
          return (
            <div key={i} className={'wx-day' + (i === 0 ? ' is-today' : '')}>
              <span className="wx-day-name">{day.label}</span>
              <span className="wx-day-date mono">{day.date}</span>
              <span className="wx-day-ico"><Icon name={w.icon} size={22} stroke={1.6} /></span>
              <span className="wx-day-temp"><b>{day.tmax}°</b><span className="wx-day-min">{day.tmin}°</span></span>
              <span className="wx-day-sub mono"><Icon name="Droplets" size={11} stroke={2} />{day.pop}%</span>
              <span className="wx-day-sub mono"><Icon name="Wind" size={11} stroke={2} />{day.wind}</span>
            </div>
          );
        })}
      </div>
      <p className="wx-pop-foot mono">Demo-Prognose · Quelle für Planung: MeteoSchweiz</p>
    </div>
  );
}

Object.assign(window, { Terrain3D, RoutePhoto, WeatherWindow, shortName });
