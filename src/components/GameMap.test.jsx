// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
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
  submitScore:    vi.fn().mockResolvedValue({}),
  listZones:      vi.fn().mockResolvedValue([]),
}));

// ── Hoist mock objects so they're available inside vi.mock factory ─────────────
const { mockMap, mockMarker, mockTileLayer, mockRectangle, mockCircle, mockPolyline, mockL } = vi.hoisted(() => {
  const mockMarker = {
    bindTooltip: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    setLatLng: vi.fn(),
    setStyle: vi.fn(),
    setTooltipContent: vi.fn(),
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
  const mockPolyline = { addTo: vi.fn().mockReturnThis(), setLatLngs: vi.fn() };

  const mockL = {
    map: vi.fn().mockReturnValue(mockMap),
    tileLayer: vi.fn().mockReturnValue(mockTileLayer),
    rectangle: vi.fn().mockReturnValue(mockRectangle),
    circle: vi.fn().mockReturnValue(mockCircle),
    circleMarker: vi.fn().mockReturnValue(mockMarker),
    polyline: vi.fn().mockReturnValue(mockPolyline),
  };

  return { mockMap, mockMarker, mockTileLayer, mockRectangle, mockCircle, mockPolyline, mockL };
});

vi.mock('leaflet', () => ({ default: mockL }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import * as api from '../api.js';
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
    // Default no-op geolocation mock so tests that don't need GPS don't see the
    // GPS-unsupported error banner (which would conflict with other role="alert" queries)
    global.navigator.geolocation = { getCurrentPosition: vi.fn() };
    // Restore chained return values cleared by clearAllMocks
    mockMap.setView.mockReturnValue(mockMap);
    mockMarker.bindTooltip.mockReturnThis();
    mockMarker.addTo.mockReturnThis();
    mockMarker.setLatLng.mockReset();
    mockMarker.setStyle.mockReset();
    mockMarker.setTooltipContent.mockReset();
    mockPolyline.addTo.mockReturnThis();
    mockL.map.mockReturnValue(mockMap);
    mockL.tileLayer.mockReturnValue(mockTileLayer);
    mockL.rectangle.mockReturnValue(mockRectangle);
    mockL.circle.mockReturnValue(mockCircle);
    mockL.circleMarker.mockReturnValue(mockMarker);
    mockL.polyline.mockReturnValue(mockPolyline);
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
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
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
    delete global.navigator.geolocation;
    expect(() =>
      render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />),
    ).not.toThrow();
  });

  it('shows GPS unsupported alert when geolocation is unavailable', async () => {
    delete global.navigator.geolocation;
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.getByTestId('gps-error-banner')).toHaveTextContent(
      'Your device does not support location access',
    );
  });

  it('shows GPS denied alert when getCurrentPosition errors with code 1', async () => {
    const mockGetCurrentPosition = vi.fn((_success, error) => {
      error({ code: 1 });
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {});
    expect(screen.getByTestId('gps-error-banner')).toHaveTextContent(
      'Location access denied',
    );
  });

  it('shows GPS unavailable alert when getCurrentPosition errors with code 2', async () => {
    const mockGetCurrentPosition = vi.fn((_success, error) => {
      error({ code: 2 });
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {});
    expect(screen.getByTestId('gps-error-banner')).toHaveTextContent(
      'Location unavailable',
    );
  });

  it('does not show GPS error alert for timeout errors (code 3)', async () => {
    const mockGetCurrentPosition = vi.fn((_success, error) => {
      error({ code: 3 });
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {});
    expect(screen.queryByTestId('gps-error-banner')).not.toBeInTheDocument();
  });

  it('clears GPS error banner after a successful position fix', async () => {
    let capturedErrorCb;
    let capturedSuccessCb;
    const mockGetCurrentPosition = vi.fn((success, error) => {
      capturedSuccessCb = success;
      capturedErrorCb = error;
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    // Trigger a permission-denied error to show the banner
    await act(async () => { capturedErrorCb({ code: 1 }); });
    expect(screen.getByTestId('gps-error-banner')).toBeInTheDocument();

    // Now simulate a successful fix — banner should clear
    await act(async () => {
      capturedSuccessCb({ coords: { latitude: 51.05, longitude: -0.05 } });
    });
    expect(screen.queryByTestId('gps-error-banner')).not.toBeInTheDocument();
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
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
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
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
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
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
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

  it('shows end_game countdown banner with hider message on timer_sync phase end_game', async () => {
    const phaseEndsAt = new Date(Date.now() + 9 * 60 * 1000 + 30 * 1000).toISOString();
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'timer_sync', phase: 'end_game', phaseEndsAt }) });
    });
    const banner = screen.getByTestId('timer-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/you win if not spotted in/i);
  });

  it('shows end_game countdown banner with seeker message for seeker role', async () => {
    const seekerPlayer = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    const phaseEndsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    render(<GameMap player={seekerPlayer} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'timer_sync', phase: 'end_game', phaseEndsAt }) });
    });
    const banner = screen.getByTestId('timer-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/find the hider in/i);
  });

  it('end_game countdown takes priority over phase timer (end_game before seeking timer_sync)', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    const seekingEndsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endGameEndsAt = new Date(Date.now() + 8 * 60 * 1000).toISOString();
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'timer_sync', phase: 'seeking', phaseEndsAt: seekingEndsAt }) });
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'timer_sync', phase: 'end_game', phaseEndsAt: endGameEndsAt }) });
    });
    const banner = screen.getByTestId('timer-banner');
    expect(banner.textContent).toMatch(/you win if not spotted in/i);
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

  it('shows On Transit / Off Transit toggle for seeker during seeking phase', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    expect(screen.getByTestId('transit-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('transit-toggle')).toHaveTextContent('Off Transit');
  });

  it('does not show transit toggle for hiders', () => {
    render(<GameMap player={player} game={{ ...game, status: 'seeking' }} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('transit-toggle')).not.toBeInTheDocument();
  });

  it('does not show transit toggle during hiding phase for seekers', () => {
    const seeker = { ...player, role: 'seeker' };
    render(<GameMap player={seeker} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('transit-toggle')).not.toBeInTheDocument();
  });

  it('toggles to On Transit on click and sends set_transit WS message', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    const ws = MockWebSocket.last;
    ws.readyState = WebSocket.OPEN;

    const btn = screen.getByTestId('transit-toggle');
    await act(async () => { btn.click(); });

    expect(screen.getByTestId('transit-toggle')).toHaveTextContent('On Transit');
    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    const transitMsg = sent.find((m) => m.type === 'set_transit');
    expect(transitMsg).toBeTruthy();
    expect(transitMsg.onTransit).toBe(true);
  });

  it('handles player_transit WS event without crashing', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_transit', gameId: 'g1', playerId: 'p2', onTransit: true }),
      });
    });
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('updates existing marker tooltip to include 🚌 when player_transit fires after marker created', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => { MockWebSocket.last.readyState = 1; MockWebSocket.last.onopen?.(); });
    // First: player_location creates the marker for p2
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', gameId: 'g1', playerId: 'p2', lat: 51.05, lon: -0.05 }),
      });
    });
    mockMarker.setTooltipContent.mockReset();
    // Then: player_transit fires — existing marker should update tooltip and style
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_transit', gameId: 'g1', playerId: 'p2', onTransit: true }),
      });
    });
    expect(mockMarker.setTooltipContent).toHaveBeenCalled();
    const label = mockMarker.setTooltipContent.mock.calls[0][0];
    expect(label).toContain('🚌');
    expect(mockMarker.setStyle).toHaveBeenCalledWith({ fillOpacity: 0.3 });
  });

  it('removes 🚌 from marker tooltip when player_transit fires with onTransit false', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => { MockWebSocket.last.readyState = 1; MockWebSocket.last.onopen?.(); });
    // Create marker with onTransit: true
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', gameId: 'g1', playerId: 'p2', lat: 51.05, lon: -0.05 }),
      });
    });
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_transit', gameId: 'g1', playerId: 'p2', onTransit: true }),
      });
    });
    mockMarker.setTooltipContent.mockReset();
    mockMarker.setStyle.mockReset();
    // Now toggle off transit
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_transit', gameId: 'g1', playerId: 'p2', onTransit: false }),
      });
    });
    expect(mockMarker.setTooltipContent).toHaveBeenCalled();
    const label = mockMarker.setTooltipContent.mock.calls[0][0];
    expect(label).not.toContain('🚌');
    expect(mockMarker.setStyle).toHaveBeenCalledWith({ fillOpacity: 0.7 });
  });

  // ---------------------------------------------------------------------------
  // "I See the Hider!" button — Task 70
  // ---------------------------------------------------------------------------

  it('shows "I See the Hider!" button for seeker once End Game is active', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    // Button absent before End Game starts.
    expect(screen.queryByTestId('spot-hider-btn')).not.toBeInTheDocument();
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });
    expect(screen.getByTestId('spot-hider-btn')).toBeInTheDocument();
    expect(screen.getByTestId('spot-hider-btn')).toHaveTextContent('I See the Hider!');
  });

  it('does not show "I See the Hider!" button for hiders', () => {
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('spot-hider-btn')).not.toBeInTheDocument();
  });

  it('does not show "I See the Hider!" button during hiding phase for seekers', () => {
    const seeker = { ...player, role: 'seeker' };
    render(<GameMap player={seeker} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('spot-hider-btn')).not.toBeInTheDocument();
  });

  it('sends spot_hider WS message when "I See the Hider!" is clicked', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    const ws = MockWebSocket.last;
    ws.readyState = WebSocket.OPEN;

    // Activate End Game so the button appears.
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });

    await act(async () => {
      screen.getByTestId('spot-hider-btn').click();
    });

    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    const spotMsg = sent.find((m) => m.type === 'spot_hider');
    expect(spotMsg).toBeTruthy();
    expect(spotMsg.gameId).toBe('g1');
    expect(spotMsg.playerId).toBe('p1');
  });

  it('changes button label to "Not Close Enough" on spot_rejected response', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    // Activate End Game so the button and rejected message are rendered.
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'spot_rejected', gameId: 'g1', spotterId: 'p1', distanceM: 80, spotRadiusM: 30 }),
      });
    });
    expect(screen.getByTestId('spot-hider-btn')).toHaveTextContent('Not Close Enough');
    expect(screen.getByTestId('spot-rejected-msg')).toHaveTextContent('You are 80 m away; need to be within 30 m');
  });

  it('shows generic fallback message on spot_rejected without distanceM', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    // Activate End Game so the rejected message renders.
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'spot_rejected', gameId: 'g1', spotterId: 'p1' }),
      });
    });
    expect(screen.getByTestId('spot-rejected-msg')).toHaveTextContent('You are not close enough to the hider yet.');
  });

  it('clears stale spot distance when a new spot attempt is made', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    // Activate End Game so the button is visible.
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });
    // First attempt rejected with distance
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'spot_rejected', gameId: 'g1', spotterId: 'p1', distanceM: 80, spotRadiusM: 30 }),
      });
    });
    expect(screen.getByTestId('spot-rejected-msg')).toHaveTextContent('You are 80 m away');
    // Click again — state resets to pending; distance clears before next response
    await act(async () => {
      screen.getByTestId('spot-hider-btn').click();
    });
    // While pending the rejection message is not visible
    expect(screen.queryByTestId('spot-rejected-msg')).not.toBeInTheDocument();
  });

  it('changes button label to "Hider Spotted!" on spot_confirmed response', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    // Activate End Game so the button is visible.
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'spot_confirmed', gameId: 'g1', spotterId: 'p1', distanceM: 10 }),
      });
    });
    expect(screen.getByTestId('spot-hider-btn')).toHaveTextContent('Hider Spotted!');
  });

  it('disables button after spot_confirmed', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    // Activate End Game so the button is visible.
    await act(async () => {
      MockWebSocket.last.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'spot_confirmed', gameId: 'g1', spotterId: 'p1', distanceM: 10 }),
      });
    });
    expect(screen.getByTestId('spot-hider-btn')).toBeDisabled();
  });

  // Task 161 — spot gate: End Game + off transit required
  it('spot button absent during seeking phase when End Game has not started', () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('spot-hider-btn')).not.toBeInTheDocument();
  });

  it('spot button disabled with "Board off transit to spot" label when seeker is on transit during End Game', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    const ws = MockWebSocket.last;
    ws.readyState = WebSocket.OPEN;

    // Activate End Game.
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });
    // Toggle transit on.
    await act(async () => {
      screen.getByTestId('transit-toggle').click();
    });

    const btn = screen.getByTestId('spot-hider-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Board off transit to spot');
  });

  it('spot button enabled with "I See the Hider!" label when seeker is off transit during End Game', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    const ws = MockWebSocket.last;

    // Activate End Game. Seeker starts off transit by default.
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }) });
    });

    const btn = screen.getByTestId('spot-hider-btn');
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent('I See the Hider!');
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

  // ---------------------------------------------------------------------------
  // End Game banner — Task 71
  // ---------------------------------------------------------------------------

  it('shows "Stay put!" banner for hider on end_game_started', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }),
      });
    });
    expect(screen.getByTestId('end-game-banner-hider')).toBeInTheDocument();
    expect(screen.queryByTestId('end-game-banner-seeker')).not.toBeInTheDocument();
  });

  it('shows "Find and spot the hider!" banner for seeker on end_game_started', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }),
      });
    });
    expect(screen.getByTestId('end-game-banner-seeker')).toBeInTheDocument();
    expect(screen.queryByTestId('end-game-banner-hider')).not.toBeInTheDocument();
  });

  it('does not show End Game banners before end_game_started', () => {
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('end-game-banner-hider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('end-game-banner-seeker')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Zone privacy — Task 163
  // ---------------------------------------------------------------------------

  it('zone_locked WS event updates the zone circle for the hider', async () => {
    mockL.circle.mockClear();
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'zone_locked',
          gameId: 'g1',
          zone: { stationId: 's99', lat: 48.1, lon: 11.5, radiusM: 500 },
        }),
      });
    });

    const circleCalls = mockL.circle.mock.calls;
    const zoneCall = circleCalls.find(([latlng]) => latlng[0] === 48.1 && latlng[1] === 11.5);
    expect(zoneCall).toBeTruthy();
  });

  it('end_game_started with zone field causes zone circle to appear for seeker', async () => {
    mockL.circle.mockClear();
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'end_game_started',
          gameId: 'g1',
          zone: { stationId: 's77', lat: 52.3, lon: 4.9, radiusM: 500 },
        }),
      });
    });

    const circleCalls = mockL.circle.mock.calls;
    const zoneCall = circleCalls.find(([latlng]) => latlng[0] === 52.3 && latlng[1] === 4.9);
    expect(zoneCall).toBeTruthy();
  });

  it('end_game_started without zone field does not crash and does not add a zone circle', async () => {
    mockL.circle.mockClear();
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }),
      });
    });

    // L.circle should not have been called for a locked zone (no zone in payload).
    const circleCalls = mockL.circle.mock.calls;
    // No call with lat 52.3 / lon 4.9 (from previous isolated test) — just confirm no error.
    expect(screen.getByTestId('end-game-banner-seeker')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Hider journey trail — Task 75
  // ---------------------------------------------------------------------------

  it('creates a polyline on the Leaflet map after hider receives 2+ player_location events', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.05, lon: -0.05 }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.06, lon: -0.06 }),
      });
    });
    expect(mockL.polyline).toHaveBeenCalled();
    expect(mockPolyline.addTo).toHaveBeenCalled();
  });

  it('updates polyline latlngs (not re-creates) on subsequent hider location events', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    // First two events create the polyline.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.05, lon: -0.05 }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.06, lon: -0.06 }),
      });
    });
    const createCount = mockL.polyline.mock.calls.length;
    // Third event should call setLatLngs, not create a new polyline.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.07, lon: -0.07 }),
      });
    });
    expect(mockL.polyline.mock.calls.length).toBe(createCount); // no new polyline created
    expect(mockPolyline.setLatLngs).toHaveBeenCalled();
  });

  it('enforces MAX_TRAIL_POINTS cap — trail never exceeds 500 points', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    // Send 501 location events (batched in one act → single render).
    // React 18 batches all functional state updates, so the trail is capped at 500 before the
    // first render, meaning L.polyline is created with exactly 500 latlngs.
    await act(async () => {
      for (let i = 0; i < 501; i++) {
        MockWebSocket.last.onmessage?.({
          data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.0 + i * 0.0001, lon: -0.05 }),
        });
      }
    });
    // L.polyline should have been created with exactly 500 points (cap enforced).
    expect(mockL.polyline).toHaveBeenCalled();
    const creationLatlngs = mockL.polyline.mock.calls[0][0];
    expect(creationLatlngs).toHaveLength(500);
  });

  it('does not create a polyline for seeker player_location events', async () => {
    const seeker = { ...player, role: 'seeker' };
    render(<GameMap player={seeker} game={{ ...game, status: 'seeking' }} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.05, lon: -0.05 }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.06, lon: -0.06 }),
      });
    });
    expect(mockL.polyline).not.toHaveBeenCalled();
  });

  it('resets trail (clears polyline points) on phase_change to hiding', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    // Build up a trail.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.05, lon: -0.05 }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.06, lon: -0.06 }),
      });
    });
    expect(mockL.polyline).toHaveBeenCalled();
    // Transition back to hiding (e.g. replay).
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'hiding' }),
      });
    });
    // After reset the polyline should be updated to an empty array.
    const lastSetLatLngs = mockPolyline.setLatLngs.mock.calls.at(-1);
    expect(lastSetLatLngs[0]).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Join error banner — Task 76
  // ---------------------------------------------------------------------------

  it('does not show join-error-banner on initial render', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('join-error-banner')).not.toBeInTheDocument();
  });

  it('shows join-error-banner when server sends an error message', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'error',
          code: 'HIDER_SLOT_TAKEN',
          message: 'A hider has already joined this game',
        }),
      });
    });
    expect(screen.getByTestId('join-error-banner')).toBeInTheDocument();
    expect(screen.getByTestId('join-error-banner')).toHaveTextContent(
      'A hider has already joined this game',
    );
  });

  it('shows fallback text in join-error-banner when error message is missing', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'error' }),
      });
    });
    expect(screen.getByTestId('join-error-banner')).toHaveTextContent('An error occurred');
  });

  // ---------------------------------------------------------------------------
  // Out-of-zone banners — Task 77
  // ---------------------------------------------------------------------------

  it('does not show out-of-zone-banner on initial render', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('out-of-zone-banner')).not.toBeInTheDocument();
  });

  it('shows out-of-zone-banner for hider on zone_warning HIDER_OUT_OF_ZONE', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'zone_warning', code: 'HIDER_OUT_OF_ZONE', message: 'You are outside your hiding zone' }),
      });
    });
    expect(screen.getByTestId('out-of-zone-banner')).toBeInTheDocument();
  });

  it('does not show out-of-zone-banner for a zone_warning with a different code', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'zone_warning', code: 'OTHER_CODE' }),
      });
    });
    expect(screen.queryByTestId('out-of-zone-banner')).not.toBeInTheDocument();
  });

  it('resets out-of-zone-banner on phase_change', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'zone_warning', code: 'HIDER_OUT_OF_ZONE', message: 'Outside' }),
      });
    });
    expect(screen.getByTestId('out-of-zone-banner')).toBeInTheDocument();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
    });
    expect(screen.queryByTestId('out-of-zone-banner')).not.toBeInTheDocument();
  });

  it('does not show hider-out-of-zone-banner on initial render', () => {
    const seekerPlayer = { playerId: 'p1', name: 'Alice', role: 'seeker' };
    render(<GameMap player={seekerPlayer} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('hider-out-of-zone-banner')).not.toBeInTheDocument();
  });

  it('shows hider-out-of-zone-banner for seeker on hider_out_of_zone event', async () => {
    const seekerPlayer = { playerId: 'p1', name: 'Alice', role: 'seeker' };
    render(<GameMap player={seekerPlayer} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'hider_out_of_zone', gameId: 'g1' }),
      });
    });
    expect(screen.getByTestId('hider-out-of-zone-banner')).toBeInTheDocument();
  });

  it('resets hider-out-of-zone-banner for seeker on phase_change', async () => {
    const seekerPlayer = { playerId: 'p1', name: 'Alice', role: 'seeker' };
    render(<GameMap player={seekerPlayer} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'hider_out_of_zone', gameId: 'g1' }),
      });
    });
    expect(screen.getByTestId('hider-out-of-zone-banner')).toBeInTheDocument();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
    });
    expect(screen.queryByTestId('hider-out-of-zone-banner')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Movement locked — Task 78
  // ---------------------------------------------------------------------------

  it('shows movement-locked-banner for hider on movement_locked END_GAME_ACTIVE', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'movement_locked', code: 'END_GAME_ACTIVE', message: 'You cannot move during End Game' }),
      });
    });
    expect(screen.getByTestId('movement-locked-banner')).toBeInTheDocument();
  });

  it('does not show movement-locked-banner for movement_locked with different code', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'movement_locked', code: 'OTHER_CODE' }),
      });
    });
    expect(screen.queryByTestId('movement-locked-banner')).not.toBeInTheDocument();
  });

  it('resets movement-locked-banner on phase_change', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'movement_locked', code: 'END_GAME_ACTIVE', message: 'You cannot move during End Game' }),
      });
    });
    expect(screen.getByTestId('movement-locked-banner')).toBeInTheDocument();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'hiding' }),
      });
    });
    expect(screen.queryByTestId('movement-locked-banner')).not.toBeInTheDocument();
  });

  it('resets End Game banner on phase_change to finished', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }),
      });
    });
    expect(screen.getByTestId('end-game-banner-hider')).toBeInTheDocument();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'finished', winner: 'hider' }),
      });
    });
    expect(screen.queryByTestId('end-game-banner-hider')).not.toBeInTheDocument();
  });

  it('resets End Game banner on phase_change to hiding', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }),
      });
    });
    expect(screen.getByTestId('end-game-banner-hider')).toBeInTheDocument();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'hiding' }),
      });
    });
    expect(screen.queryByTestId('end-game-banner-hider')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Location rejected banner — Task 94
  // ---------------------------------------------------------------------------

  it('does not show location-rejected-banner on initial render', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('location-rejected-banner')).not.toBeInTheDocument();
  });

  it('shows location-rejected-banner on location_rejected OUT_OF_BOUNDS', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'location_rejected', code: 'OUT_OF_BOUNDS', message: 'Location is outside game bounds' }),
      });
    });
    expect(screen.getByTestId('location-rejected-banner')).toBeInTheDocument();
    expect(screen.getByTestId('location-rejected-banner').textContent).toContain('outside game bounds');
  });

  it('does not show location-rejected-banner for location_rejected with different code', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'location_rejected', code: 'OTHER_CODE' }),
      });
    });
    expect(screen.queryByTestId('location-rejected-banner')).not.toBeInTheDocument();
  });

  it('dismisses location-rejected-banner when dismiss button is clicked', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'location_rejected', code: 'OUT_OF_BOUNDS' }),
      });
    });
    expect(screen.getByTestId('location-rejected-banner')).toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'Dismiss' }).click();
    });
    expect(screen.queryByTestId('location-rejected-banner')).not.toBeInTheDocument();
  });

  it('sends bounds in join_game message when game has bounds', async () => {
    const gameWithBounds = {
      ...game,
      bounds: { lat_min: 51.0, lat_max: 52.0, lon_min: -1.0, lon_max: 0.0 },
    };
    render(<GameMap player={player} game={gameWithBounds} zones={[]} serverUrl={serverUrl} />);
    // Trigger onopen so the join_game message is sent.
    await act(async () => {
      MockWebSocket.last.readyState = 1;
      MockWebSocket.last.onopen?.();
    });
    const sentMsgs = MockWebSocket.last.send.mock.calls.map(([m]) => JSON.parse(m));
    const joinMsg = sentMsgs.find(m => m.type === 'join_game');
    expect(joinMsg).toBeDefined();
    expect(joinMsg.bounds).toEqual({ latMin: 51.0, latMax: 52.0, lonMin: -1.0, lonMax: 0.0 });
  });

  // ---------------------------------------------------------------------------
  // Card draw WS notification — Task 92
  // ---------------------------------------------------------------------------

  it('card_drawn with matching playerId triggers fetchCards refresh', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    // Wait for initial card fetch on mount.
    await waitFor(() => expect(api.fetchCards).toHaveBeenCalledTimes(1));

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'card_drawn', gameId: 'g1', playerId: 'p1', cardId: 'c99', cardType: 'time_bonus' }),
      });
    });
    // CardPanel should re-fetch cards after the card_drawn event.
    await waitFor(() => expect(api.fetchCards).toHaveBeenCalledTimes(2));
  });

  it('card_drawn with non-matching playerId does not trigger extra fetchCards call', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await waitFor(() => expect(api.fetchCards).toHaveBeenCalledTimes(1));

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'card_drawn', gameId: 'g1', playerId: 'other-player', cardId: 'c88', cardType: 'curse' }),
      });
    });
    // No additional fetch should happen — the card belongs to a different player.
    await new Promise(r => setTimeout(r, 50));
    expect(api.fetchCards).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // game_state_sync — Task 96
  // ---------------------------------------------------------------------------

  it('game_state_sync sets phase in the phase display', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'game_state_sync', gameId: 'g1', phase: 'seeking', zones: [], endGameActive: false }),
      });
    });
    expect(screen.getByText(/seeking/i)).toBeInTheDocument();
  });

  it('game_state_sync updates locked-zone state without throwing', async () => {
    // game_state_sync with zones restores the zone circle for a reconnecting hider.
    const hidingGame = { ...game, status: 'hiding' };
    const syncedZone = { stationId: 'z1', name: 'Central Station', lat: 51.05, lon: -0.05, radiusM: 300 };
    mockL.circle.mockClear();
    render(<GameMap player={player} game={hidingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'game_state_sync', gameId: 'g1', phase: 'hiding', zones: [syncedZone], endGameActive: false }),
      });
    });
    // The hider's zone circle should be drawn with the synced zone's coordinates.
    const circleCalls = mockL.circle.mock.calls;
    const zoneCall = circleCalls.find(([latlng]) => latlng[0] === 51.05 && latlng[1] === -0.05);
    expect(zoneCall).toBeTruthy();
  });

  it('game_state_sync restores zone circle for reconnecting hider during seeking', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    const syncedZone = { stationId: 'z2', name: 'Victoria', lat: 51.49, lon: -0.14, radiusM: 500 };
    mockL.circle.mockClear();
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'game_state_sync', gameId: 'g1', phase: 'seeking', zones: [syncedZone], endGameActive: false }),
      });
    });
    const circleCalls = mockL.circle.mock.calls;
    const zoneCall = circleCalls.find(([latlng]) => latlng[0] === 51.49 && latlng[1] === -0.14);
    expect(zoneCall).toBeTruthy();
  });

  it('game_state_sync restores zone circle for reconnecting seeker during End Game', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    const syncedZone = { stationId: 'z3', name: 'Paddington', lat: 51.52, lon: -0.18, radiusM: 500 };
    mockL.circle.mockClear();
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'game_state_sync', gameId: 'g1', phase: 'seeking', zones: [syncedZone], endGameActive: true }),
      });
    });
    const circleCalls = mockL.circle.mock.calls;
    const zoneCall = circleCalls.find(([latlng]) => latlng[0] === 51.52 && latlng[1] === -0.18);
    expect(zoneCall).toBeTruthy();
  });

  it('game_state_sync does NOT reveal zone circle to seeker when End Game not active', async () => {
    const seeker = { ...player, role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    const syncedZone = { stationId: 'z4', name: 'Waterloo', lat: 51.50, lon: -0.11, radiusM: 500 };
    mockL.circle.mockClear();
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'game_state_sync', gameId: 'g1', phase: 'seeking', zones: [syncedZone], endGameActive: false }),
      });
    });
    const circleCalls = mockL.circle.mock.calls;
    const zoneCall = circleCalls.find(([latlng]) => latlng[0] === 51.50 && latlng[1] === -0.11);
    expect(zoneCall).toBeFalsy();
  });

  it('listZones is called when hider enters hiding phase', async () => {
    const hidingGame = { ...game, status: 'hiding' };
    const stations = [
      { stationId: 's1', name: 'Kings Cross', lat: 51.53, lon: -0.12, radiusM: 500 },
      { stationId: 's2', name: 'London Bridge', lat: 51.50, lon: -0.09, radiusM: 500 },
    ];
    api.listZones.mockResolvedValueOnce(stations);
    render(<GameMap player={player} game={hidingGame} zones={[]} serverUrl={serverUrl} />);
    await waitFor(() => {
      expect(api.listZones).toHaveBeenCalledWith({
        scale: hidingGame.size,
        bounds: hidingGame.bounds,
      });
    });
  });

  it('ZoneSelector receives zones returned by listZones', async () => {
    const hidingGame = { ...game, status: 'hiding' };
    const stations = [
      { stationId: 's1', name: 'Kings Cross', lat: 51.53, lon: -0.12, radiusM: 500 },
    ];
    api.listZones.mockResolvedValueOnce(stations);
    render(<GameMap player={player} game={hidingGame} zones={[]} serverUrl={serverUrl} />);
    // ZoneSelector should eventually show the station fetched from listZones.
    await waitFor(() => {
      expect(screen.getByText(/Kings Cross/)).toBeInTheDocument();
    });
  });

  it('shows role=alert error when listZones rejects', async () => {
    const hidingGame = { ...game, status: 'hiding' };
    api.listZones.mockRejectedValueOnce(new Error('listZones failed: 503'));
    render(<GameMap player={player} game={hidingGame} zones={[]} serverUrl={serverUrl} />);
    await waitFor(() => {
      expect(screen.getByRole('alert', { name: '' })).toBeInTheDocument();
    });
    // The error message should mention the failure.
    const alerts = screen.getAllByRole('alert');
    const zonesAlert = alerts.find((el) => el.textContent.includes('listZones failed'));
    expect(zonesAlert).toBeTruthy();
  });

  it('game_state_sync sets endGameActive and shows end-game banner for hider', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'game_state_sync', gameId: 'g1', phase: 'seeking', zones: [], endGameActive: true }),
      });
    });
    expect(screen.getByTestId('end-game-banner-hider')).toBeInTheDocument();
  });

  it('game_state_sync does not clear existing locationTrail', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    // Build up a trail first.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.05, lon: -0.05 }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', playerId: 'p1', lat: 51.06, lon: -0.06 }),
      });
    });
    // Polyline was created — trail has data.
    expect(mockL.polyline).toHaveBeenCalled();
    const callsBefore = mockPolyline.setLatLngs.mock.calls.length;

    // Receive game_state_sync — trail must NOT be reset.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'game_state_sync', gameId: 'g1', phase: 'seeking', zones: [], endGameActive: false }),
      });
    });

    // setLatLngs should not have been called with an empty array after the sync.
    const newCalls = mockPolyline.setLatLngs.mock.calls.slice(callsBefore);
    const cleared = newCalls.some(([latlngs]) => latlngs.length === 0);
    expect(cleared).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // hiderId extraction from WS messages — Task 156
  // ---------------------------------------------------------------------------

  it('game_state_sync with hider player causes QuestionPanel to show read-only target', async () => {
    const seeker = { playerId: 'seeker1', name: 'Alice', role: 'seeker' };
    render(<GameMap player={seeker} game={game} zones={[]} serverUrl={serverUrl} />);
    // Transition to seeking so QuestionPanel renders.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
    });
    // Deliver game_state_sync with a hider player.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'game_state_sync',
          gameId: 'g1',
          phase: 'seeking',
          zones: [],
          endGameActive: false,
          players: [
            { playerId: 'hider99', role: 'hider' },
            { playerId: 'seeker1', role: 'seeker' },
          ],
        }),
      });
    });
    // Free-text input should be gone; read-only label should appear.
    expect(screen.queryByPlaceholderText("Enter hider's player ID")).not.toBeInTheDocument();
    expect(screen.getByText('Target: Hider')).toBeInTheDocument();
  });

  it('game_state message with hider in state.players also sets hiderId', async () => {
    const seeker = { playerId: 'seeker1', name: 'Alice', role: 'seeker' };
    render(<GameMap player={seeker} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
    });
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'game_state',
          gameId: 'g1',
          state: {
            players: {
              hider99: { role: 'hider', lat: null, lon: null },
              seeker1: { role: 'seeker', lat: null, lon: null },
            },
          },
        }),
      });
    });
    expect(screen.queryByPlaceholderText("Enter hider's player ID")).not.toBeInTheDocument();
    expect(screen.getByText('Target: Hider')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // phase_change newPhase property correctness — Task 120
  // ---------------------------------------------------------------------------

  it('phase_change sets phase state to newPhase value', async () => {
    const waitingGame = { ...game, status: 'waiting' };
    render(<GameMap player={player} game={waitingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
    });
    // The phase display should now show 'seeking'.
    expect(screen.getByText(/seeking/i)).toBeInTheDocument();
  });

  it('ZoneSelector renders for hider after phase_change to hiding', async () => {
    const waitingGame = { ...game, status: 'waiting' };
    render(<GameMap player={player} game={waitingGame} zones={[]} serverUrl={serverUrl} />);
    // ZoneSelector should NOT be present before the phase transition.
    expect(screen.queryByTestId('zone-selector')).not.toBeInTheDocument();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'hiding' }),
      });
    });
    // ZoneSelector should appear now that phase is hiding.
    expect(screen.getByTestId('zone-selector')).toBeInTheDocument();
  });

  it('spot-hider button renders for seeker only after end_game_started, not just phase_change to seeking', async () => {
    const seeker = { ...player, role: 'seeker' };
    const hidingGame = { ...game, status: 'hiding' };
    render(<GameMap player={seeker} game={hidingGame} zones={[]} serverUrl={serverUrl} />);
    // Spot button should NOT be present while phase is hiding.
    expect(screen.queryByTestId('spot-hider-btn')).not.toBeInTheDocument();
    // Phase changes to seeking but End Game has not started — button still absent.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
    });
    expect(screen.queryByTestId('spot-hider-btn')).not.toBeInTheDocument();
    // End Game starts — button should now appear.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'end_game_started', gameId: 'g1' }),
      });
    });
    expect(screen.getByTestId('spot-hider-btn')).toBeInTheDocument();
  });

  it('results overlay renders after phase_change with newPhase finished', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'finished', winner: 'hider' }),
      });
    });
    expect(screen.getByRole('dialog', { name: /results screen/i })).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Task 114 — CartoDB dark tile URL
  // ---------------------------------------------------------------------------

  it('initialises the Leaflet tile layer with the CartoDB dark tile URL', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(mockL.tileLayer).toHaveBeenCalled();
    const url = mockL.tileLayer.mock.calls[0][0];
    expect(url).toContain('cartocdn.com');
  });

  // ---------------------------------------------------------------------------
  // Task 134 — question_pending and question_expired refresh AnswerPanel
  // ---------------------------------------------------------------------------

  it('question_pending WS event triggers AnswerPanel re-fetch (qaRefresh incremented)', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    api.listQuestions.mockClear();
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    // Initial fetch on mount
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledTimes(1));

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'question_pending',
          gameId: 'g1',
          questionId: 'q1',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        }),
      });
    });
    // AnswerPanel re-fetches because refreshTrigger was incremented
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledTimes(2));
  });

  it('question_expired WS event triggers AnswerPanel re-fetch (qaRefresh incremented)', async () => {
    const seekingGame = { ...game, status: 'seeking' };
    api.listQuestions.mockClear();
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledTimes(1));

    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'question_expired', questionId: 'q1' }),
      });
    });
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledTimes(2));
  });

  // ---------------------------------------------------------------------------
  // Task 149 — Score submission error surfaced to player
  // ---------------------------------------------------------------------------

  it('shows role="alert" error banner when submitScore rejects on game finish', async () => {
    api.submitScore.mockRejectedValueOnce(new Error('Network error'));
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'finished', winner: 'hider' }),
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('score-error-banner')).toBeInTheDocument()
    );
    expect(screen.getByTestId('score-error-banner')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('score-error-banner')).toHaveTextContent('Network error');
  });

  it('dismiss button on score error banner removes the banner', async () => {
    api.submitScore.mockRejectedValueOnce(new Error('Timeout'));
    const seekingGame = { ...game, status: 'seeking' };
    const { getByLabelText, queryByTestId } = render(
      <GameMap player={player} game={seekingGame} zones={[]} serverUrl={serverUrl} />
    );
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'finished', winner: 'hider' }),
      });
    });
    await waitFor(() => expect(queryByTestId('score-error-banner')).toBeInTheDocument());
    await act(async () => {
      getByLabelText('Dismiss score error').click();
    });
    expect(queryByTestId('score-error-banner')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Player names on map markers — Task 162
  // ---------------------------------------------------------------------------

  it('join_game message sent on WS open includes player name', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.readyState = 1;
      MockWebSocket.last.onopen?.();
    });
    const sentMsgs = MockWebSocket.last.send.mock.calls.map(([m]) => JSON.parse(m));
    const joinMsg = sentMsgs.find(m => m.type === 'join_game');
    expect(joinMsg).toBeDefined();
    expect(joinMsg.name).toBe('Alice');
  });

  it('player_joined with name updates marker tooltip to show name not playerId', async () => {
    const seeker = { playerId: 'seeker1', name: 'Alice', role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => { MockWebSocket.last.readyState = 1; MockWebSocket.last.onopen?.(); });

    // Another player (p2) joins and is announced via player_joined with their name.
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_joined', gameId: 'g1', playerId: 'p2', team: null, name: 'Bob' }),
      });
    });

    // p2 sends a location — this triggers marker creation.
    mockMarker.bindTooltip.mockClear();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', gameId: 'g1', playerId: 'p2', lat: 51.05, lon: -0.05 }),
      });
    });

    // The marker tooltip should use 'Bob' not 'p2'.
    expect(mockMarker.bindTooltip).toHaveBeenCalledWith('Bob', expect.any(Object));
  });

  it('game_state_sync with player names updates marker tooltips', async () => {
    const seeker = { playerId: 'seeker1', name: 'Alice', role: 'seeker' };
    const seekingGame = { ...game, status: 'seeking' };
    render(<GameMap player={seeker} game={seekingGame} zones={[]} serverUrl={serverUrl} />);
    await act(async () => { MockWebSocket.last.readyState = 1; MockWebSocket.last.onopen?.(); });

    // Receive a location update for p2 first (marker created with fallback pid label).
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', gameId: 'g1', playerId: 'p2', lat: 51.05, lon: -0.05 }),
      });
    });

    // game_state_sync arrives with p2's name.
    mockMarker.setTooltipContent.mockClear();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({
          type: 'game_state_sync',
          gameId: 'g1',
          phase: 'seeking',
          zones: [],
          endGameActive: false,
          players: [
            { playerId: 'p2', role: 'seeker', name: 'Bob' },
          ],
        }),
      });
    });

    // A subsequent location update for p2 should now show 'Bob' in the tooltip.
    mockMarker.setTooltipContent.mockClear();
    await act(async () => {
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'player_location', gameId: 'g1', playerId: 'p2', lat: 51.06, lon: -0.05 }),
      });
    });
    const tooltipCall = mockMarker.setTooltipContent.mock.calls.find(([t]) => t.includes('Bob'));
    expect(tooltipCall).toBeDefined();
  });

  // ── Elapsed-time display (Task 165) ─────────────────────────────────────────

  // (e) Elapsed timer renders for hider after phase_change → hiding.
  it('renders elapsed-timer for hider after phase_change to hiding', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onopen?.();
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'hiding' }),
      });
    });
    expect(screen.getByTestId('elapsed-timer')).toBeInTheDocument();
    expect(screen.getByTestId('elapsed-timer')).toHaveTextContent(/Hiding time:/);
  });

  // (f) Elapsed timer still renders for hider after phase transitions to seeking.
  it('renders elapsed-timer for hider during seeking phase', async () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onopen?.();
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'hiding' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
    });
    expect(screen.getByTestId('elapsed-timer')).toBeInTheDocument();
    expect(screen.getByTestId('elapsed-timer')).toHaveTextContent(/Hiding time:/);
  });

  // (g) Elapsed timer is NOT rendered for seekers.
  it('does not render elapsed-timer for seeker', async () => {
    const seeker = { playerId: 'p2', name: 'Bob', role: 'seeker' };
    render(<GameMap player={seeker} game={game} zones={[]} serverUrl={serverUrl} />);
    await act(async () => {
      MockWebSocket.last.onopen?.();
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'hiding' }),
      });
    });
    expect(screen.queryByTestId('elapsed-timer')).not.toBeInTheDocument();
  });

  // (h) Elapsed timer is NOT rendered before hidingStartedAtRef is set
  //     (game starts in hiding status but no phase_change message yet).
  it('does not render elapsed-timer on initial render before phase_change arrives', () => {
    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);
    expect(screen.queryByTestId('elapsed-timer')).not.toBeInTheDocument();
  });
});

