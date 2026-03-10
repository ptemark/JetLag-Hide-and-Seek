import { useState } from 'react';
import PlayerForm from './PlayerForm.jsx';
import GameForm from './GameForm.jsx';
import WaitingRoom from './WaitingRoom.jsx';

/**
 * Lobby — top-level game lobby view.
 *
 * Manages the three-step flow:
 *   1. Player registration (PlayerForm)
 *   2. Create or join a game (GameForm)
 *   3. Waiting room (WaitingRoom)
 */
export default function Lobby() {
  const [player, setPlayer] = useState(null);
  const [game, setGame] = useState(null);

  return (
    <div>
      <h1>JetLag: The Game</h1>
      <p>Hide and seek across transit networks.</p>

      {!player && (
        <PlayerForm onRegistered={setPlayer} />
      )}

      {player && !game && (
        <GameForm player={player} onGameReady={setGame} />
      )}

      {game && (
        <WaitingRoom game={game} />
      )}
    </div>
  );
}
