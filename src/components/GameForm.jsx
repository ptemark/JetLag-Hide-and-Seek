import { useState, useEffect } from 'react';
import { createGame, lookupGame, joinGame } from '../api.js';
import { centerRadiusToBounds } from './gameUtils.js';
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
    setBounds(centerRadiusToBounds(newCenter, newRadiusKm));
    setLocationResults([]);
    setLocationQuery(result.display_name.slice(0, DISPLAY_NAME_MAX_CHARS));
  }

  function handleScaleChange(newScale) {
    setScale(newScale);
    if (center) {
      const newRadiusKm = SCALE_DEFAULT_RADIUS_KM[newScale];
      setBounds(centerRadiusToBounds(center, newRadiusKm));
    }
  }

  function setBound(key, value) {
    setBounds(prev => ({ ...prev, [key]: value }));
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
