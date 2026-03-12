// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// Prevent AnswerPanel/QuestionPanel/CardPanel from making real fetch calls in these tests.
vi.mock('../api.js', () => ({
  registerPlayer: vi.fn(),
  createGame:     vi.fn(),
  lookupGame:     vi.fn(),
  submitQuestion: vi.fn(),
  listQuestions:  vi.fn().mockResolvedValue({ questions: [] }),
  submitAnswer:   vi.fn(),
  fetchCards:     vi.fn().mockResolvedValue({ hand: [] }),
  playCardApi:    vi.fn(),
  lockZone:       vi.fn(),
}));

// ── Hoist mock objects so they're available inside vi.mock factory ─────────────
const { mockMap, mockMarker, mockTileLayer, mockRectangle, mockCircle, mockL } = vi.hoisted(() => {
  const mockMarker = {
    bindTooltip: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    setLatLng: vi.fn(),
    remove: vi.fn(),
  };
  const mockMap = {
    remove: vi.fn(),
    setView: vi.fn(),
  };
  mockMap.setView.mockReturnValue(mockMap);

  const mockTileLayer = { addTo: vi.fn() };
  const mockRectangle = { addTo: vi.fn() };
  const mockCircle = { addTo: vi.fn(), bindTooltip: vi.fn().mockReturnThis(), remove: vi.fn() };

  const mockL = {
    map: vi.fn().mockReturnValue(mockMap),
    tileLayer: vi.fn().mockReturnValue(mockTileLayer),
    rectangle: vi.fn().mockReturnValue(mockRectangle),
    circle: vi.fn().mockReturnValue(mockCircle),
    circleMarker: vi.fn().mockReturnValue(mockMarker),
  };

  return { mockMap, mockMarker, mockTileLayer, mockRectangle, mockCircle, mockL };
});

