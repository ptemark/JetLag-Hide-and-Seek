/**
 * WaitingRoom — displays game details and a shareable game ID while waiting
 * for all players to join before the host starts the game.
 *
 * Props:
 *   game           — game record { gameId, size, status, seekerTeams? }
 *   player         — player record { playerId, name, role, team? }
 *   onStart        — callback invoked after the managed server confirms game start (host only; optional)
 *   onGameStarted  — callback invoked when the game transitions away from 'waiting' (all players)
 */
import { useState, useEffect } from 'react';
import { startGame, lookupGame } from '../api.js';
import Alert from './Alert.jsx';

/** Valid hiding duration ranges per scale (RULES.md §Game Scales), in minutes. */
const SCALE_DURATION_RANGES = {
  small:  { min: 30,  max: 60  },
  medium: { min: 60,  max: 180 },
  large:  { min: 180, max: 360 },
};

/** How often non-host players poll for game start, in milliseconds. */
const POLL_INTERVAL_MS = 3000;

export default function WaitingRoom({ game, player, onStart, onGameStarted }) {
  const [error, setError] = useState('');
  const range = SCALE_DURATION_RANGES[game.size] ?? { min: 30, max: 360 };
  const [hidingDurationMin, setHidingDurationMin] = useState(range.min);

  const showTeam = (game.seekerTeams ?? 0) >= 2 && player?.role === 'seeker' && player?.team;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?gameId=${game.gameId}`;

  // Non-host players poll the API until the host starts the game.
  useEffect(() => {
    if (onStart || !onGameStarted) return;

    let cancelled = false;
    const id = setInterval(async () => {
      if (cancelled) return;
      try {
        const g = await lookupGame(game.gameId);
        if (!cancelled && g.status !== 'waiting') {
          cancelled = true;
          clearInterval(id);
          onGameStarted();
        }
      } catch {
        // ignore transient poll failures
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Run once on mount. Props are stable during the WaitingRoom's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart() {
    setError('');
    try {
      await startGame({ gameId: game.gameId, scale: game.size, hidingDurationMin });
      onStart?.();
      onGameStarted?.();
    } catch (err) {
      setError(err.message || 'Failed to start game');
    }
  }

  return (
    <div aria-label="Waiting room" className="panel">
      <h2>Waiting Room</h2>
      <p>
        Game ID: <code>{game.gameId}</code>
      </p>
      <p>Scale: {game.size}</p>
      {(game.seekerTeams ?? 0) >= 2 && (
        <p>Mode: Two competing seeker teams</p>
      )}
      <p>Status: {game.status}</p>
      {showTeam && (
        <p aria-label="Team assignment">
          Your team: <strong>Team {player.team}</strong>
        </p>
      )}
      <p>
        Invite link:{' '}
        <a href={inviteUrl} aria-label="Invite link">{inviteUrl}</a>
      </p>
      {onStart && (
        <div>
          <label>
            Hiding duration (min):{' '}
            <input
              type="number"
              aria-label="Hiding duration"
              min={range.min}
              max={range.max}
              value={hidingDurationMin}
              onChange={(e) => setHidingDurationMin(Number(e.target.value))}
            />
          </label>
          <small> ({range.min}–{range.max} min for {game.size} scale)</small>
        </div>
      )}
      {onStart && (
        <button onClick={handleStart}>Start Game</button>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
