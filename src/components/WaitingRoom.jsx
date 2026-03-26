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
import { useState, useEffect, useRef } from 'react';
import { startGame, lookupGame, markPlayerReady, fetchReadyStatus } from '../api.js';
import { SCALE_DURATION_RANGES } from '../../config/gameRules.js';
import Alert from './Alert.jsx';
import styles from './WaitingRoom.module.css';

/** How often non-host players poll for game start, in milliseconds. */
const POLL_INTERVAL_MS = 3000;

/** Duration (ms) to show "Copied!" confirmation before reverting the button label. */
const CLIPBOARD_RESET_MS = 2_000;

export default function WaitingRoom({ game, player, onStart, onGameStarted }) {
  const [error, setError] = useState('');
  const range = SCALE_DURATION_RANGES[game.size] ?? { min: 30, max: 360 };
  const [hidingDurationMin, setHidingDurationMin] = useState(range.min);
  const [copied, setCopied] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [readyError, setReadyError] = useState(null);
  const copyTimerRef = useRef(null);

  const showTeam = (game.seekerTeams ?? 0) >= 2 && player?.role === 'seeker' && player?.team;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?gameId=${game.gameId}`;

  // Clear any pending clipboard reset timer on unmount to prevent state updates.
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  // Poll ready status for all players (including host) so everyone sees the count.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const status = await fetchReadyStatus(game.gameId);
        setReadyCount(status.readyCount);
        setTotalCount(status.totalCount);
      } catch {
        // ignore transient poll failures
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // Run once on mount. game.gameId is stable during the WaitingRoom's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), CLIPBOARD_RESET_MS);
    } catch {
      // Clipboard API unavailable or denied — the link is still visible for manual copy.
    }
  }

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

  async function handleToggleReady() {
    setReadyError(null);
    const next = !isReady;
    try {
      const status = await markPlayerReady({ gameId: game.gameId, playerId: player.playerId, ready: next });
      setIsReady(next);
      setReadyCount(status.readyCount);
      setTotalCount(status.totalCount);
    } catch (err) {
      setReadyError(err.message || 'Could not update ready status');
    }
  }

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
        Game ID: <code className={styles.inviteCode}>{game.gameId}</code>
      </p>
      <p>Scale: {game.size}</p>
      {(game.seekerTeams ?? 0) >= 2 && (
        <p>Mode: Two competing seeker teams</p>
      )}
      <p>Status: {game.status}</p>
      {showTeam && (
        <p aria-label="Team assignment">
          Your team: <strong className={styles.teamBadge}>Team {player.team}</strong>
        </p>
      )}
      <p>Invite link:</p>
      <div className={styles.inviteRow}>
        <a href={inviteUrl} aria-label="Invite link" className={styles.inviteLink}>{inviteUrl}</a>
        <button
          type="button"
          aria-label="Copy invite link"
          className={styles.copyBtn}
          onClick={handleCopyLink}
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
      </div>
      {onStart && (
        <div className={styles.durationRow}>
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
      <div className={styles.readyRow}>
        <button
          type="button"
          aria-label={isReady ? 'Cancel ready' : "I'm Ready"}
          className={isReady ? styles.readyBtnActive : styles.readyBtn}
          onClick={handleToggleReady}
        >
          {isReady ? 'Cancel Ready' : "I'm Ready"}
        </button>
        <span className={styles.readyCount} aria-live="polite">
          ({readyCount}/{totalCount} ready)
        </span>
      </div>
      {readyError && <Alert>{readyError}</Alert>}
      {onStart && (
        <button onClick={handleStart}>Start Game</button>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
