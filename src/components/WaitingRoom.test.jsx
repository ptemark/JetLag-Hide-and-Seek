import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the API module before importing the component.
vi.mock('../api.js', () => ({
  startGame:        vi.fn(),
  lookupGame:       vi.fn(),
  markPlayerReady:  vi.fn(),
  fetchReadyStatus: vi.fn(),
}));

import * as api from '../api.js';
import WaitingRoom from './WaitingRoom.jsx';

const GAME   = { gameId: 'g1', size: 'medium', status: 'waiting', seekerTeams: 0 };
const PLAYER = { playerId: 'p1', name: 'Alice', role: 'seeker' };

const STARTABLE_PLAYERS = [
  { playerId: 'p1', name: 'Alice', role: 'hider' },
  { playerId: 'p2', name: 'Bob', role: 'seeker' },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Default stubs — prevent unhandled rejections from the immediate-on-mount
  // poll (Task 200) and the background interval.
  api.fetchReadyStatus.mockResolvedValue({ readyCount: 0, totalCount: 0 });
  api.markPlayerReady.mockResolvedValue({ readyCount: 1, totalCount: 1 });
  api.lookupGame.mockResolvedValue({
    gameId: 'g1', status: 'waiting', players: [], hostPlayerId: 'p1',
  });
});

/**
 * Render WaitingRoom with the polling interval intercepted, then fire one
 * tick so the players state is populated. Used by tests that need to click
 * the Start Game button, which is disabled until at least one hider and
 * one seeker are present (Task 194).
 */
