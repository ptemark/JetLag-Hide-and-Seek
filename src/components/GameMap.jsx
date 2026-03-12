import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import QuestionPanel from './QuestionPanel.jsx';
import AnswerPanel from './AnswerPanel.jsx';
import CardPanel from './CardPanel.jsx';
import ZoneSelector from './ZoneSelector.jsx';
import ResultsScreen from './ResultsScreen.jsx';
import { submitScore } from '../api.js';

const LOCATION_INTERVAL_MS = 10_000;
const TIMER_TICK_MS = 1_000;
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const MAX_RECONNECT_ATTEMPTS = 6; // 1 s, 2 s, 4 s, 8 s, 16 s, 30 s

/**
 * Format a future ISO timestamp as a MM:SS countdown string.
 * Returns '0:00' if the deadline has passed, or null if iso is falsy.
 * @param {string|null} iso
 */
function formatCountdown(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return '0:00';
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Compute the centre {lat, lng} of a bounds object.
 * @param {{ lat_min, lat_max, lon_min, lon_max }} bounds
 */
function boundsCenter(bounds) {
  return {
    lat: (bounds.lat_min + bounds.lat_max) / 2,
    lng: (bounds.lon_min + bounds.lon_max) / 2,
  };
}

/**
 * GameMap — shows the Leaflet/OSM map for an active game.
 *
 * Props:
 *   player       — { playerId, name, role }
 *   game         — { gameId, size, status, bounds: { lat_min, lat_max, lon_min, lon_max } }
 *   zones        — array of { stationId, name, lat, lon, radiusM } transit zones (optional)
 *   serverUrl    — WebSocket server base URL (e.g. "ws://localhost:3001")
 *   onPlayAgain  — callback invoked when the player taps "Play Again" on the results screen
 *
 * Responsibilities:
 *   - Render an OSM Leaflet map centred on game bounds.
 *   - Draw a rectangle overlay for game bounds.
 *   - Draw circle overlays for hiding zones.
 *   - Connect to the managed game server via WebSocket.
 *   - Poll GPS every 10 s and send location_update messages.
 *   - Receive player_location / game_state / phase_change / capture /
 *     question_answered / zone_locked messages.
 *   - Update player markers on state change; redraw only when data changes.
 *   - Render ZoneSelector for hiders during hiding phase (before zone is locked).
 *   - Render QuestionPanel for seekers and AnswerPanel for hiders below the map.
 *   - Show full-screen ResultsScreen when phase transitions to 'finished'.
 */
export default function GameMap({ player, game, zones = [], serverUrl, onPlayAgain }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});          // { [playerId]: L.circleMarker }
  const falseZoneLayersRef = useRef({}); // { [decoyId]: L.circle }
  const wsRef = useRef(null);
  const hidingStartedAtRef = useRef(null); // timestamp (ms) when hiding phase began
  const bonusSecondsRef = useRef(0);       // accumulated time_bonus card seconds
  const captureWinnerRef = useRef(null);   // winner string from capture event (avoids stale closure)

  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);

  const [players, setPlayers] = useState({});      // { [playerId]: { lat, lon, team?, onTransit? } }
  const [myTeam, setMyTeam] = useState(null);       // 'A' | 'B' | null (assigned by server in two-team mode)
  const [myOnTransit, setMyOnTransit] = useState(false); // true when this seeker is on transit
  const [phase, setPhase] = useState(game.status);
  const [captureMsg, setCaptureMsg] = useState(null);
  const [qaRefresh, setQaRefresh] = useState(0);   // increments on question_answered WS event
  const [lockedZone, setLockedZone] = useState(null); // zone locked by hider
  const [phaseEndsAt, setPhaseEndsAt] = useState(null);           // ISO from timer_sync
  const [pendingQuestionExpiresAt, setPendingQuestionExpiresAt] = useState(null); // ISO from question_pending
  const [, setTimerTick] = useState(0); // incremented each second to refresh countdown display
  const [gameResult, setGameResult] = useState(null); // { winner, elapsedMs, bonusSeconds, captureTeam? } on finish
  const [wsStatus, setWsStatus] = useState('connecting'); // 'connecting' | 'connected' | 'reconnecting'
  const [curseEndsAt, setCurseEndsAt] = useState(null);   // ISO from curse_active; null when inactive
  const [falseZones, setFalseZones] = useState([]);        // [{ decoyId, zone }] — active decoy zones
  const [spotResult, setSpotResult] = useState(null);      // null | 'pending' | 'confirmed' | 'rejected'

  // ── Initialise Leaflet map ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const bounds = game.bounds ?? {};
    const center = boundsCenter(bounds);
    const map = L.map(mapContainerRef.current).setView([center.lat, center.lng], 13);

    L.tileLayer(OSM_TILE_URL, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    // Game bounds rectangle
    if (bounds.lat_min != null) {
      L.rectangle(
        [[bounds.lat_min, bounds.lon_min], [bounds.lat_max, bounds.lon_max]],
        { color: '#3388ff', weight: 2, fill: false },
      ).addTo(map);
    }

    // Hiding zone circles
    for (const zone of zones) {
      L.circle([zone.lat, zone.lon], {
        radius: zone.radius,
        color: '#ff7800',
        fillColor: '#ff7800',
        fillOpacity: 0.15,
        weight: 1,
      }).addTo(map);
    }

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 1-second countdown tick to refresh timer display ──────────────────────
  useEffect(() => {
    const id = setInterval(() => setTimerTick((n) => n + 1), TIMER_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ── Update player markers when players state changes ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Colour palette: Team A = blue, Team B = green, no team / hider = red.
    function markerColor(pid, team) {
      if (pid === player.playerId) return '#0000ff';
      if (team === 'A') return '#1d6db5';
      if (team === 'B') return '#16a34a';
      return '#cc0000';
    }

    // Add or move existing markers
    for (const [pid, pos] of Object.entries(players)) {
      if (markersRef.current[pid]) {
        markersRef.current[pid].setLatLng([pos.lat, pos.lon]);
      } else {
        const isMe = pid === player.playerId;
        const color = markerColor(pid, pos.team ?? null);
        const isOnTransit = pos.onTransit ?? false;
        const transitIcon = isOnTransit ? ' 🚌' : '';
        const baseLabel = isMe ? `You${myTeam ? ` (Team ${myTeam})` : ''}` : pid;
        const label = `${baseLabel}${transitIcon}`;
        markersRef.current[pid] = L.circleMarker([pos.lat, pos.lon], {
          radius: isMe ? 10 : 7,
          color,
          fillColor: color,
          fillOpacity: isOnTransit ? 0.3 : 0.7,
        })
          .bindTooltip(label, { permanent: false })
          .addTo(map);
      }
    }

    // Remove stale markers
    for (const pid of Object.keys(markersRef.current)) {
      if (!players[pid]) {
        markersRef.current[pid].remove();
        delete markersRef.current[pid];
      }
    }
  }, [players, player.playerId, myTeam]);

  // ── Render/remove false zone (decoy) circles on the map ───────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Add circles for new decoy zones.
    for (const { decoyId, zone } of falseZones) {
      if (!falseZoneLayersRef.current[decoyId]) {
        const circle = L.circle([zone.lat, zone.lon], {
          radius: zone.radiusM ?? zone.radius ?? 500,
          color: '#8b5cf6',
          fillColor: '#8b5cf6',
          fillOpacity: 0.1,
          weight: 2,
          dashArray: '6, 6',
        });
        // Hider sees their own decoy labeled; seekers see it as an unlabeled zone.
        if (player.role === 'hider') {
          circle.bindTooltip('Your decoy', { permanent: true, className: 'decoy-tooltip' });
        }
        circle.addTo(map);
        falseZoneLayersRef.current[decoyId] = circle;
      }
    }

    // Remove circles for expired decoy zones.
    for (const decoyId of Object.keys(falseZoneLayersRef.current)) {
      if (!falseZones.find((fz) => fz.decoyId === decoyId)) {
        falseZoneLayersRef.current[decoyId].remove();
        delete falseZoneLayersRef.current[decoyId];
      }
    }
  }, [falseZones, player.role]);

  // ── WebSocket connection with exponential backoff reconnect ───────────────
  useEffect(() => {
    if (!serverUrl) return;

    let isMounted = true;

    function handleMessage(evt) {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      if (msg.type === 'joined_game' && msg.playerId === player.playerId) {
        setWsStatus('connected');
        // Server may assign a team in two-team mode.
        if (msg.team) setMyTeam(msg.team);
      } else if (msg.type === 'player_location') {
        setPlayers((prev) => ({
          ...prev,
          [msg.playerId]: { lat: msg.lat, lon: msg.lon },
        }));
      } else if (msg.type === 'game_state') {
        const positions = {};
        for (const p of msg.players ?? []) {
          if (p.lat != null && p.lon != null) {
            positions[p.playerId] = { lat: p.lat, lon: p.lon };
          }
        }
        setPlayers(positions);
      } else if (msg.type === 'phase_change') {
        setPhase(msg.phase);
        setPendingQuestionExpiresAt(null); // phase change clears any pending question timer
        if (msg.newPhase === 'hiding' || msg.phase === 'hiding') {
          hidingStartedAtRef.current = Date.now();
        }
        if (msg.newPhase === 'finished' || msg.phase === 'finished') {
          const elapsedMs = hidingStartedAtRef.current
            ? Date.now() - hidingStartedAtRef.current
            : 0;
          const winner = msg.winner ?? captureWinnerRef.current ?? 'hider';
          setGameResult({ winner, elapsedMs, bonusSeconds: bonusSecondsRef.current });
          submitScore({
            playerId: player.playerId,
            gameId: game.gameId,
            hidingTimeMs: elapsedMs,
            captured: winner === 'seekers',
            bonusSeconds: bonusSecondsRef.current,
          }).catch(() => { /* fire-and-forget */ });
        }
      } else if (msg.type === 'capture') {
        captureWinnerRef.current = msg.winner ?? 'seekers';
        const teamLabel = msg.captureTeam ? ` (Team ${msg.captureTeam})` : '';
        setCaptureMsg(msg.winner === 'seekers' ? `Seekers win!${teamLabel}` : 'Hiders win!');
      } else if (msg.type === 'question_answered') {
        setQaRefresh((n) => n + 1);
        setPendingQuestionExpiresAt(null);
      } else if (msg.type === 'question_expired') {
        setPendingQuestionExpiresAt(null);
      } else if (msg.type === 'zone_locked') {
        setLockedZone(msg.zone ?? null);
      } else if (msg.type === 'player_transit') {
        setPlayers((prev) => {
          const existing = prev[msg.playerId];
          if (!existing) return prev;
          return { ...prev, [msg.playerId]: { ...existing, onTransit: !!msg.onTransit } };
        });
      } else if (msg.type === 'timer_sync') {
        setPhaseEndsAt(msg.phaseEndsAt ?? null);
      } else if (msg.type === 'question_pending') {
        setPendingQuestionExpiresAt(msg.expiresAt ?? null);
      } else if (msg.type === 'curse_active') {
        setCurseEndsAt(msg.curseEndsAt ?? null);
      } else if (msg.type === 'false_zone' && msg.zone) {
        setFalseZones((prev) => [...prev, { decoyId: msg.zone.decoyId, zone: msg.zone }]);
      } else if (msg.type === 'false_zone_expired') {
        setFalseZones((prev) => prev.filter((fz) => fz.decoyId !== msg.decoyId));
      } else if (msg.type === 'spot_confirmed') {
        setSpotResult('confirmed');
      } else if (msg.type === 'spot_rejected') {
        setSpotResult('rejected');
      }
    }

    function connect() {
      if (!isMounted) return;

      const url = `${serverUrl}?playerId=${encodeURIComponent(player.playerId)}&gameId=${encodeURIComponent(game.gameId)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        // Register with the game server so the player is added to game broadcasts.
        ws.send(JSON.stringify({
          type: 'join_game',
          gameId: game.gameId,
          role: player.role,
        }));
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        if (!isMounted) return;
        wsRef.current = null;
        const attempts = reconnectAttemptsRef.current;
        if (attempts >= MAX_RECONNECT_ATTEMPTS) return; // give up
        const delayMs = Math.min(1_000 * Math.pow(2, attempts), 30_000);
        reconnectAttemptsRef.current = attempts + 1;
        setWsStatus('reconnecting');
        reconnectTimerRef.current = setTimeout(connect, delayMs);
      };
    }

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect loop on intentional unmount
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [player.playerId, game.gameId, serverUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GPS polling — throttled to LOCATION_INTERVAL_MS ───────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;

    const send = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'location_update',
              gameId: game.gameId,
              playerId: player.playerId,
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
            }));
          }
        },
        () => {}, // ignore position errors silently
      );
    };

    // Send immediately on mount, then every LOCATION_INTERVAL_MS
    send();
    const id = setInterval(send, LOCATION_INTERVAL_MS);
    return () => clearInterval(id);
  }, [player.playerId, game.gameId]);

  return (
    <div aria-label="Game map">
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
        <span>
          Game: <code>{game.gameId}</code> · Phase: <strong>{phase}</strong>
        </span>
        <span>
          {player.name} ({player.role}){myTeam ? ` · Team ${myTeam}` : ''}
        </span>
      </div>

      {wsStatus === 'reconnecting' && (
        <p role="status" data-testid="reconnecting-banner" style={{ background: '#fee2e2', padding: '0.25rem 0.5rem' }}>
          Reconnecting…
        </p>
      )}

      {captureMsg && (
        <p role="alert" style={{ background: '#ffe', padding: '0.5rem', fontWeight: 'bold' }}>
          {captureMsg}
        </p>
      )}

      {pendingQuestionExpiresAt ? (
        <p data-testid="timer-banner" style={{ background: '#fef3c7', padding: '0.25rem 0.5rem' }}>
          Question expires in {formatCountdown(pendingQuestionExpiresAt)}
        </p>
      ) : phaseEndsAt && (phase === 'hiding' || phase === 'seeking') ? (
        <p data-testid="timer-banner" style={{ background: '#e0f2fe', padding: '0.25rem 0.5rem' }}>
          {phase === 'hiding' ? 'Hiding ends in' : 'Seeking ends in'} {formatCountdown(phaseEndsAt)}
        </p>
      ) : null}

      <div
        ref={mapContainerRef}
        data-testid="map-container"
        style={{ height: '60vh', width: '100%', border: '1px solid #ccc' }}
      />

      {player.role === 'seeker' && phase === 'seeking' && (
        <div style={{ padding: '0.5rem 0' }}>
          <button
            data-testid="transit-toggle"
            onClick={() => {
              const next = !myOnTransit;
              setMyOnTransit(next);
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'set_transit',
                  gameId: game.gameId,
                  playerId: player.playerId,
                  onTransit: next,
                }));
              }
            }}
            style={{
              background: myOnTransit ? '#fbbf24' : '#d1fae5',
              border: '1px solid #999',
              borderRadius: '0.375rem',
              padding: '0.375rem 0.75rem',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            {myOnTransit ? '🚌 On Transit' : '🚶 Off Transit'}
          </button>
        </div>
      )}

      {player.role === 'seeker' && phase === 'seeking' && (
        <div style={{ padding: '0.5rem 0' }}>
          <button
            data-testid="spot-hider-btn"
            disabled={spotResult === 'pending' || spotResult === 'confirmed'}
            onClick={() => {
              setSpotResult('pending');
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'spot_hider',
                  gameId: game.gameId,
                  playerId: player.playerId,
                }));
              }
            }}
            style={{
              background: spotResult === 'confirmed' ? '#bbf7d0'
                : spotResult === 'rejected'  ? '#fee2e2'
                : '#fef9c3',
              border: '1px solid #999',
              borderRadius: '0.375rem',
              padding: '0.375rem 0.75rem',
              cursor: spotResult === 'pending' || spotResult === 'confirmed' ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {spotResult === 'confirmed' ? 'Hider Spotted!' : spotResult === 'rejected' ? 'Not Close Enough' : 'I See the Hider!'}
          </button>
          {spotResult === 'rejected' && (
            <span data-testid="spot-rejected-msg" style={{ marginLeft: '0.5rem', color: '#b91c1c', fontSize: '0.875rem' }}>
              You are not close enough to the hider yet.
            </span>
          )}
        </div>
      )}

      {player.role === 'seeker' && (
        <QuestionPanel player={player} game={game} qaRefresh={qaRefresh} curseEndsAt={curseEndsAt} />
      )}

      {player.role === 'hider' && phase === 'hiding' && !lockedZone && (
        <ZoneSelector
          player={player}
          game={game}
          zones={zones}
          onZoneLocked={(zone) => setLockedZone(zone)}
        />
      )}

      {player.role === 'hider' && (
        <AnswerPanel player={player} game={game} refreshTrigger={qaRefresh} />
      )}

      {player.role === 'hider' && (
        <CardPanel
          player={player}
          game={game}
          refreshTrigger={qaRefresh}
          onTimeBonusPlayed={(mins) => { bonusSecondsRef.current += mins * 60; }}
        />
      )}

      {gameResult && (
        <ResultsScreen
          winner={gameResult.winner}
          elapsedMs={gameResult.elapsedMs}
          bonusSeconds={gameResult.bonusSeconds}
          onPlayAgain={onPlayAgain}
        />
      )}
    </div>
  );
}
