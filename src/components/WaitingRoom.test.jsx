import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the API module before importing the component.
vi.mock('../api.js', () => ({
  startGame: vi.fn(),
  lookupGame: vi.fn(),
}));

import * as api from '../api.js';
import WaitingRoom from './WaitingRoom.jsx';

const GAME   = { gameId: 'g1', size: 'medium', status: 'waiting', seekerTeams: 0 };
const PLAYER = { playerId: 'p1', name: 'Alice', role: 'seeker' };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

describe('WaitingRoom display', () => {
  it('renders the heading', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.getByRole('heading', { name: /waiting room/i })).toBeInTheDocument();
  });

  it('shows the game ID', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.getByText('g1')).toBeInTheDocument();
  });

  it('shows the scale', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
  });

  it('shows an invite link containing the gameId', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    const link = screen.getByRole('link', { name: /invite link/i });
    expect(link.href).toContain('gameId=g1');
  });

  it('hides the Start Game button when onStart is not provided', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument();
  });

  it('shows the Start Game button when onStart is provided', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);
    expect(screen.getByRole('button', { name: /start game/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Team display
// ---------------------------------------------------------------------------

describe('WaitingRoom team display', () => {
  it('shows team assignment for seeker when two-teams mode is on', () => {
    const player = { ...PLAYER, role: 'seeker', team: 'A' };
    const game = { ...GAME, seekerTeams: 2 };
    render(<WaitingRoom game={game} player={player} />);
    expect(screen.getByLabelText(/team assignment/i)).toHaveTextContent(/Team A/i);
  });

  it('does not show team assignment when seekerTeams is 0', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.queryByLabelText(/team assignment/i)).not.toBeInTheDocument();
  });

  it('does not show team assignment for hider even in two-teams mode', () => {
    const player = { ...PLAYER, role: 'hider', team: 'A' };
    const game = { ...GAME, seekerTeams: 2 };
    render(<WaitingRoom game={game} player={player} />);
    expect(screen.queryByLabelText(/team assignment/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Start Game button — calls POST /api/games/:gameId/start via api.startGame
// ---------------------------------------------------------------------------

describe('WaitingRoom Start Game button', () => {
  it('calls startGame with the correct gameId, scale, and default hidingDurationMin', async () => {
    const user = userEvent.setup();
    api.startGame.mockResolvedValue(undefined);
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() =>
      expect(api.startGame).toHaveBeenCalledWith({ gameId: 'g1', scale: 'medium', hidingDurationMin: 60 })
    );
  });

  it('calls the onStart callback after a successful startGame', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    api.startGame.mockResolvedValue(undefined);
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={onStart} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());
  });

  it('passes scale=small and default min for small game', async () => {
    const user = userEvent.setup();
    api.startGame.mockResolvedValue(undefined);
    const smallGame = { ...GAME, size: 'small' };
    render(<WaitingRoom game={smallGame} player={PLAYER} onStart={() => {}} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() =>
      expect(api.startGame).toHaveBeenCalledWith({ gameId: 'g1', scale: 'small', hidingDurationMin: 30 })
    );
  });

  it('shows an error message when startGame rejects', async () => {
    const user = userEvent.setup();
    api.startGame.mockRejectedValue(new Error('server unreachable'));
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/server unreachable/i)
    );
  });

  it('does not call onStart when startGame rejects', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    api.startGame.mockRejectedValue(new Error('network error'));
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={onStart} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onStart).not.toHaveBeenCalled();
  });

  it('clears any previous error on a new start attempt', async () => {
    const user = userEvent.setup();
    api.startGame
      .mockRejectedValueOnce(new Error('first error'))
      .mockResolvedValue(undefined);
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /start game/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Duration picker (Task 74)
// ---------------------------------------------------------------------------

describe('WaitingRoom duration picker', () => {
  it('renders duration input when onStart is provided', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);
    expect(screen.getByLabelText(/hiding duration/i)).toBeInTheDocument();
  });

  it('does not render duration input when onStart is not provided', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.queryByLabelText(/hiding duration/i)).not.toBeInTheDocument();
  });

  it('input min/max reflect the medium scale range (60–180)', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);
    const input = screen.getByLabelText(/hiding duration/i);
    expect(Number(input.min)).toBe(60);
    expect(Number(input.max)).toBe(180);
  });

  it('input min/max reflect the small scale range (30–60)', () => {
    const smallGame = { ...GAME, size: 'small' };
    render(<WaitingRoom game={smallGame} player={PLAYER} onStart={() => {}} />);
    const input = screen.getByLabelText(/hiding duration/i);
    expect(Number(input.min)).toBe(30);
    expect(Number(input.max)).toBe(60);
  });

  it('passes the user-selected hidingDurationMin to startGame', async () => {
    const user = userEvent.setup();
    api.startGame.mockResolvedValue(undefined);
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    const input = screen.getByLabelText(/hiding duration/i);
    await user.clear(input);
    await user.type(input, '90');

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() =>
      expect(api.startGame).toHaveBeenCalledWith({ gameId: 'g1', scale: 'medium', hidingDurationMin: 90 })
    );
  });
});

// ---------------------------------------------------------------------------
// Non-host polling (Task 103)
// ---------------------------------------------------------------------------

describe('WaitingRoom non-host polling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts polling when onStart is absent and onGameStarted is provided', () => {
    vi.spyOn(global, 'setInterval').mockReturnValue(1);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});

    render(<WaitingRoom game={GAME} player={PLAYER} onGameStarted={() => {}} />);

    expect(global.setInterval).toHaveBeenCalled();
  });

  it('fires onGameStarted when lookupGame returns status !== waiting', async () => {
    let capturedCallback;
    vi.spyOn(global, 'setInterval').mockImplementation((fn) => { capturedCallback = fn; return 1; });
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    api.lookupGame.mockResolvedValue({ ...GAME, status: 'hiding' });
    const onGameStarted = vi.fn();

    render(<WaitingRoom game={GAME} player={PLAYER} onGameStarted={onGameStarted} />);

    await capturedCallback();

    expect(onGameStarted).toHaveBeenCalledOnce();
  });

  it('does not start polling when onStart is provided (host path)', () => {
    vi.spyOn(global, 'setInterval');

    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} onGameStarted={() => {}} />);

    expect(global.setInterval).not.toHaveBeenCalled();
  });

  it('clears the interval on unmount', () => {
    const intervalId = 42;
    vi.spyOn(global, 'setInterval').mockReturnValue(intervalId);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});

    const { unmount } = render(<WaitingRoom game={GAME} player={PLAYER} onGameStarted={() => {}} />);

    unmount();

    expect(global.clearInterval).toHaveBeenCalledWith(intervalId);
  });

  it('calls onGameStarted after startGame resolves on the host path', async () => {
    const user = userEvent.setup();
    api.startGame.mockResolvedValue(undefined);
    const onStart = vi.fn();
    const onGameStarted = vi.fn();

    render(<WaitingRoom game={GAME} player={PLAYER} onStart={onStart} onGameStarted={onGameStarted} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() => {
      expect(onStart).toHaveBeenCalledOnce();
      expect(onGameStarted).toHaveBeenCalledOnce();
    });
  });
});