async function renderAndPopulate(jsx, players = STARTABLE_PLAYERS) {
  let captured;
  vi.spyOn(global, 'setInterval').mockImplementation((fn) => { captured = fn; return 1; });
  vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
  api.lookupGame.mockResolvedValue({
    gameId: 'g1', status: 'waiting', players, hostPlayerId: 'p1',
  });
  const result = render(jsx);
  if (captured) await captured();
  return result;
}

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls startGame with the correct gameId, scale, and default hidingDurationMin', async () => {
    const user = userEvent.setup();
    api.startGame.mockResolvedValue(undefined);
    await renderAndPopulate(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() =>
      expect(api.startGame).toHaveBeenCalledWith({ gameId: 'g1', scale: 'medium', hidingDurationMin: 60 })
    );
  });

  it('calls the onStart callback after a successful startGame', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    api.startGame.mockResolvedValue(undefined);
    await renderAndPopulate(<WaitingRoom game={GAME} player={PLAYER} onStart={onStart} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());
  });

  it('passes scale=small and default min for small game', async () => {
    const user = userEvent.setup();
    api.startGame.mockResolvedValue(undefined);
    const smallGame = { ...GAME, size: 'small' };
    await renderAndPopulate(<WaitingRoom game={smallGame} player={PLAYER} onStart={() => {}} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() =>
      expect(api.startGame).toHaveBeenCalledWith({ gameId: 'g1', scale: 'small', hidingDurationMin: 30 })
    );
  });

  it('shows an error message when startGame rejects', async () => {
    const user = userEvent.setup();
    api.startGame.mockRejectedValue(new Error('server unreachable'));
    await renderAndPopulate(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/server unreachable/i)
    );
  });

  it('does not call onStart when startGame rejects', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    api.startGame.mockRejectedValue(new Error('network error'));
    await renderAndPopulate(<WaitingRoom game={GAME} player={PLAYER} onStart={onStart} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onStart).not.toHaveBeenCalled();
  });

  it('clears any previous error on a new start attempt', async () => {
    const user = userEvent.setup();
    api.startGame
      .mockRejectedValueOnce(new Error('first error'))
      .mockResolvedValue(undefined);
    await renderAndPopulate(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

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
    await renderAndPopulate(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    const input = screen.getByLabelText(/hiding duration/i);
    await user.clear(input);
    await user.type(input, '90');

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() =>
      expect(api.startGame).toHaveBeenCalledWith({ gameId: 'g1', scale: 'medium', hidingDurationMin: 90 })
    );

    vi.restoreAllMocks();
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

  it('does not start game-start polling when onStart is provided (host path)', () => {
    vi.spyOn(global, 'setInterval').mockReturnValue(1);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});

    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} onGameStarted={() => {}} />);

    // Host sets up only the ready-status poll (1 call); game-start poll is skipped.
    expect(global.setInterval).toHaveBeenCalledTimes(1);
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

    await renderAndPopulate(
      <WaitingRoom game={GAME} player={PLAYER} onStart={onStart} onGameStarted={onGameStarted} />
    );

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() => {
      expect(onStart).toHaveBeenCalledOnce();
      expect(onGameStarted).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// Copy invite link (Task 147)
// ---------------------------------------------------------------------------

describe('WaitingRoom copy invite link', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a Copy Link button', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.getByRole('button', { name: /copy invite link/i })).toBeInTheDocument();
  });

  it('passes the invite URL (containing gameId) to clipboard.writeText when clicked', async () => {
    // jsdom provides navigator.clipboard — spy on the real implementation.
    const spy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await user.click(screen.getByRole('button', { name: /copy invite link/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledOnce());
    expect(spy.mock.calls[0][0]).toContain('gameId=g1');
  });

  it('changes button label to "Copied!" after a successful copy', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await user.click(screen.getByRole('button', { name: /copy invite link/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /copy invite link/i })).toHaveTextContent('Copied!')
    );
  });

  it('reverts button label to "Copy Link" after CLIPBOARD_RESET_MS', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await user.click(screen.getByRole('button', { name: /copy invite link/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /copy invite link/i })).toHaveTextContent('Copied!')
    );

    vi.advanceTimersByTime(2_000);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /copy invite link/i })).toHaveTextContent('Copy Link')
    );
    vi.useRealTimers();
  });

  it('clears the reset timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<WaitingRoom game={GAME} player={PLAYER} />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Player ready mechanic (Task 154)
// RULES.md §Setup — "All players begin at a common starting point."
// ---------------------------------------------------------------------------

describe('WaitingRoom ready mechanic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an "I\'m Ready" button', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.getByRole('button', { name: /i'm ready/i })).toBeInTheDocument();
  });

  it('shows "(0/0 ready)" count on initial render', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} />);
    expect(screen.getByText(/0\/0 ready/)).toBeInTheDocument();
  });

  it('calls markPlayerReady with ready:true when "I\'m Ready" is clicked', async () => {
    const user = userEvent.setup();
    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await user.click(screen.getByRole('button', { name: /i'm ready/i }));

    await waitFor(() =>
      expect(api.markPlayerReady).toHaveBeenCalledWith({
        gameId: 'g1',
        playerId: 'p1',
        ready: true,
      })
    );
  });

  it('changes button label to "Cancel Ready" after marking ready', async () => {
    const user = userEvent.setup();
    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await user.click(screen.getByRole('button', { name: /i'm ready/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel ready/i })).toBeInTheDocument()
    );
  });

  it('calls markPlayerReady with ready:false when "Cancel Ready" is clicked', async () => {
    const user = userEvent.setup();
    api.markPlayerReady
      .mockResolvedValueOnce({ readyCount: 1, totalCount: 1 })  // first click — mark ready
      .mockResolvedValueOnce({ readyCount: 0, totalCount: 1 }); // second click — cancel
    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await user.click(screen.getByRole('button', { name: /i'm ready/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel ready/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /cancel ready/i }));

    await waitFor(() =>
      expect(api.markPlayerReady).toHaveBeenLastCalledWith({
        gameId: 'g1',
        playerId: 'p1',
        ready: false,
      })
    );
  });

  it('updates the ready count from the markPlayerReady response', async () => {
    const user = userEvent.setup();
    api.markPlayerReady.mockResolvedValue({ readyCount: 2, totalCount: 3 });
    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await user.click(screen.getByRole('button', { name: /i'm ready/i }));

    await waitFor(() =>
      expect(screen.getByText(/2\/3 ready/)).toBeInTheDocument()
    );
  });

  it('surfaces an error alert when markPlayerReady rejects', async () => {
    const user = userEvent.setup();
    api.markPlayerReady.mockRejectedValue(new Error('network error'));
    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await user.click(screen.getByRole('button', { name: /i'm ready/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
    );
  });

  it('clears the ready poll interval on unmount (no leaked timer)', () => {
    const intervalId = 99;
    vi.spyOn(global, 'setInterval').mockReturnValue(intervalId);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});

    const { unmount } = render(<WaitingRoom game={GAME} player={PLAYER} />);
    unmount();

    expect(global.clearInterval).toHaveBeenCalledWith(intervalId);
  });
});

// ---------------------------------------------------------------------------
// Player list (Task 193)
// DESIGN.md §19a "Lobby visibility (player list)"
// ---------------------------------------------------------------------------

describe('WaitingRoom player list', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const TWO_PLAYERS = {
    gameId: 'g1',
    status: 'waiting',
    players: [
      { playerId: 'p1', name: 'Alice', role: 'hider' },
      { playerId: 'p2', name: 'Bob',   role: 'seeker', team: 'A' },
    ],
    hostPlayerId: 'p1',
  };

  it('renders both player names after a poll tick', async () => {
    let capturedCallback;
    vi.spyOn(global, 'setInterval').mockImplementation((fn) => { capturedCallback = fn; return 1; });
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    api.lookupGame.mockResolvedValue(TWO_PLAYERS);

    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await capturedCallback();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('renders role badges for each player', async () => {
    let capturedCallback;
    vi.spyOn(global, 'setInterval').mockImplementation((fn) => { capturedCallback = fn; return 1; });
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    api.lookupGame.mockResolvedValue(TWO_PLAYERS);

    render(<WaitingRoom game={GAME} player={PLAYER} />);
    await capturedCallback();

    await waitFor(() => {
      expect(screen.getByText('hider')).toBeInTheDocument();
      expect(screen.getByText('seeker')).toBeInTheDocument();
    });
  });

  it('shows team label only for the seeker with a team assignment', async () => {
    let capturedCallback;
    vi.spyOn(global, 'setInterval').mockImplementation((fn) => { capturedCallback = fn; return 1; });
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    api.lookupGame.mockResolvedValue(TWO_PLAYERS);

    render(<WaitingRoom game={GAME} player={PLAYER} />);
    await capturedCallback();

    await waitFor(() => {
      expect(screen.getByText(/Team A/)).toBeInTheDocument();
    });
  });

  it('renders the host marker beside the host but not other players', async () => {
    let capturedCallback;
    vi.spyOn(global, 'setInterval').mockImplementation((fn) => { capturedCallback = fn; return 1; });
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    api.lookupGame.mockResolvedValue(TWO_PLAYERS);

    render(<WaitingRoom game={GAME} player={PLAYER} />);
    await capturedCallback();

    const hostMarker = await screen.findByText(/★ host/);
    const aliceItem = screen.getByText('Alice').closest('li');
    const bobItem = screen.getByText('Bob').closest('li');
    expect(aliceItem).toContainElement(hostMarker);
    expect(bobItem).not.toContainElement(hostMarker);
  });

  it('keeps the previously-rendered list when a subsequent lookup rejects', async () => {
    let capturedCallback;
    vi.spyOn(global, 'setInterval').mockImplementation((fn) => { capturedCallback = fn; return 1; });
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    api.lookupGame
      .mockResolvedValueOnce(TWO_PLAYERS)
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(TWO_PLAYERS);

    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await capturedCallback();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    await capturedCallback();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('clears the poll interval on unmount', () => {
    const intervalId = 314;
    vi.spyOn(global, 'setInterval').mockReturnValue(intervalId);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});

    const { unmount } = render(<WaitingRoom game={GAME} player={PLAYER} />);
    unmount();

    expect(global.clearInterval).toHaveBeenCalledWith(intervalId);
  });

  // Task 200: the lobby poll must fire once on mount so the player list is
  // available immediately, instead of waiting POLL_INTERVAL_MS (3 s) for the
  // first tick. Without this, the host's Start Game button stays disabled
  // for 3 s after entering the lobby even when both roles are present.
  it('fetches the player list immediately on mount, not only on interval ticks', async () => {
    api.lookupGame.mockResolvedValue(TWO_PLAYERS);

    render(<WaitingRoom game={GAME} player={PLAYER} />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('enables the Start Game button immediately when both roles are already present (no 3 s wait)', async () => {
    api.lookupGame.mockResolvedValue(TWO_PLAYERS);

    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start game/i })).toBeEnabled();
    });
  });
});

// ---------------------------------------------------------------------------
// Start Game gating (Task 194)
// DESIGN.md §19a "Start-game preconditions"
// ---------------------------------------------------------------------------

describe('WaitingRoom Start Game gating', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables the Start Game button and shows a hint when no players are loaded', () => {
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    const button = screen.getByRole('button', { name: /start game/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(
      /need at least one hider and one seeker to start/i
    );
  });

  it('keeps the button disabled when only hiders are present', async () => {
    await renderAndPopulate(
      <WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />,
      [{ playerId: 'p1', name: 'Alice', role: 'hider' }],
    );

    const button = screen.getByRole('button', { name: /start game/i });
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/need at least one hider and one seeker/i);
  });

  it('keeps the button disabled when only seekers are present', async () => {
    await renderAndPopulate(
      <WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />,
      [{ playerId: 'p2', name: 'Bob', role: 'seeker' }],
    );

    const button = screen.getByRole('button', { name: /start game/i });
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/need at least one hider and one seeker/i);
  });

  it('enables the button and hides the hint when one hider and one seeker are present', async () => {
    await renderAndPopulate(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    const button = screen.getByRole('button', { name: /start game/i });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
    expect(
      screen.queryByText(/need at least one hider and one seeker/i)
    ).not.toBeInTheDocument();
  });

  it('does not call startGame when the disabled button is clicked', async () => {
    const user = userEvent.setup();
    api.startGame.mockResolvedValue(undefined);
    render(<WaitingRoom game={GAME} player={PLAYER} onStart={() => {}} />);

    await user.click(screen.getByRole('button', { name: /start game/i }));

    expect(api.startGame).not.toHaveBeenCalled();
  });
});
