// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

vi.mock('../api.js', () => ({
  fetchLeaderboard: vi.fn(),
}));

import * as api from '../api.js';
import Leaderboard from './Leaderboard.jsx';

const SCORES = [
  { rank: 1, playerName: 'Alice', scale: 'large',  scoreSeconds: 3600, bonusSeconds: 0, createdAt: '2026-01-01T00:00:00Z' },
  { rank: 2, playerName: 'Bob',   scale: 'medium', scoreSeconds: 1800, bonusSeconds: 60, createdAt: '2026-01-02T00:00:00Z' },
  { rank: 3, playerName: 'Carol', scale: 'small',  scoreSeconds: 90,   bonusSeconds: 0, createdAt: '2026-01-03T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Leaderboard', () => {
  it('shows loading text initially', () => {
    api.fetchLeaderboard.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Leaderboard />);
    expect(screen.getByText(/loading leaderboard/i)).toBeInTheDocument();
  });

  it('renders a table with leaderboard label after fetch', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: SCORES });
    render(<Leaderboard />);
    await waitFor(() =>
      expect(screen.getByRole('table', { name: /leaderboard/i })).toBeInTheDocument()
    );
  });

  it('renders column headers: Rank, Player, Scale, Score, Bonus', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: SCORES });
    render(<Leaderboard />);
    await waitFor(() => screen.getByRole('table', { name: /leaderboard/i }));
    expect(screen.getByText('Rank')).toBeInTheDocument();
    expect(screen.getByText('Player')).toBeInTheDocument();
    expect(screen.getByText('Scale')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('Bonus')).toBeInTheDocument();
  });

  it('renders one row per score', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: SCORES });
    render(<Leaderboard />);
    await waitFor(() => screen.getByRole('table', { name: /leaderboard/i }));
    const rows = screen.getAllByRole('row');
    // 1 header row + 3 data rows
    expect(rows).toHaveLength(4);
  });

  it('displays player names', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: SCORES });
    render(<Leaderboard />);
    await waitFor(() => screen.getByText('Alice'));
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('displays scale values', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: SCORES });
    render(<Leaderboard />);
    await waitFor(() => screen.getByText('large'));
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('small')).toBeInTheDocument();
  });

  it('formats total score as MM:SS including bonus', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: SCORES });
    render(<Leaderboard />);
    await waitFor(() => screen.getByText('60:00')); // Alice: 3600+0=3600s → 60:00
    expect(screen.getByText('31:00')).toBeInTheDocument(); // Bob: 1800+60=1860s → 31:00
    expect(screen.getByText('01:30')).toBeInTheDocument(); // Carol: 90+0=90s → 01:30
  });

  it('displays ranks', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: SCORES });
    render(<Leaderboard />);
    await waitFor(() => screen.getByRole('table', { name: /leaderboard/i }));
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows "No scores yet." when scores array is empty', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: [] });
    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByText(/no scores yet/i)).toBeInTheDocument());
  });

  it('shows error message when fetch fails', async () => {
    api.fetchLeaderboard.mockRejectedValue(new Error('network error'));
    render(<Leaderboard />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
    );
  });

  it('renders dash for null scale', async () => {
    const scores = [{ rank: 1, playerName: 'X', scale: null, scoreSeconds: 60, bonusSeconds: 0, createdAt: '' }];
    api.fetchLeaderboard.mockResolvedValue({ scores });
    render(<Leaderboard />);
    await waitFor(() => screen.getByRole('table', { name: /leaderboard/i }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('calls fetchLeaderboard with limit 20 and no gameId by default', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: [] });
    render(<Leaderboard />);
    await waitFor(() => expect(api.fetchLeaderboard).toHaveBeenCalledWith({ limit: 20, gameId: undefined }));
  });

  it('passes gameId prop to fetchLeaderboard', async () => {
    api.fetchLeaderboard.mockResolvedValue({ scores: [] });
    render(<Leaderboard gameId="g42" />);
    await waitFor(() => expect(api.fetchLeaderboard).toHaveBeenCalledWith({ limit: 20, gameId: 'g42' }));
  });

  it('shows only scoreSeconds formatted when bonusSeconds is 0', async () => {
    const scores = [{ rank: 1, playerName: 'X', scale: 'small', scoreSeconds: 300, bonusSeconds: 0, createdAt: '' }];
    api.fetchLeaderboard.mockResolvedValue({ scores });
    render(<Leaderboard />);
    await waitFor(() => screen.getByRole('table', { name: /leaderboard/i }));
    expect(screen.getByText('05:00')).toBeInTheDocument(); // 300s → 05:00
    // Bonus cell is empty — no "+Xm" text
    const bonusCells = screen.getAllByRole('cell');
    const bonusCell = bonusCells[bonusCells.length - 1]; // last cell is the Bonus cell
    expect(bonusCell.textContent).toBe('');
  });

  it('shows total scoreSeconds + bonusSeconds in the score column', async () => {
    const scores = [{ rank: 1, playerName: 'Y', scale: 'medium', scoreSeconds: 600, bonusSeconds: 120, createdAt: '' }];
    api.fetchLeaderboard.mockResolvedValue({ scores });
    render(<Leaderboard />);
    await waitFor(() => screen.getByRole('table', { name: /leaderboard/i }));
    expect(screen.getByText('12:00')).toBeInTheDocument(); // 600+120=720s → 12:00
    expect(screen.getByText('+2m')).toBeInTheDocument();
  });

  it('sorts rows by total score descending regardless of incoming rank', async () => {
    // Incoming rank order: A(rank1), B(rank2), C(rank3) — but total scores are C > A > B
    const scores = [
      { rank: 1, playerName: 'A', scale: 'small',  scoreSeconds: 100, bonusSeconds: 0,   createdAt: '' },
      { rank: 2, playerName: 'B', scale: 'small',  scoreSeconds: 50,  bonusSeconds: 0,   createdAt: '' },
      { rank: 3, playerName: 'C', scale: 'small',  scoreSeconds: 50,  bonusSeconds: 120, createdAt: '' },
    ];
    api.fetchLeaderboard.mockResolvedValue({ scores });
    render(<Leaderboard />);
    await waitFor(() => screen.getByRole('table', { name: /leaderboard/i }));
    const rows = screen.getAllByRole('row');
    // rows[0] = header, rows[1] = rank1, rows[2] = rank2, rows[3] = rank3
    // C has total 170s, A has 100s, B has 50s → order C, A, B
    expect(rows[1].textContent).toContain('C');
    expect(rows[2].textContent).toContain('A');
    expect(rows[3].textContent).toContain('B');
  });
});
