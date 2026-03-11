import { useState, useEffect } from 'react';
import { fetchLeaderboard } from '../api.js';

/**
 * Format seconds as MM:SS (e.g. 90 → "01:30").
 * @param {number} seconds
 * @returns {string}
 */
function fmtMmSs(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

/**
 * Leaderboard — displays top scores across all games (or a single game).
 *
 * Props:
 *   gameId {string} [optional] — filter to a specific game
 */
export default function Leaderboard({ gameId } = {}) {
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchLeaderboard({ limit: 20, gameId })
      .then(data => {
        setScores(data.scores);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [gameId]);

  if (loading) return <p>Loading leaderboard…</p>;
  if (error) return <p role="alert">Failed to load leaderboard: {error}</p>;
  if (scores.length === 0) return <p>No scores yet.</p>;

  return (
    <table aria-label="leaderboard">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Scale</th>
          <th>Hiding Time</th>
        </tr>
      </thead>
      <tbody>
        {scores.map(s => (
          <tr key={`${s.rank}-${s.playerName}`}>
            <td>{s.rank}</td>
            <td>{s.playerName}</td>
            <td>{s.scale ?? '—'}</td>
            <td>{fmtMmSs(s.scoreSeconds)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
