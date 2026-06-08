/* Peakr — stylised relief map + markers (CSS terrain, no external tiles) */

const Z_MIN = 1, Z_MAX = 3.2, Z_LABELS = 1.45;

function ReliefMap({ results, originPt, originLabel, selectedId, onSelect, mode, dir, alwaysLabels }) {
  const ox = mapX(originPt.lng), oy = mapY(originPt.lat);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const wrapRef = React.useRef(null);
  const drag = React.useRef(null);

  const clampPan = React.useCallback((p, z) => {
    const el = wrapRef.current;
    if (!el) return p;
    const m = (el.clientWidth * (z - 1)) / 2;
    const mh = (el.clientHeight * (z - 1)) / 2;
    return { x: Math.max(-m, Math.min(m, p.x)), y: Math.max(-mh, Math.min(mh, p.y)) };
  }, []);

  const zoomBy = (delta, cx, cy) => {
    setZoom((z) => {
      const nz = Math.max(Z_MIN, Math.min(Z_MAX, z + delta));
      setPan((p) => clampPan(nz === 1 ? { x: 0, y: 0 } : p, nz));
      return nz;
    });
  };

  const onWheel = (e) => { e.preventDefault(); zoomBy(-e.deltaY * 0.0016); };
  const onDown = (e) => {
    if (e.button !== 0 || zoom === 1) return;
    drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const np = { x: drag.current.px + (e.clientX - drag.current.sx), y: drag.current.py + (e.clientY - drag.current.sy) };
    setPan(clampPan(np, zoom));
  };
  const onUp = () => { drag.current = null; };

  const labelsOn = alwaysLabels && zoom >= Z_LABELS;
  const sceneStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    '--mz': zoom,
  };

  return (
    <div
      className={'map-wrap' + (zoom > 1 ? ' is-zoomed' : '') + (labelsOn ? ' labels-on' : '')}
      ref={wrapRef}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <div className="map-scene" style={sceneStyle}>
        {/* terrain surface built from layered gradients + faint graticule */}
        <div className="map-terrain" />
        <div className="map-hillshade" />
        <div className="map-grid" />
        <svg className="map-grain" aria-hidden="true">
          <filter id="pkGrain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /></filter>
          <rect width="100%" height="100%" filter="url(#pkGrain)" />
        </svg>

        {/* lakes */}
        {LAKES.map((l) => (
          <div key={l.name} className="map-lake" style={{
            left: mapX(l.lng) + '%', top: mapY(l.lat) + '%',
            width: l.w + '%', height: l.h + '%',
            transform: `translate(-50%,-50%) rotate(${l.r}deg)`,
          }} />
        ))}

        {/* origin */}
        <div className="map-origin" style={{ left: ox + '%', top: oy + '%' }}>
          <span className="map-origin-dot" />
          <span className="map-origin-ring" />
          <span className="map-origin-tag">{originLabel}</span>
        </div>

        {/* destination markers */}
        {results.map((r) => {
          const sel = r.id === selectedId;
          return (
            <button
              key={r.id}
              type="button"
              className={'map-pin' + (sel ? ' is-sel' : '') + (r.suggestion ? ' is-sug' : '')}
              style={{ left: mapX(r.lng) + '%', top: mapY(r.lat) + '%', zIndex: sel ? 40 : 10 }}
              onClick={() => onSelect(r.id)}
              aria-label={r.name}
            >
              <span className="map-pin-token" style={{ '--pin': scoreColor(r.score) }}>
                <Icon name={mode === 'ski' ? 'Mountain' : 'Footprints'} size={sel ? 16 : 13} stroke={2} />
              </span>
              <span className="map-pin-label">
                <span className="map-pin-name">{r.name.split(' – ')[0].split(' (')[0]}</span>
                <span className="map-pin-meta">{r.score} · {fmtDrive(r.driveMin)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* zoom controls (outside the scaled scene) */}
      <div className="map-zoom">
        <button type="button" onClick={() => zoomBy(0.6)} aria-label="Vergrössern"><Icon name="Plus" size={18} stroke={2.25} /></button>
        <span className="map-zoom-div" />
        <button type="button" onClick={() => zoomBy(-0.6)} disabled={zoom <= Z_MIN} aria-label="Verkleinern"><Icon name="Minus" size={18} stroke={2.25} /></button>
        {zoom > 1 && (
          <>
            <span className="map-zoom-div" />
            <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Ansicht zurücksetzen"><Icon name="Maximize" size={15} stroke={2.25} /></button>
          </>
        )}
      </div>

      <div className="map-legend">
        <span className="map-legend-t">Score</span>
        <span className="map-legend-bar" />
        <span className="map-legend-sc"><span>schwach</span><span>top</span></span>
      </div>

      <div className="map-attrib">Schematische Reliefkarte · Daten: Demo</div>
    </div>
  );
}

window.ReliefMap = ReliefMap;
