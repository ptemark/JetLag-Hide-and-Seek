import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Circle, Marker } from 'react-leaflet';
import L from 'leaflet';
import { createGame, lookupGame, joinGame } from '../api.js';
import { centerRadiusToBounds, haversineKm, lonDeltaDeg } from './gameUtils.js';
import Alert from './Alert.jsx';
import styles from './GameForm.module.css';

const SCALES = ['small', 'medium', 'large'];

const EMPTY_BOUNDS = { lat_min: '', lat_max: '', lon_min: '', lon_max: '' };

// Nominatim free geocoding API — no key required. Rate-limited to ≤ 1 req/s
// via the 500 ms debounce below (DESIGN.md §25).
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_LIMIT = 5;

// Debounce delay keeps Nominatim requests ≤ 1/s (DESIGN.md §25).
const SEARCH_DEBOUNCE_MS = 500;

// Truncate long place names in the results dropdown for legibility.
const DISPLAY_NAME_MAX_CHARS = 60;

// Default zone radii by scale (DESIGN.md §25 Default radii by scale).
const SCALE_DEFAULT_RADIUS_KM = { small: 5, medium: 15, large: 50 };

// CartoDB dark tiles — free OSM-based dark palette, no API key (DESIGN.md §7, §22).
const CARTO_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '© <a href="https://carto.com/attributions">CARTO</a>';

// Initial zoom level used when flying to a geocoding result (DESIGN.md §22).
const PREVIEW_MAP_ZOOM = 11;

// Zone circle colour — matches --color-accent / --color-sunset-2 (DESIGN.md §22).
// Must be a literal; Leaflet pathOptions cannot accept CSS custom properties.
const ZONE_COLOR = '#F08730';

// Semi-transparent white border for draggable marker icons — ensures visibility
// against both light and dark map tiles.
const MARKER_BORDER_COLOR = 'rgba(255,255,255,0.8)';

/**
 * LocationCircle — renders the zone circle overlay on the preview map.
 * Internal component; not exported.
 *
 * Props:
 *   center   — { lat, lon } — circle centre.
 *   radiusKm — zone radius in kilometres.
 */
function LocationCircle({ center, radiusKm }) {
  return (
    <Circle
      center={[center.lat, center.lon]}
      radius={radiusKm * 1000}
      pathOptions={{
        fillColor: ZONE_COLOR,
        fillOpacity: 0.15,
        color: ZONE_COLOR,
        weight: 2,
      }}
    />
  );
}

/**
 * GameForm — lets a registered player create a new game or join an existing one.
 *
 * Create tab: scale selector + location search + map bounds (Advanced collapsible) + seeker teams toggle.
 * Join tab: game ID input.
 *
 * Props:
 *   player        — registered player record { playerId, name, role }
 *   onGameReady(game) — called with the game record when ready to proceed.
 *   initialTab    — which tab to show first: 'create' (default) or 'join'
 *   initialGameId — pre-fill the join Game ID input (e.g. from invite URL)
 */
