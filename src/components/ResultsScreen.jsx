/**
 * ResultsScreen — full-screen overlay shown when the game ends (phase → finished).
 *
 * Props:
 *   winner       — 'hider' | 'seekers'
 *   elapsedMs    — milliseconds the hider was hidden (base hiding time)
 *   bonusSeconds — total bonus seconds from time_bonus cards played
 *   onPlayAgain  — callback invoked when the user taps "Play Again"
 */
import styles from './ResultsScreen.module.css';

/**
 * Format a duration in milliseconds as "Xh Ym Zs" or "Ym Zs".
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins  = Math.floor((totalSecs % 3600) / 60);
  const secs  = totalSecs % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0)  return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function ResultsScreen({ winner, elapsedMs, bonusSeconds = 0, onPlayAgain }) {
  const isHiderWin  = winner === 'hider';
  const finalScore  = Math.max(0, Math.floor(elapsedMs / 1000)) + bonusSeconds;

  return (
    <div aria-label="Results screen" role="dialog" className={styles.overlay}>
      <h1 className={styles.winner}>
        {isHiderWin ? 'Hider Wins!' : 'Seekers Win!'}
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
