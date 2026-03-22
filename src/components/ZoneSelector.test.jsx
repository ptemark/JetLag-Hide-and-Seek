// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

vi.mock('../api.js', () => ({
  lockZone: vi.fn(),
}));

import { lockZone } from '../api.js';
import ZoneSelector from './ZoneSelector.jsx';

const player = { playerId: 'p1', name: 'Alice', role: 'hider' };
const game   = { gameId: 'g1', size: 'small' };
const zones  = [
  { stationId: 's1', name: 'Central Station', lat: 51.05, lon: -0.05, radiusM: 500 },
  { stationId: 's2', name: 'North Stop',      lat: 51.07, lon: -0.07, radiusM: 500 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ZoneSelector', () => {
  it('renders the heading and instruction text', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    expect(screen.getByText(/select your hiding zone/i)).toBeInTheDocument();
    expect(screen.getByText(/tap a transit station/i)).toBeInTheDocument();
  });

  it('renders a button for each zone', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    expect(screen.getByText(/Central Station/)).toBeInTheDocument();
    expect(screen.getByText(/North Stop/)).toBeInTheDocument();
  });

  it('shows empty message when zones array is empty', () => {
    render(<ZoneSelector player={player} game={game} zones={[]} />);
    expect(screen.getByText(/no stations available/i)).toBeInTheDocument();
  });

  it('stages a zone when a station button is tapped', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    fireEvent.click(screen.getByText(/Central Station \(500 m\)/));
    expect(screen.getByRole('dialog', { name: /confirm zone selection/i })).toBeInTheDocument();
    // Dialog contains the station name
    const dialog = screen.getByRole('dialog', { name: /confirm zone selection/i });
    expect(dialog.textContent).toMatch(/Central Station/);
    expect(dialog.textContent).toMatch(/hiding zone/i);
  });

  it('unstages when cancel is clicked in confirm dialog', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    fireEvent.click(screen.getByText(/Central Station/));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls lockZone API with correct args on confirm', async () => {
    lockZone.mockResolvedValue({
      zoneId: 'z1', gameId: 'g1', stationId: 's1',
      lat: 51.05, lon: -0.05, radiusM: 500, lockedAt: '2026-03-11T00:00:00Z',
    });

    render(<ZoneSelector player={player} game={game} zones={zones} />);
    fireEvent.click(screen.getByText(/Central Station/));
    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() => expect(lockZone).toHaveBeenCalledWith({
      gameId:    'g1',
      stationId: 's1',
      lat:       51.05,
      lon:       -0.05,
      radiusM:   500,
      playerId:  'p1',
    }));
  });

  it('shows locked confirmation message after successful lock', async () => {
    lockZone.mockResolvedValue({
      zoneId: 'z1', gameId: 'g1', stationId: 's1',
      lat: 51.05, lon: -0.05, radiusM: 500, lockedAt: '2026-03-11T00:00:00Z',
    });

    render(<ZoneSelector player={player} game={game} zones={zones} />);
    fireEvent.click(screen.getByText(/Central Station/));
    await act(async () => { fireEvent.click(screen.getByText('Confirm')); });

    await waitFor(() =>
      expect(screen.getByText(/hiding zone locked/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Central Station/)).toBeInTheDocument();
  });

  it('calls onZoneLocked callback after successful lock', async () => {
    const onZoneLocked = vi.fn();
    const lockedZone = {
      zoneId: 'z1', gameId: 'g1', stationId: 's1',
      lat: 51.05, lon: -0.05, radiusM: 500, lockedAt: '2026-03-11T00:00:00Z',
    };
    lockZone.mockResolvedValue(lockedZone);

    render(<ZoneSelector player={player} game={game} zones={zones} onZoneLocked={onZoneLocked} />);
    fireEvent.click(screen.getByText(/Central Station/));
    await act(async () => { fireEvent.click(screen.getByText('Confirm')); });

    await waitFor(() => expect(onZoneLocked).toHaveBeenCalledWith(lockedZone));
  });

  it('shows error message when lockZone API fails', async () => {
    lockZone.mockRejectedValue(new Error('lockZone failed: 500'));

    render(<ZoneSelector player={player} game={game} zones={zones} />);
    fireEvent.click(screen.getByText(/Central Station/));
    await act(async () => { fireEvent.click(screen.getByText('Confirm')); });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('lockZone failed: 500')
    );
  });

  it('disables confirm button while loading', async () => {
    let resolve;
    lockZone.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<ZoneSelector player={player} game={game} zones={zones} />);
    fireEvent.click(screen.getByText(/Central Station/));
    fireEvent.click(screen.getByText('Confirm'));

    expect(screen.getByText(/Locking/)).toBeDisabled();

    // Clean up
    await act(async () => {
      resolve({ zoneId: 'z1', gameId: 'g1', stationId: 's1', lat: 51.05, lon: -0.05, radiusM: 500 });
    });
  });

  it('marks selected station button as aria-pressed', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    const btn = screen.getByText(/Central Station/).closest('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not render confirm dialog before any station is selected', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders container with aria-label', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    expect(screen.getByLabelText('Zone selector')).toBeInTheDocument();
  });

  it('updates aria-live region when a station is selected', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent('');
    fireEvent.click(screen.getByText(/Central Station \(500 m\)/));
    expect(liveRegion).toHaveTextContent('Selected: Central Station');
  });

  it('clears aria-live region when cancel is clicked', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    const liveRegion = screen.getByRole('status');
    fireEvent.click(screen.getByText(/Central Station \(500 m\)/));
    expect(liveRegion).toHaveTextContent('Selected: Central Station');
    fireEvent.click(screen.getByText('Cancel'));
    expect(liveRegion).toHaveTextContent('');
  });
});