export default function GameForm({ player, onGameReady, initialTab = 'create', initialGameId = '' }) {
  const [tab, setTab] = useState(initialTab);
  const [scale, setScale] = useState('medium');
  const [bounds, setBounds] = useState(EMPTY_BOUNDS);
  const [seekerTeams, setSeekerTeams] = useState(0);
  const [gameId, setGameId] = useState(initialGameId);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Location search state
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState([]);
  const [center, setCenter] = useState(null); // { lat, lon } or null
  const [radiusKm, setRadiusKm] = useState(SCALE_DEFAULT_RADIUS_KM.medium);
  // mapKey increments on each geocoding result selection to remount MapContainer
  // at the new location without remounting on user drags.
  const [mapKey, setMapKey] = useState(0);

  // Draggable centre marker icon — small accent circle.
  // Created in useMemo to avoid calling L.divIcon at module parse time.
  const centerMarkerIcon = useMemo(() => L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${ZONE_COLOR};cursor:move;border:2px solid ${MARKER_BORDER_COLOR};box-sizing:border-box;"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }), []);

  // Resize handle icon — small accent circle with crosshair cursor placed at the east edge.
  const resizeHandleIcon = useMemo(() => L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${ZONE_COLOR};cursor:crosshair;border:2px solid ${MARKER_BORDER_COLOR};box-sizing:border-box;"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }), []);

  // Debounced Nominatim search — fires 500 ms after the user stops typing.
  useEffect(() => {
    if (!locationQuery.trim()) {
      setLocationResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetchNominatim(locationQuery.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [locationQuery]);

  async function fetchNominatim(q) {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=${NOMINATIM_LIMIT}&addressdetails=0`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setLocationResults(data);
    } catch {
      // Network failure silently ignored; the user can retype to retry.
    }
  }

  function handleLocationSelect(result) {
    const newCenter = { lat: parseFloat(result.lat), lon: parseFloat(result.lon) };
    const newRadiusKm = SCALE_DEFAULT_RADIUS_KM[scale];
    setCenter(newCenter);
    setRadiusKm(newRadiusKm);
    setBounds(centerRadiusToBounds(newCenter, newRadiusKm));
    setMapKey(k => k + 1); // remount MapContainer centred on new location
    setLocationResults([]);
    setLocationQuery(result.display_name.slice(0, DISPLAY_NAME_MAX_CHARS));
  }

  function handleScaleChange(newScale) {
    setScale(newScale);
    if (center) {
      const newRadiusKm = SCALE_DEFAULT_RADIUS_KM[newScale];
      setRadiusKm(newRadiusKm);
      setBounds(centerRadiusToBounds(center, newRadiusKm));
    }
  }

  function handleCenterMarkerDragend(e) {
    const { lat, lng } = e.target.getLatLng();
    const newCenter = { lat, lon: lng };
    setCenter(newCenter);
    setBounds(centerRadiusToBounds(newCenter, radiusKm));
  }

  function handleResizeHandleDrag(e) {
    const { lat, lng } = e.target.getLatLng();
    const newRadius = haversineKm(center, { lat, lon: lng });
    setRadiusKm(newRadius);
    setBounds(centerRadiusToBounds(center, newRadius));
  }

  function handleResizeHandleDragend(e) {
    const { lat, lng } = e.target.getLatLng();
    const newRadius = haversineKm(center, { lat, lon: lng });
    setRadiusKm(newRadius);
    setBounds(centerRadiusToBounds(center, newRadius));
  }

  function setBound(key, value) {
    const next = { ...bounds, [key]: value };
    setBounds(next);
    // DESIGN.md §22: manual edits sync the preview map — centre = midpoint of
    // bounds, radius = half the shorter dimension.
    const latMin = parseFloat(next.lat_min);
    const latMax = parseFloat(next.lat_max);
    const lonMin = parseFloat(next.lon_min);
    const lonMax = parseFloat(next.lon_max);
    if (
      Number.isFinite(latMin) &&
      Number.isFinite(latMax) &&
      Number.isFinite(lonMin) &&
      Number.isFinite(lonMax) &&
      latMax > latMin &&
      lonMax > lonMin
    ) {
      const newCenter = { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
      const latRadiusKm = haversineKm(newCenter, { lat: latMax, lon: newCenter.lon });
      const lonRadiusKm = haversineKm(newCenter, { lat: newCenter.lat, lon: lonMax });
      setCenter(newCenter);
      setRadiusKm(Math.min(latRadiusKm, lonRadiusKm));
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const parsedBounds = {
        lat_min: parseFloat(bounds.lat_min) || 0,
        lat_max: parseFloat(bounds.lat_max) || 0,
        lon_min: parseFloat(bounds.lon_min) || 0,
        lon_max: parseFloat(bounds.lon_max) || 0,
      };
      const game = await createGame({ size: scale, bounds: parsedBounds, seekerTeams, playerId: player.playerId });
      await joinGame({ gameId: game.gameId, playerId: player.playerId, role: player.role });
      onGameReady(game);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!gameId.trim()) {
      setError('Game ID is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const game = await lookupGame(gameId.trim());
      await joinGame({ gameId: game.gameId, playerId: player.playerId, role: player.role });
      onGameReady(game);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div aria-label="Game lobby" className={`panel ${styles.container}`}>
      <h2>Game Lobby</h2>
      <p>Playing as <strong>{player.name}</strong> ({player.role})</p>

      <div role="tablist" className={styles.tabs}>
        <button
          role="tab"
          aria-selected={tab === 'create'}
          className={`${styles.tab}${tab === 'create' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => { setTab('create'); setError(''); }}
        >
          Create Game
        </button>
        <button
          role="tab"
          aria-selected={tab === 'join'}
          className={`${styles.tab}${tab === 'join' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => { setTab('join'); setError(''); }}
        >
          Join Game
        </button>
      </div>

      {tab === 'create' && (
        <form onSubmit={handleCreate} aria-label="Create game">
          <div>
            <label htmlFor="game-scale">Scale</label>
            <select
              id="game-scale"
              value={scale}
              onChange={e => handleScaleChange(e.target.value)}
            >
              {SCALES.map(s => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="seeker-teams">Seeker Teams</label>
            <select
              id="seeker-teams"
              value={seekerTeams}
              onChange={e => setSeekerTeams(Number(e.target.value))}
            >
              <option value={0}>Single team (all seekers together)</option>
              <option value={2}>Two competing teams</option>
            </select>
          </div>

          <div className={styles.locationSearch}>
            <label htmlFor="location-search">Search for a city, town or country…</label>
            <input
              id="location-search"
              type="text"
              value={locationQuery}
              onChange={e => setLocationQuery(e.target.value)}
              autoComplete="off"
              placeholder="e.g. London, Tokyo, New York"
            />
            {locationResults.length > 0 && (
              <ul role="listbox" className={styles.resultsList} aria-label="Location results">
                {locationResults.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className={styles.resultsItem}
                    onClick={() => handleLocationSelect(r)}
                  >
                    {r.display_name.slice(0, DISPLAY_NAME_MAX_CHARS)}
                    {r.display_name.length > DISPLAY_NAME_MAX_CHARS ? '…' : ''}
                  </button>
                ))}
              </ul>
            )}
          </div>

          {center !== null && (
            <>
              <div className={styles.previewMap}>
                <MapContainer
                  key={mapKey}
                  center={[center.lat, center.lon]}
                  zoom={PREVIEW_MAP_ZOOM}
                  scrollWheelZoom={false}
                  className={styles.mapContainer}
                >
                  <TileLayer url={CARTO_TILE_URL} attribution={CARTO_ATTRIBUTION} />
                  <LocationCircle center={center} radiusKm={radiusKm} />
                  <Marker
                    position={[center.lat, center.lon]}
                    draggable={true}
                    icon={centerMarkerIcon}
                    eventHandlers={{ dragend: handleCenterMarkerDragend }}
                  />
                  <Marker
                    position={[center.lat, center.lon + lonDeltaDeg(radiusKm, center.lat)]}
                    draggable={true}
                    icon={resizeHandleIcon}
                    title="Resize zone radius"
                    keyboard={false}
                    eventHandlers={{
                      drag: handleResizeHandleDrag,
                      dragend: handleResizeHandleDragend,
                    }}
                  />
                </MapContainer>
              </div>
              <output aria-label="Zone radius" className={styles.radiusOutput}>
                Zone radius: {radiusKm.toFixed(1)} km
              </output>
            </>
          )}

          <details>
            <summary className={styles.advancedSummary}>Advanced</summary>
            <fieldset>
              <legend>Map Bounds</legend>
              <div className={styles.fieldsGrid}>
                <label>
                  Lat min
                  <input
                    type="number"
                    aria-label="Lat min"
                    value={bounds.lat_min}
                    onChange={e => setBound('lat_min', e.target.value)}
                    step="any"
                  />
                </label>
                <label>
                  Lat max
                  <input
                    type="number"
                    aria-label="Lat max"
                    value={bounds.lat_max}
                    onChange={e => setBound('lat_max', e.target.value)}
                    step="any"
                  />
                </label>
                <label>
                  Lon min
                  <input
                    type="number"
                    aria-label="Lon min"
                    value={bounds.lon_min}
                    onChange={e => setBound('lon_min', e.target.value)}
                    step="any"
                  />
                </label>
                <label>
                  Lon max
                  <input
                    type="number"
                    aria-label="Lon max"
                    value={bounds.lon_max}
                    onChange={e => setBound('lon_max', e.target.value)}
                    step="any"
                  />
                </label>
              </div>
            </fieldset>
          </details>

          {error && <Alert>{error}</Alert>}

          <button type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create Game'}
          </button>
        </form>
      )}

      {tab === 'join' && (
        <form onSubmit={handleJoin} aria-label="Join game">
          <div>
            <label htmlFor="join-game-id">Game ID</label>
            <input
              id="join-game-id"
              type="text"
              value={gameId}
              onChange={e => setGameId(e.target.value)}
              placeholder="Paste game ID"
              autoComplete="off"
            />
          </div>

          {error && <Alert>{error}</Alert>}

          <button type="submit" disabled={loading}>
            {loading ? 'Joining…' : 'Join Game'}
          </button>
        </form>
      )}
    </div>
  );
}
