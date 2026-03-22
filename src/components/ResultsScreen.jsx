/**
 * ResultsScreen — full-screen overlay shown when the game ends (phase → finished).
 *
 * Props:
 *   winner       — 'hider' | 'seekers'
 *   elapsedMs    — milliseconds the hider was hidden (base hiding time)
 *   bonusSeconds — total bonus seconds from time_bonus cards played
 *   captureTeam  — (optional) 'A' | 'B' | null — winning seeker team in two-team mode
 *   onPlayAgain  — callback invoked when the user taps "Play Again"
 */
import styles from './ResultsScreen.module.css';
import { formatDuration } from './gameUtils.js';

export default function ResultsScreen({ winner, elapsedMs, bonusSeconds = 0, captureTeam = null, onPlayAgain }) {
  const isHiderWin  = winner === 'hider';
  const finalScore  = Math.max(0, Math.floor(elapsedMs / 1000)) + bonusSeconds;

  const winnerLabel = isHiderWin
    ? 'Hider Wins!'
    : captureTeam
      ? `Seekers Win! (Team ${captureTeam})`
      : 'Seekers Win!';

  return (
    <div aria-label="Results screen" role="dialog" className={styles.overlay}>
      <h1 className={styles.winner}>
        {winnerLabel}
      </h1>

      <div className={styles.stats}>
        <table aria-label="Game results" className={styles.statsTable}>
          <tbody>
            <tr>
              <td className={styles.labelCell}>Hiding time:</td>
              <td className={styles.valueCell}>
                {formatDuration(elapsedMs)}
              </td>
            </tr>
            {bonusSeconds > 0 && (
              <tr>
                <td className={styles.labelCell}>Card bonus:</td>
                <td className={styles.valueCell}>
                  +{formatDuration(bonusSeconds * 1000)}
                </td>
              </tr>
            )}
            <tr>
              <td className={styles.labelCell}>Final score:</td>
              <td className={styles.valueCell}>
                {finalScore}s
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <button
        aria-label="Play Again"
        onClick={onPlayAgain}
        className={styles.playAgainBtn}
      >
        Play Again
      </button>
    </div>
  );
}
