import { useState } from 'react';
import { createGame, lookupGame } from '../api.js';

const SCALES = ['small', 'medium', 'large'];

const EMPTY_BOUNDS = { lat_min: '', lat_max: '', lon_min: '', lon_max: '' };

/**
 * GameForm — lets a registered player create a new game or join an existing one.
 *
 * Create tab: scale selector + map bounds picker (4 numeric fields) + seeker teams toggle.
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
      onGameReady(game);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div aria-label="Game lobby" className="panel">
      <h2>Game Lobby</h2>
      <p>Playing as <strong>{player.name}</strong> ({player.role})</p>

      <div role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'create'}
          onClick={() => { setTab('create'); setError(''); }}
        >
          Create Game
        </button>
        <button
          role="tab"
          aria-selected={tab === 'join'}
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
              onChange={e => setScale(e.target.value)}
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

          <fieldset>
            <legend>Map Bounds</legend>
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
          </fieldset>

          {error && <p role="alert">{error}</p>}

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

          {error && <p role="alert">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? 'Joining…' : 'Join Game'}
          </button>
        </form>
      )}
    </div>
  );
}