vi.mock('leaflet', () => ({ default: mockL }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import GameMap from './GameMap.jsx';

// ── Mock WebSocket ─────────────────────────────────────────────────────────────
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.send = vi.fn();
    this.close = vi.fn();
    MockWebSocket.last = this;
  }
  static last = null;
}
global.WebSocket = MockWebSocket;
WebSocket.OPEN = 1;
WebSocket.CONNECTING = 0;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const player = { playerId: 'p1', name: 'Alice', role: 'hider' };
const game = {
  gameId: 'g1',
  size: 'small',
  status: 'hiding',
  bounds: { lat_min: 51.0, lat_max: 51.1, lon_min: -0.1, lon_max: 0.0 },
};
const serverUrl = 'ws://localhost:3001';

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GameMap', () => {
  beforeEach(() => {
    MockWebSocket.last = null;
    vi.clearAllMocks();
    // Restore chained return values cleared by clearAllMocks
    mockMap.setView.mockReturnValue(mockMap);
    mockMarker.bindTooltip.mockReturnThis();
    mockMarker.addTo.mockReturnThis();
    mockL.map.mockReturnValue(mockMap);
    mockL.tileLayer.mockReturnValue(mockTileLayer);
    mockL.rectangle.mockReturnValue(mockRectangle);
    mockL.circle.mockReturnValue(mockCircle);
    mockL.circleMarker.mockReturnValue(mockMarker);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.navigator.geolocation;
  });

  it('renders the game header with phase and player name', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    // Phase appears in the header <strong> element inside the game info bar
    expect(screen.getAllByText(/hiding/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Alice/i)).toBeInTheDocument();
    const strong = document.querySelector('strong');
    expect(strong?.textContent).toMatch(/hiding/i);
  });

  it('renders the map container div', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('connects to WebSocket with correct URL', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(MockWebSocket.last).not.toBeNull();
    expect(MockWebSocket.last.url).toContain('playerId=p1');
    expect(MockWebSocket.last.url).toContain('gameId=g1');
    expect(MockWebSocket.last.url).toMatch(/^ws:\/\/localhost:3001/);
  });

  it('closes WebSocket on unmount', () => {
    const { unmount } = render(
      <GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />,
    );
    const ws = MockWebSocket.last;
    unmount();
    expect(ws.close).toHaveBeenCalled();
  });

  it('does not open WebSocket when serverUrl is not provided', () => {
    render(<GameMap player={player} game={game} zones={[]} />);
    expect(MockWebSocket.last).toBeNull();
  });

  it('updates phase display on phase_change message', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', phase: 'seeking' }),
      });
    });
    expect(screen.getByText(/seeking/i)).toBeInTheDocument();
  });

  it('shows seekers win alert on capture message', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'capture', winner: 'seekers' }),
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Seekers win!');
  });

  it('shows hiders win alert on capture message', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'capture', winner: 'hiders' }),
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Hiders win!');
  });

  it('ignores malformed WS messages without crashing', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: 'not-json{{{' });
    });
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('handles player_location message without crashing', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p2', lat: 51.06, lon: -0.06 }),
      });
    });
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('handles game_state message without crashing', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'game_state',
          players: [
            { playerId: 'p1', lat: 51.05, lon: -0.05 },
            { playerId: 'p2', lat: 51.06, lon: -0.06 },
          ],
        }),
      });
    });
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('sets up GPS polling on 10 s interval', () => {
    vi.useFakeTimers();
    const mockGetCurrentPosition = vi.fn();
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(2);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(3);
  });

  it('sends location_update over WebSocket when GPS fires', () => {
    vi.useFakeTimers();
    const mockGetCurrentPosition = vi.fn((success) => {
      success({ coords: { latitude: 51.05, longitude: -0.05 } });
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    const ws = MockWebSocket.last;
    ws.readyState = WebSocket.OPEN;

    act(() => { vi.advanceTimersByTime(10_000); });

    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    const locationMsg = sent.find((m) => m.type === 'location_update');
    expect(locationMsg).toBeTruthy();
    expect(locationMsg.playerId).toBe('p1');
    expect(locationMsg.gameId).toBe('g1');
    expect(locationMsg.lat).toBe(51.05);
  });

  it('clears GPS interval on unmount', () => {
    vi.useFakeTimers();
    const mockGetCurrentPosition = vi.fn();
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    const { unmount } = render(
      <GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />,
    );
    const callsBefore = mockGetCurrentPosition.mock.calls.length;
    unmount();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(callsBefore);
  });

  it('skips GPS setup when geolocation is unavailable', () => {
    expect(() =>
      render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />),
    ).not.toThrow();
  });

  it('displays player role in header', () => {
    const seeker = { ...player, role: 'seeker' };
    render(<GameMap player={seeker} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.getByText(/seeker/i)).toBeInTheDocument();
  });

  it('renders zone circles on the Leaflet map', () => {
    render(<GameMap
      player={player}
      game={game}
      zones={[{ lat: 51.05, lon: -0.05, radius: 500 }, { lat: 51.07, lon: -0.07, radius: 1000 }]}
      serverUrl={serverUrl}
    />);
    expect(mockL.circle).toHaveBeenCalledTimes(2);
  });

  it('renders game bounds rectangle on the Leaflet map', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(mockL.rectangle).toHaveBeenCalled();
  });

  it('shows ZoneSelector for hider during hiding phase when zone is not locked', () => {
    const hidingGame = { ...game, status: 'hiding' };
    render(<GameMap player={player} game={hidingGame} zones={[]} serverUrl={serverUrl} />);
    expect(screen.getByTestId('zone-selector')).toBeInTheDocument();
  });

  it('does not show ZoneSelector for seekers', () => {
    const seeker = { ...player, role: 'seeker' };
    const hidingGame = { ...game, status: 'hiding' };
    render(<GameMap player={seeker} game={hidingGame} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('zone-selector')).not.toBeInTheDocument();
  });

  it('does not show ZoneSelector when phase is not hiding', () => {
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('zone-selector')).not.toBeInTheDocument();
  });

  it('shows hiding countdown banner on timer_sync during hiding phase', async () => {
    const phaseEndsAt = new Date(Date.now() + 23 * 60 * 1000 + 47 * 1000).toISOString();
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'timer_sync', phase: 'hiding', phaseEndsAt }),
      });
    });
    const banner = screen.getByTestId('timer-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/hiding ends in/i);
  });

  it('shows seeking countdown banner on timer_sync during seeking phase', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    const phaseEndsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', phase: 'seeking' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'timer_sync', phase: 'seeking', phaseEndsAt }),
      });
    });
    const banner = screen.getByTestId('timer-banner');
    expect(banner.textContent).toMatch(/seeking ends in/i);
  });

  it('shows question expiry banner on question_pending message', async () => {
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000 + 12 * 1000).toISOString();
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'question_pending', gameId: 'g1', questionId: 'q1', expiresAt }),
      });
    });
    const banner = screen.getByTestId('timer-banner');
    expect(banner.textContent).toMatch(/question expires in/i);
  });

  it('question_pending banner takes priority over phase timer', async () => {
    const phaseEndsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const questionExpiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'timer_sync', phase: 'seeking', phaseEndsAt }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'question_pending', gameId: 'g1', questionId: 'q1', expiresAt: questionExpiresAt }),
      });
    });
    const banner = screen.getByTestId('timer-banner');
    expect(banner.textContent).toMatch(/question expires in/i);
  });

  it('clears question expiry banner on question_answered', async () => {
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const phaseEndsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', phase: 'seeking' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'timer_sync', phase: 'seeking', phaseEndsAt }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'question_pending', gameId: 'g1', questionId: 'q1', expiresAt }),
      });
    });
    expect(screen.getByTestId('timer-banner').textContent).toMatch(/question expires in/i);

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'question_answered', questionId: 'q1' }),
      });
    });
    // After answer, banner reverts to phase timer (not question expiry).
    const banner = screen.getByTestId('timer-banner');
    expect(banner.textContent).toMatch(/seeking ends in/i);
  });

  it('clears question expiry banner on question_expired', async () => {
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const phaseEndsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', phase: 'seeking' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'timer_sync', phase: 'seeking', phaseEndsAt }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'question_pending', gameId: 'g1', questionId: 'q1', expiresAt }),
      });
    });
    expect(screen.getByTestId('timer-banner').textContent).toMatch(/question expires in/i);

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'question_expired', questionId: 'q1' }),
      });
    });
    const banner = screen.getByTestId('timer-banner');
    expect(banner.textContent).toMatch(/seeking ends in/i);
  });

  it('does not show timer banner when no timer_sync received', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('timer-banner')).not.toBeInTheDocument();
  });

  it('renders a decoy circle when false_zone WS event is received', async () => {
    mockCircle.addTo.mockClear();
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    const decoyZone = { stationId: 'decoy-1', lat: 51.6, lon: -0.2, radiusM: 500, decoyId: 'decoy-abc' };
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'false_zone', gameId: game.gameId, zone: decoyZone }),
      });
    });

    // L.circle should have been called with the decoy lat/lon.
    const circleCalls = mockL.circle.mock.calls;
    const decoyCall = circleCalls.find(([latlng]) => latlng[0] === 51.6 && latlng[1] === -0.2);
    expect(decoyCall).toBeTruthy();
    // The circle should have been added to the map.
    expect(mockCircle.addTo).toHaveBeenCalled();
  });

  it('removes decoy circle when false_zone_expired WS event is received', async () => {
    mockCircle.remove.mockClear();
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    const decoyZone = { stationId: 'decoy-2', lat: 51.7, lon: -0.3, radiusM: 500, decoyId: 'decoy-xyz' };
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'false_zone', gameId: game.gameId, zone: decoyZone }),
      });
    });

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'false_zone_expired', gameId: game.gameId, decoyId: 'decoy-xyz' }),
      });
    });

    expect(mockCircle.remove).toHaveBeenCalled();
  });

  it('hides ZoneSelector after zone_locked WS event is received', async () => {
    const hidingGame = { ...game, status: 'hiding' };
    render(<GameMap player={player} game={hidingGame} zones={[]} serverUrl={serverUrl} />);
    expect(screen.getByTestId('zone-selector')).toBeInTheDocument();

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'zone_locked',
          gameId: 'g1',
          zone: { stationId: 's1', lat: 51.05, lon: -0.05, radiusM: 500 },
        }),
      });
    });
    expect(screen.queryByTestId('zone-selector')).not.toBeInTheDocument();
  });

  it('does not show reconnecting banner on initial render', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('reconnecting-banner')).not.toBeInTheDocument();
  });

  it('shows Reconnecting… banner when WS connection drops', async () => {
    vi.useFakeTimers();
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onclose?.();
    });
    expect(screen.getByTestId('reconnecting-banner')).toBeInTheDocument();
    expect(screen.getByTestId('reconnecting-banner')).toHaveTextContent('Reconnecting');
  });

  it('hides Reconnecting… banner after WS reconnects and receives joined_game', async () => {
    vi.useFakeTimers();
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    // Drop connection — banner should appear.
    await act(async () => {
      MockWebSocket.last.onclose?.();
    });
    expect(screen.getByTestId('reconnecting-banner')).toBeInTheDocument();

    // Advance timer so reconnect fires and a new WS is created.
    await act(async () => {
      vi.advanceTimersByTime(1_100);
    });

    // The new WS sends joined_game — banner should disappear.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'joined_game', playerId: 'p1', gameId: 'g1' }),
      });
    });
    expect(screen.queryByTestId('reconnecting-banner')).not.toBeInTheDocument();
  });
});