describe('ZoneSelector — station search filter', () => {
  it('renders search input with correct aria-label', () => {
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    expect(screen.getByRole('searchbox', { name: /search stations/i })).toBeInTheDocument();
  });

  it('filters the station list by name as the hider types', async () => {
    const user = userEvent.setup();
    render(<ZoneSelector player={player} game={game} zones={zones} />);

    await user.type(screen.getByRole('searchbox', { name: /search stations/i }), 'Central');

    expect(screen.getByText(/Central Station \(500 m\)/)).toBeInTheDocument();
    expect(screen.queryByText(/North Stop/)).not.toBeInTheDocument();
  });

  it('shows "No stations match your search." when no stations match', async () => {
    const user = userEvent.setup();
    render(<ZoneSelector player={player} game={game} zones={zones} />);

    await user.type(screen.getByRole('searchbox', { name: /search stations/i }), 'zzznomatch');

    expect(screen.getByText(/no stations match your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/Central Station/)).not.toBeInTheDocument();
    expect(screen.queryByText(/North Stop/)).not.toBeInTheDocument();
  });

  it('restores full station list when search query is cleared', async () => {
    const user = userEvent.setup();
    render(<ZoneSelector player={player} game={game} zones={zones} />);
    const input = screen.getByRole('searchbox', { name: /search stations/i });

    await user.type(input, 'Central');
    expect(screen.queryByText(/North Stop/)).not.toBeInTheDocument();

    await user.clear(input);
    expect(screen.getByText(/Central Station \(500 m\)/)).toBeInTheDocument();
    expect(screen.getByText(/North Stop \(500 m\)/)).toBeInTheDocument();
  });

  it('hides search input after zone is locked', async () => {
    lockZone.mockResolvedValue({
      zoneId: 'z1', gameId: 'g1', stationId: 's1',
      lat: 51.05, lon: -0.05, radiusM: 500, lockedAt: '2026-03-22T00:00:00Z',
    });

    render(<ZoneSelector player={player} game={game} zones={zones} />);
    expect(screen.getByRole('searchbox', { name: /search stations/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Central Station \(500 m\)/));
    await act(async () => { fireEvent.click(screen.getByText('Confirm')); });

    await waitFor(() => expect(screen.getByText(/hiding zone locked/i)).toBeInTheDocument());
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
