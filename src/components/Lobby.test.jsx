import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock GameMap to prevent Leaflet from running in jsdom when Lobby transitions
// to the playing state. GameMap behaviour is tested in its own test file.
// vi.fn() so tests can inspect the props passed by Lobby (e.g. serverUrl).
vi.mock('./GameMap.jsx', () => ({ default: vi.fn(() => null) }));

// Hoist marker event handler capture so it's accessible inside the factory
// and in test assertions.
const leafletMapMocks = vi.hoisted(() => ({
  centerMarkerDragend: null,
  resizeHandlerDrag: null,
  resizeHandlerDragend: null,
}));

// Mock react-leaflet so the preview map renders a testable DOM element
// without needing a real Leaflet environment.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => (
    <div data-testid="preview-map" role="region" aria-label="Preview map">
      {children}
    </div>
  ),
  TileLayer: () => null,
  Circle: () => null,
  Marker: ({ eventHandlers, title }) => {
    if (title === 'Resize zone radius') {
      leafletMapMocks.resizeHandlerDrag = eventHandlers?.drag ?? null;
      leafletMapMocks.resizeHandlerDragend = eventHandlers?.dragend ?? null;
    } else {
      leafletMapMocks.centerMarkerDragend = eventHandlers?.dragend ?? null;
    }
    return null;
  },
}));

// Mock leaflet so L.divIcon() (used for the custom marker icon) works in jsdom.
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})) } }));

// Mock API module before importing components that use it.
vi.mock('../api.js', () => ({
  registerPlayer: vi.fn(),
  createGame: vi.fn(),
  lookupGame: vi.fn(),
  joinGame: vi.fn().mockResolvedValue({ gameId: 'g1', playerId: 'p1', role: 'seeker', team: null }),
  startGame: vi.fn(),
  submitQuestion: vi.fn(),
  listQuestions: vi.fn().mockResolvedValue([]),
  submitAnswer: vi.fn(),
  fetchCards: vi.fn().mockResolvedValue([]),
  playCardApi: vi.fn(),
  uploadQuestionPhoto: vi.fn(),
  fetchQuestionPhoto: vi.fn(),
  submitScore: vi.fn(),
  fetchLeaderboard: vi.fn().mockResolvedValue([]),
  lockZone: vi.fn(),
  fetchAdminStatus: vi.fn(),
}));

// Mock ENV so individual tests can toggle feature flags without relying on
// VITE_* env vars being set. The mutable object lets beforeEach reset state.
// wsUrl is the WebSocket server address used by GameMap via SERVER_URL.
vi.mock('../../config/env.js', () => ({
  ENV: { wsUrl: 'ws://test-server', features: { adminDashboard: false } },
}));

import * as api from '../api.js';
import { ENV } from '../../config/env.js';
import GameMap from './GameMap.jsx';
import PlayerForm from './PlayerForm.jsx';
import GameForm from './GameForm.jsx';
import WaitingRoom from './WaitingRoom.jsx';
import Lobby from './Lobby.jsx';

const PLAYER = { playerId: 'p1', name: 'Alice', role: 'seeker', createdAt: '2026-01-01T00:00:00Z' };
const BOUNDS = { lat_min: 51.5, lat_max: 51.6, lon_min: -0.1, lon_max: 0.0 };
const GAME   = { gameId: 'g1', size: 'medium', status: 'waiting', hostPlayerId: 'p1', bounds: BOUNDS };

beforeEach(() => {
  vi.clearAllMocks();
  // Restore joinGame to the default resolved value after any test that
  // may have set mockRejectedValue (clearAllMocks does not reset implementations).
  api.joinGame.mockResolvedValue({ gameId: 'g1', playerId: 'p1', role: 'seeker', team: null });
  // Reset feature flag to off so existing tests are unaffected.
  ENV.features.adminDashboard = false;
  // Reset captured marker handler between tests.
  leafletMapMocks.centerMarkerDragend = null;
  // Remove the player persistence key between tests so player-persistence
  // tests are isolated without depending on localStorage.clear() (Task 158).
  localStorage.removeItem('jetlag_player');
});