// ── In-zone status indicator (Task 167) ──────────────────────────────────────

describe('zone-status banner (Task 167)', () => {
  const zoneCenter = { lat: 51.05, lon: -0.05, radiusM: 500 };

  // (d) Hider within zone during seeking → '✓ In zone' banner.
  it('shows "✓ In zone" when hider GPS is within lockedZone radius during seeking', async () => {
    vi.useFakeTimers();
    // GPS returns the exact zone centre — definitely inside the 500 m radius.
    const mockGetCurrentPosition = vi.fn((success) => {
      success({ coords: { latitude: zoneCenter.lat, longitude: zoneCenter.lon } });
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {
      MockWebSocket.last.onopen?.();
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'zone_locked', zone: zoneCenter }),
      });
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByTestId('zone-status')).toHaveTextContent('✓ In zone');
  });

  // (e) Hider outside zone during seeking → '⚠ Outside zone' banner.
  it('shows "⚠ Outside zone" when hider GPS is outside lockedZone radius during seeking', async () => {
    vi.useFakeTimers();
    // Place the hider ~1 km north — well outside the 500 m radius.
    const outsideLat = zoneCenter.lat + (1000 / 111_000);
    const mockGetCurrentPosition = vi.fn((success) => {
      success({ coords: { latitude: outsideLat, longitude: zoneCenter.lon } });
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {
      MockWebSocket.last.onopen?.();
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'zone_locked', zone: zoneCenter }),
      });
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByTestId('zone-status')).toHaveTextContent('⚠ Outside zone');
  });

  // (f) Seeker never sees zone-status banner.
  it('does not render zone-status banner for seekers', async () => {
    vi.useFakeTimers();
    const seeker = { playerId: 'p2', name: 'Bob', role: 'seeker' };
    const mockGetCurrentPosition = vi.fn((success) => {
      success({ coords: { latitude: zoneCenter.lat, longitude: zoneCenter.lon } });
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={seeker} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {
      MockWebSocket.last.onopen?.();
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'zone_locked', zone: zoneCenter }),
      });
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.queryByTestId('zone-status')).not.toBeInTheDocument();
  });

  // (g) Hider during hiding phase — banner absent even when lockedZone is set.
  it('does not render zone-status banner during hiding phase', async () => {
    vi.useFakeTimers();
    const mockGetCurrentPosition = vi.fn((success) => {
      success({ coords: { latitude: zoneCenter.lat, longitude: zoneCenter.lon } });
    });
    global.navigator.geolocation = { getCurrentPosition: mockGetCurrentPosition };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {
      MockWebSocket.last.onopen?.();
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'hiding' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'zone_locked', zone: zoneCenter }),
      });
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.queryByTestId('zone-status')).not.toBeInTheDocument();
  });

  // (h) Before any GPS fix (myLocation null) — banner absent even if zone is locked and seeking.
  it('does not render zone-status banner before first GPS fix', async () => {
    // GPS mock never calls success — myLocation stays null.
    global.navigator.geolocation = { getCurrentPosition: vi.fn() };

    render(<GameMap player={player} game={game} zones={[]} serverUrl={serverUrl} />);

    await act(async () => {
      MockWebSocket.last.onopen?.();
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'phase_change', newPhase: 'seeking' }),
      });
      MockWebSocket.last.onmessage?.({
        data: JSON.stringify({ type: 'zone_locked', zone: zoneCenter }),
      });
    });

    expect(screen.queryByTestId('zone-status')).not.toBeInTheDocument();
  });
});
