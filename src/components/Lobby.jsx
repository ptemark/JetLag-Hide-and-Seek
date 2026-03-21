import { lazy, Suspense, useState } from 'react';
import { ENV } from '../../config/env.js';
import AppHeader from './AppHeader.jsx';
import PlayerForm from './PlayerForm.jsx';
import GameForm from './GameForm.jsx';
import WaitingRoom from './WaitingRoom.jsx';
import GameMap from './GameMap.jsx';
import styles from './Lobby.module.css';

// Lazy-load non-critical views that are never needed on initial render
// (RALPH.md §Performance / Mobile — lazy-load non-critical views)
const Leaderboard = lazy(() => import('./Leaderboard.jsx'));
const AdminDashboard = lazy(() => import('./AdminDashboard.jsx'));

// Use ENV.wsUrl (VITE_WS_URL) as the single source of truth for the
// WebSocket server address — defined in config/env.js and .env.example.
const SERVER_URL = ENV.wsUrl;

// localStorage key for persisting player identity across page reloads.
// Allows mobile players who accidentally close/refresh the tab to resume
// without losing their playerId — critical for WS reconnect (Task 158).
const STORAGE_KEY = 'jetlag_player';

/** Read ?gameId from the page URL (set once at load time). */
function getUrlGameId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('gameId') ?? '';
}

/**
 * Restore a previously saved player from localStorage.
 * Returns the player object when all required fields are non-empty strings,
 * or null if the entry is absent, malformed, or incomplete.
 */
function restorePlayer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (
      saved &&
      typeof saved.playerId === 'string' && saved.playerId &&
      typeof saved.name === 'string' && saved.name &&
      typeof saved.role === 'string' && saved.role
    ) {
      return saved;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Lobby — top-level game lobby view.
 *
 * Manages the four-step flow:
 *   1. Player registration (PlayerForm) — skipped when identity is restored
 *      from localStorage (Task 158).
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
  // Initialise synchronously from localStorage so there is no flash of the
  // registration form on reload when a player identity has been saved.
  const [player, setPlayer] = useState(() => restorePlayer());
  const [game, setGame] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const urlGameId = getUrlGameId();

  /** Persist player to localStorage then update state. */
  function handleRegistered(registeredPlayer) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registeredPlayer));
    setPlayer(registeredPlayer);
  }

  /** Clear saved identity and return to the registration form. */
  function handleChangePlayer() {
    localStorage.removeItem(STORAGE_KEY);
    setPlayer(null);
  }

  return (
    <div>
      <AppHeader />

      {player && !playing && (
        <button
          type="button"
          className={styles.changePlayerBtn}
          onClick={handleChangePlayer}
          aria-label="Change player identity"
        >
          Not {player.name}?
        </button>
      )}

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
            <PlayerForm onRegistered={handleRegistered} />
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
