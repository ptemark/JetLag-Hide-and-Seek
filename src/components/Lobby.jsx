import { lazy, Suspense, useState } from 'react';
import { ENV } from '../../config/env.js';
import AppHeader from './AppHeader.jsx';
import PlayerForm from './PlayerForm.jsx';
import GameForm from './GameForm.jsx';
import WaitingRoom from './WaitingRoom.jsx';
import GameMap from './GameMap.jsx';

// Lazy-load non-critical views that are never needed on initial render
// (RALPH.md §Performance / Mobile — lazy-load non-critical views)
const Leaderboard = lazy(() => import('./Leaderboard.jsx'));
const AdminDashboard = lazy(() => import('./AdminDashboard.jsx'));

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? '';

/** Read ?gameId from the page URL (set once at load time). */
function getUrlGameId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('gameId') ?? '';
}

/**
 * Lobby — top-level game lobby view.
 *
 * Manages the four-step flow:
 *   1. Player registration (PlayerForm)
 *   2. Create or join a game (GameForm)
 *   3. Waiting room (WaitingRoom) — share game ID; host starts game
 *   4. Active game (GameMap) — live map with locations and zones
 *
 * When the page URL contains ?gameId=xxx (e.g. from an invite link), the
 * GameForm opens on the Join tab with the game ID pre-filled.
 *
 * A "Leaderboard" tab button is shown whenever the game is not active,
 * toggling a full leaderboard view over the current lobby step.
 */
export default function Lobby() {
  const [player, setPlayer] = useState(null);
  const [game, setGame] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const urlGameId = getUrlGameId();

  return (
    <div>
      <AppHeader />

      {!playing && (
        <>
          <button type="button" onClick={() => { setShowLeaderboard(v => !v); setShowAdmin(false); }}>
            {showLeaderboard ? 'Back' : 'Leaderboard'}
          </button>
          {ENV.features.adminDashboard && (
            <button type="button" onClick={() => { setShowAdmin(v => !v); setShowLeaderboard(false); }}>
              {showAdmin ? 'Back' : 'Admin'}
            </button>
          )}
        </>
      )}

      {showAdmin && !playing ? (
        <Suspense fallback={null}><AdminDashboard /></Suspense>
      ) : showLeaderboard && !playing ? (
        <Suspense fallback={null}><Leaderboard /></Suspense>
      ) : (
        <>
          {!player && (
            <PlayerForm onRegistered={setPlayer} />
          )}

          {player && !game && (
            <GameForm
              player={player}
              onGameReady={setGame}
              initialTab={urlGameId ? 'join' : 'create'}
              initialGameId={urlGameId}
            />
          )}

          {game && !playing && (
            <WaitingRoom
              game={game}
              player={player}
              onStart={player.playerId === game.hostPlayerId ? () => {} : undefined}
              onGameStarted={() => setPlaying(true)}
            />
          )}

          {game && playing && (
            <GameMap
              player={player}
              game={game}
              serverUrl={SERVER_URL}
              onPlayAgain={() => { setGame(null); setPlaying(false); }}
            />
          )}
        </>
      )}
    </div>
  );
}
