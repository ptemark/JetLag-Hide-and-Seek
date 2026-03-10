/**
 * WaitingRoom — displays game details and a shareable game ID while waiting
 * for all players to join before the host starts the game.
 *
 * Props:
 *   game    — game record { gameId, size, status }
 *   onStart — callback invoked when the host taps "Start Game" (optional)
 */
export default function WaitingRoom({ game, onStart }) {
  return (
    <div aria-label="Waiting room">
      <h2>Waiting Room</h2>
      <p>
        Game ID: <code>{game.gameId}</code>
      </p>
      <p>Scale: {game.size}</p>
      <p>Status: {game.status}</p>
      <p>Share the Game ID with other players so they can join.</p>
      {onStart && (
        <button onClick={onStart}>Start Game</button>
      )}
    </div>
  );
}
