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
 * Format bonus seconds as "+Xm" (e.g. 120 → "+2m"). Returns null when zero.
 * @param {number} bonusSeconds
 * @returns {string|null}
 */
function fmtBonus(bonusSeconds) {
  if (!bonusSeconds) return null;
  return `+${Math.round(bonusSeconds / 60)}m`;
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

  const sorted = [...scores].sort((a, b) => {
    const totalA = a.scoreSeconds + (a.bonusSeconds ?? 0);
    const totalB = b.scoreSeconds + (b.bonusSeconds ?? 0);
    return totalB - totalA;
  });

  return (
    <table aria-label="leaderboard">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Scale</th>
          <th>Score</th>
          <th>Bonus</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s, i) => {
          const total = s.scoreSeconds + (s.bonusSeconds ?? 0);
          const bonus = fmtBonus(s.bonusSeconds ?? 0);
          return (
            <tr key={`${i}-${s.playerName}`}>
              <td>{i + 1}</td>
              <td>{s.playerName}</td>
              <td>{s.scale ?? '—'}</td>
              <td>{fmtMmSs(total)}</td>
              <td>{bonus ?? ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
