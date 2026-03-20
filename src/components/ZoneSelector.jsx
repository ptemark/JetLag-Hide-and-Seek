import { useState } from 'react';
import { lockZone } from '../api.js';
import styles from './ZoneSelector.module.css';

/**
 * ZoneSelector — shown to the hider during the hiding phase.
 *
 * Displays a list of selectable transit stations (zones).  The hider taps a
 * station to stage it, then confirms via a dialog to lock it.  Once locked,
 * the selector becomes read-only and calls the onZoneLocked callback.
 *
 * Props:
 *   player       — { playerId, name, role }
 *   game         — { gameId, size }
 *   zones        — array of { stationId, name, lat, lon, radiusM } from /api/zones
 *   onZoneLocked — callback(zone) called after successful lock
 */
export default function ZoneSelector({ player, game, zones = [], onZoneLocked }) {
  const [staged, setStaged]       = useState(null);   // zone staged for confirmation
  const [locked, setLocked]       = useState(null);   // confirmed/locked zone
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  async function confirmLock() {
    if (!staged || locked) return;
    setLoading(true);
    setError(null);
    try {
      const result = await lockZone({
        gameId:    game.gameId,
        stationId: staged.stationId,
        lat:       staged.lat,
        lon:       staged.lon,
        radiusM:   staged.radiusM,
        playerId:  player.playerId,
      });
      setLocked(staged);
      setStaged(null);
      if (onZoneLocked) onZoneLocked(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (locked) {
    return (
      <div aria-label="Zone selector" data-testid="zone-selector">
        <p>
          Hiding zone locked: <strong>{locked.name ?? locked.stationId}</strong>
          {' '}({locked.radiusM} m radius)
        </p>
      </div>
    );
  }

  return (
    <div aria-label="Zone selector" data-testid="zone-selector">
      <h3>Select your hiding zone</h3>
      <p className={styles.instructions}>Tap a transit station to lock your hiding zone for this game.</p>

      {error && (
        <p role="alert" className={styles.errorMsg}>
          {error}
        </p>
      )}

      {zones.length === 0 && (
        <p>No stations available in the game area.</p>
      )}

      <ul className={styles.zoneList}>
        {zones.map((zone) => (
          <li key={zone.stationId} className={styles.zoneItem}>
            <button
              disabled={!!locked || loading}
              onClick={() => setStaged(zone)}
              aria-pressed={staged?.stationId === zone.stationId}
              style={{
                fontWeight: staged?.stationId === zone.stationId ? 'bold' : 'normal',
                cursor: locked ? 'not-allowed' : 'pointer',
              }}
            >
              {zone.name ?? zone.stationId} ({zone.radiusM} m)
            </button>
          </li>
        ))}
      </ul>

      {staged && !locked && (
        <div role="dialog" aria-label="Confirm zone selection">
          <p>
            Lock <strong>{staged.name ?? staged.stationId}</strong> as your hiding zone?
          </p>
          <button className={styles.confirmBtn} onClick={confirmLock} disabled={loading}>
            {loading ? 'Locking…' : 'Confirm'}
          </button>
          <button onClick={() => setStaged(null)} disabled={loading}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