// ---------------------------------------------------------------------------
// PlayerForm
// ---------------------------------------------------------------------------

describe('PlayerForm', () => {
  it('renders name input, role radios, and submit button', () => {
    render(<PlayerForm onRegistered={() => {}} />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /seeker/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /hider/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
  });

  it('seeker is selected by default', () => {
    render(<PlayerForm onRegistered={() => {}} />);
    expect(screen.getByRole('radio', { name: /seeker/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /hider/i })).not.toBeChecked();
  });

  it('shows error when submitting with empty name', async () => {
    const user = userEvent.setup();
    render(<PlayerForm onRegistered={() => {}} />);
    await user.click(screen.getByRole('button', { name: /register/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i);
  });

  it('calls registerPlayer with trimmed name and chosen role', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    render(<PlayerForm onRegistered={() => {}} />);

    await user.type(screen.getByLabelText(/name/i), '  Alice  ');
    await user.click(screen.getByRole('radio', { name: /seeker/i }));
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => expect(api.registerPlayer).toHaveBeenCalledWith({ name: 'Alice', role: 'seeker' }));
  });

  it('calls onRegistered with player data on success', async () => {
    const user = userEvent.setup();
    const onRegistered = vi.fn();
    api.registerPlayer.mockResolvedValue(PLAYER);
    render(<PlayerForm onRegistered={onRegistered} />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(PLAYER));
  });

  it('shows error when registerPlayer rejects', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockRejectedValue(new Error('server error'));
    render(<PlayerForm onRegistered={() => {}} />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/server error/i));
  });

  it('allows selecting hider role', async () => {
    const user = userEvent.setup();
    render(<PlayerForm onRegistered={() => {}} />);
    await user.click(screen.getByRole('radio', { name: /hider/i }));
    expect(screen.getByRole('radio', { name: /hider/i })).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// GameForm
// ---------------------------------------------------------------------------

describe('GameForm', () => {
  it('renders player name, create and join tab buttons', () => {
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /create game/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /join game/i })).toBeInTheDocument();
  });

  it('shows scale selector with small, medium, large options by default', () => {
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);
    const select = screen.getByLabelText(/scale/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /small/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /medium/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /large/i })).toBeInTheDocument();
  });

  it('shows all four bounds inputs on create tab', () => {
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);
    expect(screen.getByLabelText(/lat min/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lat max/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lon min/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lon max/i)).toBeInTheDocument();
  });

  it('calls createGame with selected scale on submit', async () => {
    const user = userEvent.setup();
    api.createGame.mockResolvedValue(GAME);
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.selectOptions(screen.getByLabelText(/scale/i), 'large');
    await user.click(screen.getByRole('button', { name: /create game/i }));

    await waitFor(() => expect(api.createGame).toHaveBeenCalledWith(
      expect.objectContaining({ size: 'large' })
    ));
  });

  it('calls onGameReady with game data after create', async () => {
    const user = userEvent.setup();
    const onGameReady = vi.fn();
    api.createGame.mockResolvedValue(GAME);
    render(<GameForm player={PLAYER} onGameReady={onGameReady} />);

    await user.click(screen.getByRole('button', { name: /create game/i }));
    await waitFor(() => expect(onGameReady).toHaveBeenCalledWith(GAME));
  });

  it('shows error when createGame rejects', async () => {
    const user = userEvent.setup();
    api.createGame.mockRejectedValue(new Error('create failed'));
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.click(screen.getByRole('button', { name: /create game/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/create failed/i));
  });

  it('shows game ID input on join tab', async () => {
    const user = userEvent.setup();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);
    await user.click(screen.getByRole('tab', { name: /join game/i }));
    expect(screen.getByLabelText(/game id/i)).toBeInTheDocument();
  });

  it('shows error when joining with empty game ID', async () => {
    const user = userEvent.setup();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);
    await user.click(screen.getByRole('tab', { name: /join game/i }));
    await user.click(screen.getByRole('button', { name: /join game/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/game id is required/i);
  });

  it('calls lookupGame and onGameReady when joining', async () => {
    const user = userEvent.setup();
    const onGameReady = vi.fn();
    api.lookupGame.mockResolvedValue(GAME);
    render(<GameForm player={PLAYER} onGameReady={onGameReady} />);

    await user.click(screen.getByRole('tab', { name: /join game/i }));
    await user.type(screen.getByLabelText(/game id/i), 'g1');
    await user.click(screen.getByRole('button', { name: /join game/i }));

    await waitFor(() => {
      expect(api.lookupGame).toHaveBeenCalledWith('g1');
      expect(onGameReady).toHaveBeenCalledWith(GAME);
    });
  });

  it('shows error when lookupGame rejects', async () => {
    const user = userEvent.setup();
    api.lookupGame.mockRejectedValue(new Error('game not found'));
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.click(screen.getByRole('tab', { name: /join game/i }));
    await user.type(screen.getByLabelText(/game id/i), 'bad-id');
    await user.click(screen.getByRole('button', { name: /join game/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/game not found/i));
  });

  it('calls joinGame with correct args after createGame resolves', async () => {
    const user = userEvent.setup();
    api.createGame.mockResolvedValue(GAME);
    api.joinGame.mockResolvedValue({ gameId: GAME.gameId, playerId: PLAYER.playerId, role: PLAYER.role, team: null });
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.click(screen.getByRole('button', { name: /create game/i }));

    await waitFor(() => expect(api.joinGame).toHaveBeenCalledWith({
      gameId: GAME.gameId,
      playerId: PLAYER.playerId,
      role: PLAYER.role,
    }));
  });

  it('calls joinGame with correct args after lookupGame resolves', async () => {
    const user = userEvent.setup();
    api.lookupGame.mockResolvedValue(GAME);
    api.joinGame.mockResolvedValue({ gameId: GAME.gameId, playerId: PLAYER.playerId, role: PLAYER.role, team: null });
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.click(screen.getByRole('tab', { name: /join game/i }));
    await user.type(screen.getByLabelText(/game id/i), 'g1');
    await user.click(screen.getByRole('button', { name: /join game/i }));

    await waitFor(() => expect(api.joinGame).toHaveBeenCalledWith({
      gameId: GAME.gameId,
      playerId: PLAYER.playerId,
      role: PLAYER.role,
    }));
  });

  it('shows error and does not call onGameReady when joinGame rejects after create', async () => {
    const user = userEvent.setup();
    const onGameReady = vi.fn();
    api.createGame.mockResolvedValue(GAME);
    api.joinGame.mockRejectedValue(new Error('join failed'));
    render(<GameForm player={PLAYER} onGameReady={onGameReady} />);

    await user.click(screen.getByRole('button', { name: /create game/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/join failed/i));
    expect(onGameReady).not.toHaveBeenCalled();
  });

  it('shows error and does not call onGameReady when joinGame rejects after join lookup', async () => {
    const user = userEvent.setup();
    const onGameReady = vi.fn();
    api.lookupGame.mockResolvedValue(GAME);
    api.joinGame.mockRejectedValue(new Error('server unavailable'));
    render(<GameForm player={PLAYER} onGameReady={onGameReady} />);

    await user.click(screen.getByRole('tab', { name: /join game/i }));
    await user.type(screen.getByLabelText(/game id/i), 'g1');
    await user.click(screen.getByRole('button', { name: /join game/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/server unavailable/i));
    expect(onGameReady).not.toHaveBeenCalled();
  });

  it('opens join tab when initialTab="join" is provided', () => {
    render(<GameForm player={PLAYER} onGameReady={() => {}} initialTab="join" />);
    expect(screen.getByRole('tab', { name: /join game/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/game id/i)).toBeInTheDocument();
  });

  it('pre-fills gameId input when initialGameId is provided', () => {
    render(<GameForm player={PLAYER} onGameReady={() => {}} initialTab="join" initialGameId="abc123" />);
    expect(screen.getByLabelText(/game id/i)).toHaveValue('abc123');
  });
});

// ---------------------------------------------------------------------------
// GameForm — preview map (Task 143)
// ---------------------------------------------------------------------------

describe('GameForm preview map', () => {
  // Shared helper: type a search query, wait for the 500 ms debounce to fire
  // (real timers), then click the first location result in the dropdown.
  async function selectLondon(user) {
    await user.type(screen.getByLabelText(/search for a city/i), 'London');
    const listbox = await screen.findByRole('listbox', { name: /location results/i }, { timeout: 2000 });
    await act(async () => {
      within(listbox).getAllByRole('option')[0].click();
    });
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { lat: '51.5074', lon: '-0.1278', display_name: 'London, England, United Kingdom' },
      ],
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  // (a) Map container absent before location is selected.
  it('preview map is not rendered before a location is selected', () => {
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);
    expect(screen.queryByTestId('preview-map')).not.toBeInTheDocument();
  });

  // (b) Map container present after a geocoding result is selected.
  it('preview map appears after selecting a geocoding result', async () => {
    const user = userEvent.setup({ delay: null });
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await selectLondon(user);

    expect(screen.getByTestId('preview-map')).toBeInTheDocument();
  });

  // (c) Dragging the centre marker updates the bounds fields.
  it('dragging the centre marker updates the bounds fields', async () => {
    const user = userEvent.setup({ delay: null });
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await selectLondon(user);

    // Bounds should be populated from the geocoding result.
    await waitFor(() => expect(screen.getByLabelText(/lat min/i)).not.toHaveValue(''));

    // Simulate dragend on the centre marker with a new LatLng.
    expect(leafletMapMocks.centerMarkerDragend).not.toBeNull();
    await act(async () => {
      leafletMapMocks.centerMarkerDragend({
        target: { getLatLng: () => ({ lat: 52.0, lng: 1.0 }) },
      });
    });

    // Bounds should update to reflect the new centre (52.0, 1.0) at medium radius 15 km.
    await waitFor(() => {
      const latMin = parseFloat(screen.getByLabelText(/lat min/i).value);
      expect(latMin).toBeCloseTo(52.0 - 15 / 111, 2);
    });
  });
});

// ---------------------------------------------------------------------------
// GameForm — resize handle (Task 144)
// ---------------------------------------------------------------------------

describe('GameForm resize handle', () => {
  async function selectLondon(user) {
    await user.type(screen.getByLabelText(/search for a city/i), 'London');
    const listbox = await screen.findByRole('listbox', { name: /location results/i }, { timeout: 2000 });
    await act(async () => {
      within(listbox).getAllByRole('option')[0].click();
    });
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { lat: '51.5074', lon: '-0.1278', display_name: 'London, England, United Kingdom' },
      ],
    });
    leafletMapMocks.resizeHandlerDrag = null;
    leafletMapMocks.resizeHandlerDragend = null;
  });

  afterEach(() => {
    delete global.fetch;
  });

  // (d) Resize handle marker present after location selected.
  it('resize handle marker is present after a location is selected', async () => {
    const user = userEvent.setup({ delay: null });
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await selectLondon(user);

    // The mock captures the drag handler from the resize handle Marker.
    await waitFor(() => expect(leafletMapMocks.resizeHandlerDrag).not.toBeNull());
  });

  // (e) Dragging the resize handle updates the "Zone radius:" display.
  it('drag event on resize handle updates the Zone radius output', async () => {
    const user = userEvent.setup({ delay: null });
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await selectLondon(user);
    await waitFor(() => expect(leafletMapMocks.resizeHandlerDrag).not.toBeNull());

    // Simulate dragging to a point ~30 km east of centre.
    // London centre ≈ 51.5074, -0.1278; 30 km east at that lat ≈ lon + 0.43°
    await act(async () => {
      leafletMapMocks.resizeHandlerDrag({
        target: { getLatLng: () => ({ lat: 51.5074, lng: 0.3 }) },
      });
    });

    // Output should now show a radius that differs from the default 15 km.
    await waitFor(() => {
      const output = screen.getByLabelText(/zone radius/i);
      // The displayed value must not be '15.0 km' any more.
      expect(output.textContent).toMatch(/Zone radius:/);
      expect(output.textContent).not.toBe('Zone radius: 15.0 km');
    });
  });

  // (f) Dragend on resize handle updates the bounds fields.
  it('dragend on resize handle updates the bounds fields', async () => {
    const user = userEvent.setup({ delay: null });
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await selectLondon(user);
    await waitFor(() => expect(leafletMapMocks.resizeHandlerDragend).not.toBeNull());

    // Record the original lat_min value.
    const originalLatMin = parseFloat(screen.getByLabelText(/lat min/i).value);

    // Simulate dragend to a point much further east — this makes radiusKm larger,
    // which widens the bounding box (lat_min decreases).
    await act(async () => {
      leafletMapMocks.resizeHandlerDragend({
        target: { getLatLng: () => ({ lat: 51.5074, lng: 1.0 }) },
      });
    });

    await waitFor(() => {
      const newLatMin = parseFloat(screen.getByLabelText(/lat min/i).value);
      expect(newLatMin).toBeLessThan(originalLatMin);
    });
  });
});

