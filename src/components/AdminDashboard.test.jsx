import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api.js', () => ({
  fetchAdminStatus: vi.fn(),
}));

import * as api from '../api.js';
import AdminDashboard from './AdminDashboard.jsx';

/** Sample payload returned by GET /api/admin. */
const STATUS = {
  connectedPlayers: 3,
  activeGameCount: 2,
  games: [
    { gameId: 'g1', phase: 'seeking', phaseElapsedMs: 75000,   playerCount: 4 },
    { gameId: 'g2', phase: 'hiding',  phaseElapsedMs: 3600000, playerCount: 6 },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminDashboard', () => {
  // (a) renders "Admin API Key" input
  it('renders "Admin API Key" input', () => {
    render(<AdminDashboard />);
    expect(screen.getByLabelText(/admin api key/i)).toBeInTheDocument();
  });

  // (b) renders "Connect" button
  it('renders "Connect" button', () => {
    render(<AdminDashboard />);
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  // (c) submitting key calls fetchAdminStatus with the key
  it('submitting key calls fetchAdminStatus with the key', async () => {
    const user = userEvent.setup();
    api.fetchAdminStatus.mockResolvedValue(STATUS);
    render(<AdminDashboard />);

    await user.type(screen.getByLabelText(/admin api key/i), 'secret-key');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(api.fetchAdminStatus).toHaveBeenCalledWith('secret-key'));
  });

  // (d) shows connectedPlayers after success
  it('shows connectedPlayers after success', async () => {
    const user = userEvent.setup();
    api.fetchAdminStatus.mockResolvedValue(STATUS);
    render(<AdminDashboard />);

    await user.type(screen.getByLabelText(/admin api key/i), 'secret-key');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    // connectedPlayers = 3; "3" appears only in the Connected Players stat card
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  // (e) shows activeGameCount after success
  it('shows activeGameCount after success', async () => {
    const user = userEvent.setup();
    api.fetchAdminStatus.mockResolvedValue(STATUS);
    render(<AdminDashboard />);

    await user.type(screen.getByLabelText(/admin api key/i), 'secret-key');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    // activeGameCount = 2; "2" appears only in the Active Games stat card
    // (game playerCounts are 4 and 6, which differ)
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
  });

  // (f) renders a table row per active game, with correct elapsed format
  it('renders a table row per active game', async () => {
    const user = userEvent.setup();
    api.fetchAdminStatus.mockResolvedValue(STATUS);
    render(<AdminDashboard />);

    await user.type(screen.getByLabelText(/admin api key/i), 'secret-key');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(screen.getByText('g1')).toBeInTheDocument());
    expect(screen.getByText('g2')).toBeInTheDocument();
    // 75 000 ms → 1m 15s
    expect(screen.getByText('1m 15s')).toBeInTheDocument();
    // 3 600 000 ms → 60m 0s
    expect(screen.getByText('60m 0s')).toBeInTheDocument();
  });

  // (g) on error renders role="alert"
  it('on error renders role="alert" with the error message', async () => {
    const user = userEvent.setup();
    api.fetchAdminStatus.mockRejectedValue(new Error('Unauthorized'));
    render(<AdminDashboard />);

    await user.type(screen.getByLabelText(/admin api key/i), 'bad-key');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/unauthorized/i)
    );
  });

  // (h) "Refresh" button re-fetches with the stored key
  it('"Refresh" button re-fetches with the stored key', async () => {
    const user = userEvent.setup();
    api.fetchAdminStatus.mockResolvedValue(STATUS);
    render(<AdminDashboard />);

    await user.type(screen.getByLabelText(/admin api key/i), 'secret-key');
    await user.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => screen.getByRole('button', { name: /refresh/i }));

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(api.fetchAdminStatus).toHaveBeenCalledTimes(2));
    expect(api.fetchAdminStatus).toHaveBeenNthCalledWith(2, 'secret-key');
  });

  // (i) empty games array renders "No active games"
  it('renders "No active games" when games array is empty', async () => {
    const user = userEvent.setup();
    api.fetchAdminStatus.mockResolvedValue({
      connectedPlayers: 0,
      activeGameCount: 0,
      games: [],
    });
    render(<AdminDashboard />);

    await user.type(screen.getByLabelText(/admin api key/i), 'secret-key');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() =>
      expect(screen.getByText(/no active games/i)).toBeInTheDocument()
    );
  });
});
