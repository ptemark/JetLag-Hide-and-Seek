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
  const mockCircle = { addTo: vi.fn() };

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
    expect(screen.getByText(/hiding/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice/i)).toBeInTheDocument();
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
    expect(screen.getByText(/hiding/i)).toBeInTheDocument();
  });

  it('handles player_location message without crashing', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p2', lat: 51.06, lon: -0.06 }),
      });
    });
    expect(screen.getByText(/hiding/i)).toBeInTheDocument();
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
    expect(screen.getByText(/hiding/i)).toBeInTheDocument();
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
});
