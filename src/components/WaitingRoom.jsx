/**
 * WaitingRoom — displays game details and a shareable game ID while waiting
 * for all players to join before the host starts the game.
 *
 * Props:
 *   game    — game record { gameId, size, status, seekerTeams? }
 *   player  — player record { playerId, name, role, team? }
 *   onStart — callback invoked after the managed server confirms game start (optional)
 */
import { useState } from 'react';
import { startGame } from '../api.js';

export default function WaitingRoom({ game, player, onStart }) {
  const [error, setError] = useState('');
  const showTeam = (game.seekerTeams ?? 0) >= 2 && player?.role === 'seeker' && player?.team;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?gameId=${game.gameId}`;

  async function handleStart() {
    setError('');
    try {
      await startGame({ gameId: game.gameId, scale: game.size });
      onStart?.();
    } catch (err) {
      setError(err.message || 'Failed to start game');
    }
  }

  return (
    <div aria-label="Waiting room">
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
        <button onClick={handleStart}>Start Game</button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