// ---------------------------------------------------------------------------
// WaitingRoom
// ---------------------------------------------------------------------------

describe('WaitingRoom', () => {
  it('displays the game ID', () => {
    render(<WaitingRoom game={GAME} />);
    expect(screen.getByText('g1')).toBeInTheDocument();
  });

  it('displays the scale', () => {
    render(<WaitingRoom game={GAME} />);
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
  });

  it('displays the status', () => {
    render(<WaitingRoom game={GAME} />);
    expect(screen.getByText(/Status: waiting/i)).toBeInTheDocument();
  });

  it('shows invite link containing the gameId', () => {
    render(<WaitingRoom game={GAME} />);
    const link = screen.getByRole('link', { name: /invite link/i });
    expect(link).toBeInTheDocument();
    expect(link.href).toContain('gameId=g1');
  });
});

// ---------------------------------------------------------------------------
// Lobby (integration)
// ---------------------------------------------------------------------------

describe('Lobby', () => {
  it('renders the app title and tagline', () => {
    render(<Lobby />);
    expect(screen.getByRole('heading', { name: /JetLag: The Game/i })).toBeInTheDocument();
    expect(screen.getByText(/Hide and seek across transit networks/i)).toBeInTheDocument();
  });

  it('shows the registration form initially', () => {
    render(<Lobby />);
    expect(screen.getByRole('form', { name: /player registration/i })).toBeInTheDocument();
  });

  it('shows game lobby after registration', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    render(<Lobby />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /create game/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole('form', { name: /player registration/i })).not.toBeInTheDocument();
  });

  it('shows waiting room after creating a game', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    api.createGame.mockResolvedValue(GAME);
    render(<Lobby />);

    // Register
    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => screen.getByRole('tab', { name: /create game/i }));

    // Create
    await user.click(screen.getByRole('button', { name: /create game/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /waiting room/i })).toBeInTheDocument()
    );
    expect(screen.getByText('g1')).toBeInTheDocument();
  });

  it('shows waiting room after joining a game', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    api.lookupGame.mockResolvedValue(GAME);
    render(<Lobby />);

    // Register
    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => screen.getByRole('tab', { name: /join game/i }));

    // Switch to Join tab
    await user.click(screen.getByRole('tab', { name: /join game/i }));
    await user.type(screen.getByLabelText(/game id/i), 'g1');
    await user.click(screen.getByRole('button', { name: /join game/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /waiting room/i })).toBeInTheDocument()
    );
  });

  it('activates join tab and pre-fills gameId when ?gameId is in URL', async () => {
    vi.stubGlobal('location', { ...window.location, search: '?gameId=invite99' });
    api.registerPlayer.mockResolvedValue(PLAYER);
    render(<Lobby />);

    // Register player so GameForm renders
    await userEvent.setup().type(screen.getByLabelText(/name/i), 'Alice');
    await userEvent.setup().click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => screen.getByRole('tab', { name: /join game/i }));

    // Join tab should be active and game ID pre-filled
    expect(screen.getByRole('tab', { name: /join game/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/game id/i)).toHaveValue('invite99');

    vi.unstubAllGlobals();
  });

  it('shows Start Game button when the current player is the host', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    // GAME.hostPlayerId === PLAYER.playerId
    api.createGame.mockResolvedValue(GAME);
    render(<Lobby />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => screen.getByRole('tab', { name: /create game/i }));

    await user.click(screen.getByRole('button', { name: /create game/i }));
    await waitFor(() => screen.getByRole('heading', { name: /waiting room/i }));

    expect(screen.getByRole('button', { name: /start game/i })).toBeInTheDocument();
  });

  it('hides Start Game button when the current player joined but is not the host', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    // different hostPlayerId — current player is not the host
    api.lookupGame.mockResolvedValue({ ...GAME, hostPlayerId: 'other-player' });
    render(<Lobby />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => screen.getByRole('tab', { name: /join game/i }));

    await user.click(screen.getByRole('tab', { name: /join game/i }));
    await user.type(screen.getByLabelText(/game id/i), 'g1');
    await user.click(screen.getByRole('button', { name: /join game/i }));

    await waitFor(() => screen.getByRole('heading', { name: /waiting room/i }));

    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument();
  });

  it('non-host player transitions away from WaitingRoom when game starts', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    const nonHostGame = { ...GAME, hostPlayerId: 'other-player' };
    // First lookupGame call: join validation. Subsequent calls: game has started.
    api.lookupGame
      .mockResolvedValueOnce(nonHostGame)
      .mockResolvedValue({ ...nonHostGame, status: 'hiding' });

    render(<Lobby />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => screen.getByRole('tab', { name: /join game/i }));

    await user.click(screen.getByRole('tab', { name: /join game/i }));
    await user.type(screen.getByLabelText(/game id/i), 'g1');
    await user.click(screen.getByRole('button', { name: /join game/i }));
    await waitFor(() => screen.getByRole('heading', { name: /waiting room/i }));

    // WaitingRoom polls every 3 s; allow it to fire naturally and detect the
    // transition.  The 4 s timeout is generous relative to POLL_INTERVAL_MS.
    await waitFor(
      () => expect(screen.queryByRole('heading', { name: /waiting room/i })).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
  }, 10000);
});

