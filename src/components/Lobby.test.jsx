import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock API module before importing components that use it.
vi.mock('../api.js', () => ({
  registerPlayer: vi.fn(),
  createGame: vi.fn(),
  lookupGame: vi.fn(),
  startGame: vi.fn(),
}));

import * as api from '../api.js';
import PlayerForm from './PlayerForm.jsx';
import GameForm from './GameForm.jsx';
import WaitingRoom from './WaitingRoom.jsx';
import Lobby from './Lobby.jsx';

const PLAYER = { playerId: 'p1', name: 'Alice', role: 'seeker', createdAt: '2026-01-01T00:00:00Z' };
const GAME   = { gameId: 'g1', size: 'medium', status: 'waiting' };

beforeEach(() => {
  vi.clearAllMocks();
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
});
