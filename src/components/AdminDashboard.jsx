import { useState } from 'react';
import { fetchAdminStatus } from '../api.js';
import Alert from './Alert.jsx';
import Button from './Button.jsx';
import styles from './AdminDashboard.module.css';

/**
 * AdminDashboard — live server metrics for operators.
 *
 * Renders a key-entry form. On submit calls GET /api/admin with the provided
 * bearer token and displays connected-player count, active-game count, and a
 * per-game table. A Refresh button re-fetches without re-entering the key.
 *
 * Only shown when ENV.features.adminDashboard is true (gated in Lobby.jsx).
 */
export default function AdminDashboard() {
  const [apiKey, setApiKey] = useState('');
  const [submittedKey, setSubmittedKey] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleConnect(e) {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key) return;
    setError('');
    setLoading(true);
    try {
      const data = await fetchAdminStatus(key);
      setSubmittedKey(key);
      setStatus(data);
    } catch (err) {
      setError(err.message);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    if (!submittedKey) return;
    setError('');
    setLoading(true);
    try {
      const data = await fetchAdminStatus(submittedKey);
      setStatus(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /** Format phaseElapsedMs as "Xm Ys". */
  function fmtElapsed(ms) {
    const totalS = Math.floor(ms / 1000);
    const m = Math.floor(totalS / 60);
    const s = totalS % 60;
    return `${m}m ${s}s`;
  }

  return (
    <div className={styles.container}>
      <h2>Admin Dashboard</h2>

      <form onSubmit={handleConnect} className={styles.keyForm}>
        <label htmlFor="admin-api-key" className={styles.keyLabel}>Admin API Key</label>
        <input
          id="admin-api-key"
          type="password"
          aria-label="Admin API Key"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Enter admin bearer token"
          autoComplete="current-password"
        />
        <Button type="submit" variant="primary">Connect</Button>
      </form>

      {error && <Alert>{error}</Alert>}
      {loading && <p>Loading&hellip;</p>}

      {status && !loading && (
        <>
          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Connected Players</span>
              <span className={styles.statValue}>{status.connectedPlayers}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Active Games</span>
              <span className={styles.statValue}>{status.activeGameCount}</span>
            </div>
          </div>

          {status.games && status.games.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Game ID</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Elapsed</th>
                  <th scope="col">Players</th>
                </tr>
              </thead>
              <tbody>
                {status.games.map(g => (
                  <tr key={g.gameId}>
                    <td><code>{g.gameId}</code></td>
                    <td>{g.phase}</td>
                    <td>{fmtElapsed(g.phaseElapsedMs ?? 0)}</td>
                    <td>{g.playerCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No active games</p>
          )}

          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={handleRefresh}>Refresh</Button>
          </div>
        </>
      )}
    </div>
  );
}
