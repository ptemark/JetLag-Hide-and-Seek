import { useState } from 'react';
import { registerPlayer } from '../api.js';

/**
 * PlayerForm — collects player name and role, then calls POST /api/players.
 *
 * Props:
 *   onRegistered(player) — called with the player record on success.
 */
export default function PlayerForm({ onRegistered }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('seeker');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const player = await registerPlayer({ name: name.trim(), role });
      onRegistered(player);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Player registration" className="panel">
      <h2>Register</h2>

      <div>
        <label htmlFor="player-name">Name</label>
        <input
          id="player-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="off"
        />
      </div>

      <fieldset>
        <legend>Role</legend>
        <label>
          <input
            type="radio"
            name="role"
            value="seeker"
            checked={role === 'seeker'}
            onChange={() => setRole('seeker')}
          />
          {' '}Seeker
        </label>
        <label>
          <input
            type="radio"
            name="role"
            value="hider"
            checked={role === 'hider'}
            onChange={() => setRole('hider')}
          />
          {' '}Hider
        </label>
      </fieldset>

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={loading}>
        {loading ? 'Registering…' : 'Register'}
      </button>
    </form>
  );
}
