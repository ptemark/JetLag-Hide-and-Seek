// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

vi.mock('../api.js', () => ({
  registerPlayer: vi.fn(),
  createGame:     vi.fn(),
  lookupGame:     vi.fn(),
  submitQuestion: vi.fn(),
  listQuestions:  vi.fn(),
  submitAnswer:   vi.fn(),
  fetchCards:     vi.fn(),
  playCardApi:    vi.fn(),
}));

import * as api from '../api.js';
import CardPanel from './CardPanel.jsx';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HIDER = { playerId: 'p2', name: 'Bob', role: 'hider' };
const GAME  = { gameId: 'g1', size: 'medium', status: 'hiding' };

const CARD_TIME = {
  cardId:   'c1',
  gameId:   'g1',
  playerId: 'p2',
  type:     'time_bonus',
  effect:   { minutesAdded: 10 },
  status:   'in_hand',
  drawnAt:  '2026-01-01T00:00:00Z',
};

const CARD_POWERUP = {
  cardId:   'c2',
  gameId:   'g1',
  playerId: 'p2',
  type:     'powerup',
  effect:   { action: 'false_zone' },
  status:   'in_hand',
  drawnAt:  '2026-01-01T00:01:00Z',
};

const CARD_CURSE = {
  cardId:   'c3',
  gameId:   'g1',
  playerId: 'p2',
  type:     'curse',
  effect:   { action: 'block_questions', durationMs: 120000 },
  status:   'in_hand',
  drawnAt:  '2026-01-01T00:02:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [] });
});

// ── CardPanel ─────────────────────────────────────────────────────────────────

describe('CardPanel', () => {
  it('renders section heading with card count', async () => {
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_TIME] });
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() => expect(screen.getByText(/your cards/i)).toBeInTheDocument());
    expect(screen.getByText(/1\/6/)).toBeInTheDocument();
  });

  it('shows "No cards in hand" when hand is empty', async () => {
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() => expect(screen.getByText(/no cards in hand/i)).toBeInTheDocument());
  });

  it('fetches cards with correct gameId and playerId on mount', async () => {
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(api.fetchCards).toHaveBeenCalledWith({ gameId: 'g1', playerId: 'p2' })
    );
  });

  it('renders a play button for each card in hand', async () => {
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_TIME, CARD_POWERUP, CARD_CURSE] });
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(3));
  });

  it('renders Time Bonus card with label and description', async () => {
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_TIME] });
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /play time bonus/i })).toBeInTheDocument());
    expect(screen.getByText(/\+10 min/i)).toBeInTheDocument();
  });

  it('renders Power-Up card with label and description', async () => {
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_POWERUP] });
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /play power-up/i })).toBeInTheDocument());
    expect(screen.getByText(/false zone/i)).toBeInTheDocument();
  });

  it('renders Curse card with label and description', async () => {
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_CURSE] });
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /play curse/i })).toBeInTheDocument());
    expect(screen.getByText(/block seeker questions/i)).toBeInTheDocument();
  });

  it('calls playCardApi with correct arguments on button click', async () => {
    const user = userEvent.setup();
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_TIME] });
    api.playCardApi.mockResolvedValue({ ...CARD_TIME, status: 'played', playedAt: '2026-01-01T01:00:00Z' });
    render(<CardPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByRole('button', { name: /play time bonus/i }));
    await user.click(screen.getByRole('button', { name: /play time bonus/i }));

    await waitFor(() =>
      expect(api.playCardApi).toHaveBeenCalledWith({ cardId: 'c1', playerId: 'p2' })
    );
  });

  it('removes played card from the hand display', async () => {
    const user = userEvent.setup();
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_TIME] });
    api.playCardApi.mockResolvedValue({ ...CARD_TIME, status: 'played' });
    render(<CardPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByRole('button', { name: /play time bonus/i }));
    await user.click(screen.getByRole('button', { name: /play time bonus/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /play time bonus/i })).not.toBeInTheDocument()
    );
  });

  it('shows confirmation message after playing a card', async () => {
    const user = userEvent.setup();
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_TIME] });
    api.playCardApi.mockResolvedValue({ ...CARD_TIME, status: 'played' });
    render(<CardPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByRole('button', { name: /play time bonus/i }));
    await user.click(screen.getByRole('button', { name: /play time bonus/i }));

    await waitFor(() =>
      expect(screen.getByRole('status', { name: /card played/i })).toBeInTheDocument()
    );
    expect(screen.getByText(/time bonus/i)).toBeInTheDocument();
  });

  it('shows load error when fetchCards rejects', async () => {
    api.fetchCards.mockRejectedValue(new Error('load failed'));
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/load failed/i)
    );
  });

  it('shows play error when playCardApi rejects', async () => {
    const user = userEvent.setup();
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_TIME] });
    api.playCardApi.mockRejectedValue(new Error('play failed'));
    render(<CardPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByRole('button', { name: /play time bonus/i }));
    await user.click(screen.getByRole('button', { name: /play time bonus/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/play failed/i)
    );
  });

  it('re-fetches hand when refreshTrigger changes', async () => {
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [] });
    const { rerender } = render(<CardPanel player={HIDER} game={GAME} refreshTrigger={0} />);
    await waitFor(() => expect(api.fetchCards).toHaveBeenCalledTimes(1));

    rerender(<CardPanel player={HIDER} game={GAME} refreshTrigger={1} />);
    await waitFor(() => expect(api.fetchCards).toHaveBeenCalledTimes(2));
  });

  it('shows card count 0/6 when hand is empty', async () => {
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() => expect(screen.getByText(/0\/6/)).toBeInTheDocument());
  });

  it('shows all three card types when hand has one of each', async () => {
    api.fetchCards.mockResolvedValue({ gameId: 'g1', playerId: 'p2', hand: [CARD_TIME, CARD_POWERUP, CARD_CURSE] });
    render(<CardPanel player={HIDER} game={GAME} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play time bonus/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /play power-up/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /play curse/i })).toBeInTheDocument();
    });
  });
});
