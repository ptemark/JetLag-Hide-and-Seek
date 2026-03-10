import { useState } from 'react';
import PlayerForm from './PlayerForm.jsx';
import GameForm from './GameForm.jsx';
import WaitingRoom from './WaitingRoom.jsx';
import GameMap from './GameMap.jsx';

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? '';

/**
 * Lobby — top-level game lobby view.
 *
 * Manages the four-step flow:
 *   1. Player registration (PlayerForm)
 *   2. Create or join a game (GameForm)
 *   3. Waiting room (WaitingRoom) — share game ID; host starts game
 *   4. Active game (GameMap) — live map with locations and zones
 */
export default function Lobby() {
  const [player, setPlayer] = useState(null);
  const [game, setGame] = useState(null);
  const [playing, setPlaying] = useState(false);

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

      {game && !playing && (
        <WaitingRoom game={game} onStart={() => setPlaying(true)} />
      )}

      {game && playing && (
        <GameMap
          player={player}
          game={game}
          serverUrl={SERVER_URL}
        />
      )}
    </div>
  );
}
