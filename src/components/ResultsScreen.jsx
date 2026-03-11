/**
 * ResultsScreen — full-screen overlay shown when the game ends (phase → finished).
 *
 * Props:
 *   winner       — 'hider' | 'seekers'
 *   elapsedMs    — milliseconds the hider was hidden (base hiding time)
 *   bonusSeconds — total bonus seconds from time_bonus cards played
 *   onPlayAgain  — callback invoked when the user taps "Play Again"
 */

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

  const bannerStyle = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: isHiderWin ? 'rgba(0,100,0,0.92)' : 'rgba(139,0,0,0.92)',
    color: '#fff',
    zIndex: 9999,
    padding: '2rem',
    textAlign: 'center',
    gap: '1rem',
  };

  return (
    <div aria-label="Results screen" role="dialog" style={bannerStyle}>
      <h1 style={{ margin: 0, fontSize: '2.5rem' }}>
        {isHiderWin ? 'Hider Wins!' : 'Seekers Win!'}
      </h1>

      <table aria-label="Game results" style={{ borderCollapse: 'collapse', minWidth: 260 }}>
        <tbody>
          <tr>
            <td style={{ padding: '0.4rem 1rem', textAlign: 'right', opacity: 0.8 }}>Hiding time:</td>
            <td style={{ padding: '0.4rem 1rem', fontWeight: 'bold' }}>
              {formatDuration(elapsedMs)}
            </td>
          </tr>
          {bonusSeconds > 0 && (
            <tr>
              <td style={{ padding: '0.4rem 1rem', textAlign: 'right', opacity: 0.8 }}>Card bonus:</td>
              <td style={{ padding: '0.4rem 1rem', fontWeight: 'bold' }}>
                +{formatDuration(bonusSeconds * 1000)}
              </td>
            </tr>
          )}
          <tr>
            <td style={{ padding: '0.4rem 1rem', textAlign: 'right', opacity: 0.8 }}>Final score:</td>
            <td style={{ padding: '0.4rem 1rem', fontWeight: 'bold', fontSize: '1.2rem' }}>
              {finalScore}s
            </td>
          </tr>
        </tbody>
      </table>

      <button
        aria-label="Play Again"
        onClick={onPlayAgain}
        style={{
          marginTop: '1.5rem',
          padding: '0.75rem 2rem',
          fontSize: '1.1rem',
          borderRadius: 8,
          border: 'none',
          background: '#fff',
          color: '#333',
          cursor: 'pointer',
          fontWeight: 'bold',
        }}
      >
        Play Again
      </button>
    </div>
  );
}