// ---------------------------------------------------------------------------
// Lobby — SERVER_URL forwarded to GameMap (Task 153)
// ---------------------------------------------------------------------------

describe('Lobby server URL', () => {
  it('passes ENV.wsUrl as serverUrl prop to GameMap', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    api.createGame.mockResolvedValue(GAME); // GAME.hostPlayerId === PLAYER.playerId
    api.startGame.mockResolvedValue();

    render(<Lobby />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => screen.getByRole('tab', { name: /create game/i }));

    await user.click(screen.getByRole('button', { name: /create game/i }));
    await waitFor(() => screen.getByRole('heading', { name: /waiting room/i }));

    await user.click(screen.getByRole('button', { name: /start game/i }));
    await waitFor(() => expect(GameMap).toHaveBeenCalled());

    const props = GameMap.mock.calls[0][0];
    expect(props.serverUrl).toBe(ENV.wsUrl);
  });
});

// ---------------------------------------------------------------------------
// Lobby — Admin Dashboard feature flag (tests j, k, l)
// ---------------------------------------------------------------------------

describe('Lobby admin dashboard', () => {
  // (j) Admin button absent when ENV.features.adminDashboard is false
  it('Admin button absent when adminDashboard flag is false', () => {
    ENV.features.adminDashboard = false;
    render(<Lobby />);
    expect(screen.queryByRole('button', { name: /^admin$/i })).not.toBeInTheDocument();
  });

  // (k) Admin button present when ENV.features.adminDashboard is true
  it('Admin button present when adminDashboard flag is true', () => {
    ENV.features.adminDashboard = true;
    render(<Lobby />);
    expect(screen.getByRole('button', { name: /^admin$/i })).toBeInTheDocument();
  });

  // (l) clicking Admin button shows AdminDashboard
  it('clicking Admin button renders AdminDashboard', async () => {
    const user = userEvent.setup();
    ENV.features.adminDashboard = true;
    render(<Lobby />);

    await user.click(screen.getByRole('button', { name: /^admin$/i }));

    // AdminDashboard is lazy-loaded; findBy* waits for the Suspense boundary to resolve
    const keyInput = await screen.findByLabelText(/admin api key/i);
    expect(keyInput).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Lobby — Player identity persistence (Task 158)
// ---------------------------------------------------------------------------

describe('Lobby player identity persistence', () => {
  // (a) Valid saved player — PlayerForm is NOT rendered; GameForm IS rendered
  it('skips PlayerForm when valid player is in localStorage', () => {
    localStorage.setItem('jetlag_player', JSON.stringify(PLAYER));
    render(<Lobby />);
    // PlayerForm registration heading must be absent
    expect(screen.queryByRole('heading', { name: /register/i })).not.toBeInTheDocument();
    // GameForm should be shown (Create / Join tabs)
    expect(screen.getByRole('tab', { name: /create/i })).toBeInTheDocument();
  });

  // (b) Restoring from localStorage does not call registerPlayer
  it('restores player identity without calling registerPlayer API', () => {
    localStorage.setItem('jetlag_player', JSON.stringify(PLAYER));
    render(<Lobby />);
    expect(api.registerPlayer).not.toHaveBeenCalled();
  });

  // (c) Invalid JSON in localStorage falls back to PlayerForm
  it('shows PlayerForm when localStorage contains invalid JSON', () => {
    localStorage.setItem('jetlag_player', 'not-valid-json{{{');
    render(<Lobby />);
    expect(screen.getByRole('heading', { name: /register/i })).toBeInTheDocument();
  });

  // (d) Object with missing required fields falls back to PlayerForm
  it('shows PlayerForm when localStorage entry is missing required fields', () => {
    localStorage.setItem('jetlag_player', JSON.stringify({ playerId: 'p1' }));
    render(<Lobby />);
    expect(screen.getByRole('heading', { name: /register/i })).toBeInTheDocument();
  });

  // (e) After onRegistered fires, localStorage contains the player JSON
  it('persists player to localStorage after successful registration', async () => {
    const user = userEvent.setup();
    api.registerPlayer.mockResolvedValue(PLAYER);
    render(<Lobby />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('jetlag_player'));
      expect(stored).toMatchObject({ playerId: 'p1', name: 'Alice', role: 'seeker' });
    });
  });

  // (f) "Not {name}?" button is visible when player is set and not playing
  it('shows "Not {name}?" button when player is set and not playing', () => {
    localStorage.setItem('jetlag_player', JSON.stringify(PLAYER));
    render(<Lobby />);
    expect(screen.getByRole('button', { name: /change player identity/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change player identity/i }).textContent).toContain('Alice');
  });

  // (g) Clicking "Not {name}?" clears localStorage and shows PlayerForm
  it('clicking "Not {name}?" clears storage and shows PlayerForm', async () => {
    const user = userEvent.setup();
    localStorage.setItem('jetlag_player', JSON.stringify(PLAYER));
    render(<Lobby />);

    await user.click(screen.getByRole('button', { name: /change player identity/i }));

    expect(localStorage.getItem('jetlag_player')).toBeNull();
    expect(screen.getByRole('heading', { name: /register/i })).toBeInTheDocument();
  });

  // (h) "Not {name}?" button is NOT shown during active gameplay
  it('does not show "Not {name}?" button during active gameplay', async () => {
    const user = userEvent.setup();
    // Restore player from localStorage — skip registration
    localStorage.setItem('jetlag_player', JSON.stringify(PLAYER));
    api.createGame.mockResolvedValue(GAME);
    api.startGame.mockResolvedValue();
    render(<Lobby />);

    // GameForm is shown immediately (player restored); create a game
    await user.click(screen.getByRole('button', { name: /create game/i }));
    await waitFor(() => screen.getByRole('heading', { name: /waiting room/i }));

    // Start game (host path)
    await user.click(screen.getByRole('button', { name: /start game/i }));
    // Wait for GameMap to render (playing === true)
    await waitFor(() => expect(GameMap).toHaveBeenCalled());

    // "Not {name}?" must be absent during gameplay
    expect(screen.queryByRole('button', { name: /change player identity/i })).not.toBeInTheDocument();
  });
});
