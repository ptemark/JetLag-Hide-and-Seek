import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import QuestionPanel from './QuestionPanel.jsx';
import AnswerPanel from './AnswerPanel.jsx';
// Lazy-load non-critical game panels (RALPH.md §Performance / Mobile)
const CardPanel = lazy(() => import('./CardPanel.jsx'));
const ResultsScreen = lazy(() => import('./ResultsScreen.jsx'));
import ZoneSelector from './ZoneSelector.jsx';
import { submitScore, listZones } from '../api.js';
import { formatCountdown, formatDuration } from './gameUtils.js';
import styles from './GameMap.module.css';

const LOCATION_INTERVAL_MS = 10_000;
const TIMER_TICK_MS = 1_000;
const MAX_TRAIL_POINTS = 500;
// CartoDB dark tiles — free OSM-based dark palette, no API key required (DESIGN.md §7)
const CARTO_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';
// Brand colours for Leaflet API options (DESIGN.md §22) — must be literals, not CSS vars
const ZONE_COLOR = '#F08730';          // --color-sunset-2 / --color-accent
const ZONE_FILL = 'rgba(240,135,48,0.15)';
const SEEKER_MARKER_COLOR = '#F08730'; // --color-accent
const HIDER_MARKER_COLOR = '#C83A18';  // --color-sunset-4 (End Game only)
const BOUNDS_BORDER_COLOR = '#9EB3C8'; // --color-text-secondary — subtle game-area outline on dark map
const FALSE_ZONE_COLOR = '#9EB3C8';    // --color-text-secondary — muted decoy circle (distinct from real zones)
const TRAIL_COLOR = '#F5C84A';         // --color-sunset-1 — warm yellow hider journey trail
const MAX_RECONNECT_ATTEMPTS = 6; // 1 s, 2 s, 4 s, 8 s, 16 s, 30 s
// RULES.md §End Game: seekers must be off transit to spot the hider.
const SPOT_ON_TRANSIT_LABEL = 'Board off transit to spot';

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
  const trailPolylineRef = useRef(null); // L.Polyline for hider journey trail
  const wsRef = useRef(null);
  // Tracks each player's role so End Game hider markers use the correct colour.
  const playerRolesRef = useRef({ [player.playerId]: player.role });
  // Tracks each player's display name for map marker tooltips.
  const playerNamesRef = useRef({ [player.playerId]: player.name });
  const hidingStartedAtRef = useRef(null); // timestamp (ms) when hiding phase began
  const bonusSecondsRef = useRef(0);       // accumulated time_bonus card seconds
  const captureWinnerRef = useRef(null);   // winner string from capture event (avoids stale closure)

  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const endGameActiveRef = useRef(false); // true when End Game is active (hider must not move)

  const [players, setPlayers] = useState({});      // { [playerId]: { lat, lon, team?, onTransit? } }
  const [myTeam, setMyTeam] = useState(null);       // 'A' | 'B' | null (assigned by server in two-team mode)
  const [myOnTransit, setMyOnTransit] = useState(false); // true when this seeker is on transit
  const [endGameActive, setEndGameActive] = useState(false); // true when End Game is in progress
  const [phase, setPhase] = useState(game.status);
  const [captureMsg, setCaptureMsg] = useState(null);
  const [qaRefresh, setQaRefresh] = useState(0);   // increments on question_answered / question_pending / question_expired WS events
  const [lockedZone, setLockedZone] = useState(null); // zone locked by hider
  const [phaseEndsAt, setPhaseEndsAt] = useState(null);           // ISO from timer_sync
  const [pendingQuestionExpiresAt, setPendingQuestionExpiresAt] = useState(null); // ISO from question_pending
  const [, setTimerTick] = useState(0); // incremented each second to refresh countdown display
  const [gameResult, setGameResult] = useState(null); // { winner, elapsedMs, bonusSeconds, captureTeam? } on finish
  const [wsStatus, setWsStatus] = useState('connecting'); // 'connecting' | 'connected' | 'reconnecting'
  const [curseEndsAt, setCurseEndsAt] = useState(null);   // ISO from curse_active; null when inactive
  const [falseZones, setFalseZones] = useState([]);        // [{ decoyId, zone }] — active decoy zones
  const [spotResult, setSpotResult] = useState(null);      // null | 'pending' | 'confirmed' | 'rejected'
  const [spotDistance, setSpotDistance] = useState({ distanceM: null, spotRadiusM: null }); // from spot_rejected
  const [locationTrail, setLocationTrail] = useState([]); // [{lat, lon}] hider's own route (hider only)
  const [joinError, setJoinError] = useState(null);       // error message when server rejects join
  const [outOfZone, setOutOfZone] = useState(false);      // hider is outside their hiding zone (hider view)
  const [hiderOutOfZone, setHiderOutOfZone] = useState(false); // hider left zone (seeker view)
  const [movementLocked, setMovementLocked] = useState(false); // server blocked hider movement (End Game)
  const [cardRefresh, setCardRefresh] = useState(0);          // increments on card_drawn WS event for this player
  const [locationRejected, setLocationRejected] = useState(false); // server rejected location as out of bounds
  const [syncedZones, setSyncedZones] = useState(zones);           // locked zone from game_state_sync (for map circle)
  const [availableZones, setAvailableZones] = useState([]);        // transit stations fetched from /api/zones
  const [zonesError, setZonesError] = useState(null);              // error fetching transit zones
  const [gpsError, setGpsError] = useState(null);                  // GPS permission/availability error message
  const [scoreError, setScoreError] = useState(null);              // score submission failure message
  const [hiderId, setHiderId] = useState(null);                    // playerId of the hider in this game
  const lockedZoneLayerRef = useRef(null);                         // L.circle for the hider's locked zone

  // ── Initialise Leaflet map ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const bounds = game.bounds ?? {};
    const center = boundsCenter(bounds);
    const map = L.map(mapContainerRef.current).setView([center.lat, center.lng], 13);

    L.tileLayer(CARTO_TILE_URL, {
      attribution: CARTO_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    // Game bounds rectangle
    if (bounds.lat_min != null) {
      L.rectangle(
        [[bounds.lat_min, bounds.lon_min], [bounds.lat_max, bounds.lon_max]],
        { color: BOUNDS_BORDER_COLOR, weight: 2, fill: false },
      ).addTo(map);
    }

    // Hiding zone circles — brand colours per DESIGN.md §22
    for (const zone of zones) {
      L.circle([zone.lat, zone.lon], {
        radius: zone.radius,
        color: ZONE_COLOR,
        fillColor: ZONE_FILL,
        fillOpacity: 1,
        weight: 2,
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

    // Hider markers use --color-sunset-4 during End Game; all other visible positions
    // use --color-accent (seeker orange). Values are Leaflet API literals (not CSS vars).
    function markerColor(pid) {
      const role = playerRolesRef.current[pid];
      if (role === 'hider' && endGameActiveRef.current) return HIDER_MARKER_COLOR;
      return SEEKER_MARKER_COLOR;
    }

    // Add or move existing markers
    for (const [pid, pos] of Object.entries(players)) {
      if (markersRef.current[pid]) {
        const isMe = pid === player.playerId;
        const isOnTransit = pos.onTransit ?? false;
        const transitIcon = isOnTransit ? ' 🚌' : '';
        const displayName = isMe ? `You${myTeam ? ` (Team ${myTeam})` : ''}` : (playerNamesRef.current[pid] ?? pid);
        const label = `${displayName}${transitIcon}`;
        markersRef.current[pid].setLatLng([pos.lat, pos.lon]);
        markersRef.current[pid].setStyle({ fillOpacity: isOnTransit ? 0.3 : 0.7 });
        markersRef.current[pid].setTooltipContent(label);
      } else {
        const isMe = pid === player.playerId;
        const color = markerColor(pid);
        const isOnTransit = pos.onTransit ?? false;
        const transitIcon = isOnTransit ? ' 🚌' : '';
        const displayName = isMe ? `You${myTeam ? ` (Team ${myTeam})` : ''}` : (playerNamesRef.current[pid] ?? pid);
        const label = `${displayName}${transitIcon}`;
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
          color: FALSE_ZONE_COLOR,
          fillColor: FALSE_ZONE_COLOR,
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

  // ── Fetch transit stations for ZoneSelector when hider enters hiding phase ─
  useEffect(() => {
    if (phase !== 'hiding' || player.role !== 'hider') return;
    let cancelled = false;
    listZones({ scale: game.size, bounds: game.bounds })
      .then((zs) => { if (!cancelled) setAvailableZones(zs); })
      .catch((err) => { if (!cancelled) setZonesError(err.message); });
    return () => { cancelled = true; };
  // game.bounds is stable per gameId — changes with gameId, not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, player.role, game.gameId, game.size]);

  // ── Draw/update locked zone circle on the Leaflet map ─────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lockedZoneLayerRef.current) {
      lockedZoneLayerRef.current.remove();
      lockedZoneLayerRef.current = null;
    }
    if (lockedZone) {
      lockedZoneLayerRef.current = L.circle([lockedZone.lat, lockedZone.lon], {
        radius: lockedZone.radiusM ?? 500,
        color: ZONE_COLOR,
        fillColor: ZONE_FILL,
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
    }
  }, [lockedZone]);

  // ── Render hider journey trail polyline ───────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || player.role !== 'hider') return;

    const latlngs = locationTrail.map((p) => [p.lat, p.lon]);

    if (trailPolylineRef.current) {
      trailPolylineRef.current.setLatLngs(latlngs);
    } else if (latlngs.length >= 2) {
      trailPolylineRef.current = L.polyline(latlngs, {
        color: TRAIL_COLOR,
        weight: 3,
        opacity: 0.6,
        dashArray: null,
      }).addTo(map);
    }
  }, [locationTrail, player.role]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } else if (msg.type === 'player_joined' || msg.type === 'player_reconnected') {
        // Track the joining player's display name for map marker tooltips.
        if (msg.name) playerNamesRef.current[msg.playerId] = msg.name;
      } else if (msg.type === 'player_location') {
        setPlayers((prev) => ({
          ...prev,
          [msg.playerId]: { lat: msg.lat, lon: msg.lon },
        }));
        // Accumulate the hider's own route trail for transit/measuring question context.
        if (player.role === 'hider' && msg.playerId === player.playerId) {
          setLocationTrail((prev) => {
            const next = [...prev, { lat: msg.lat, lon: msg.lon }];
            return next.length > MAX_TRAIL_POINTS ? next.slice(next.length - MAX_TRAIL_POINTS) : next;
          });
        }
      } else if (msg.type === 'game_state') {
        // msg.state.players is { [playerId]: { role, lat, lon, ... } } (object, not array).
        const positions = {};
        for (const [pid, data] of Object.entries(msg.state?.players ?? {})) {
          if (data.lat != null && data.lon != null) {
            positions[pid] = { lat: data.lat, lon: data.lon };
          }
          if (data.role) {
            playerRolesRef.current[pid] = data.role;
          }
        }
        setPlayers(positions);
        // Extract hider ID for QuestionPanel auto-population.
        const hiderEntry = Object.entries(msg.state?.players ?? {}).find(([, d]) => d.role === 'hider');
        if (hiderEntry) setHiderId(hiderEntry[0]);
      } else if (msg.type === 'phase_change') {
        setPhase(msg.newPhase);
        setPendingQuestionExpiresAt(null); // phase change clears any pending question timer
        setOutOfZone(false);              // zone warnings reset on phase transition
        setHiderOutOfZone(false);
        setMovementLocked(false);
        if (msg.newPhase === 'hiding') {
          endGameActiveRef.current = false;
          setEndGameActive(false);
          hidingStartedAtRef.current = Date.now();
          if (player.role === 'hider') setLocationTrail([]); // fresh trail at hiding start
        }
        if (msg.newPhase === 'finished') {
          endGameActiveRef.current = false;
          setEndGameActive(false);
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
          }).catch((err) => {
            setScoreError(err?.message ?? 'Score could not be saved. Please check your connection.');
          });
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
        setQaRefresh((n) => n + 1);
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
        setQaRefresh((n) => n + 1);
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
        setSpotDistance({ distanceM: msg.distanceM ?? null, spotRadiusM: msg.spotRadiusM ?? null });
      } else if (msg.type === 'end_game_started') {
        endGameActiveRef.current = true;
        setEndGameActive(true);
        // DESIGN.md §6: seekers learn the hider's zone only at End Game start.
        if (msg.zone) setLockedZone(msg.zone);
      } else if (msg.type === 'zone_warning' && msg.code === 'HIDER_OUT_OF_ZONE') {
        setOutOfZone(true);
      } else if (msg.type === 'hider_out_of_zone') {
        setHiderOutOfZone(true);
      } else if (msg.type === 'movement_locked' && msg.code === 'END_GAME_ACTIVE') {
        setMovementLocked(true);
      } else if (msg.type === 'location_rejected' && msg.code === 'OUT_OF_BOUNDS') {
        setLocationRejected(true);
      } else if (msg.type === 'card_drawn' && msg.playerId === player.playerId) {
        setCardRefresh((n) => n + 1);
      } else if (msg.type === 'game_state_sync') {
        if (msg.phase != null) setPhase(msg.phase);
        if (Array.isArray(msg.zones)) setSyncedZones(msg.zones);
        if (msg.endGameActive != null) {
          endGameActiveRef.current = msg.endGameActive;
          setEndGameActive(msg.endGameActive);
        }
        // Extract hider ID for QuestionPanel auto-population; also populate player names.
        if (Array.isArray(msg.players)) {
          const hider = msg.players.find((p) => p.role === 'hider');
          if (hider) setHiderId(hider.playerId);
          for (const p of msg.players) {
            if (p.name) playerNamesRef.current[p.playerId] = p.name;
          }
        }
      } else if (msg.type === 'error') {
        setJoinError(msg.message ?? 'An error occurred');
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
        const joinMsg = {
          type: 'join_game',
          gameId: game.gameId,
          role: player.role,
          name: player.name,
        };
        if (game.bounds?.lat_min != null) {
          joinMsg.bounds = {
            latMin: game.bounds.lat_min,
            latMax: game.bounds.lat_max,
            lonMin: game.bounds.lon_min,
            lonMax: game.bounds.lon_max,
          };
        }
        ws.send(JSON.stringify(joinMsg));
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
    if (!navigator.geolocation) {
      setGpsError('Your device does not support location access — this game requires GPS.');
      return;
    }

    const handleGpsError = (err) => {
      if (err.code === 1 /* PERMISSION_DENIED */) {
        setGpsError('Location access denied — enable location in your browser settings to continue playing.');
      } else if (err.code === 2 /* POSITION_UNAVAILABLE */) {
        setGpsError('Location unavailable — your device cannot determine its position.');
      }
      // code 3 = TIMEOUT: transient; next interval tick will retry silently
    };

    const send = () => {
      // Hider must not send location updates once End Game begins (RULES.md §End Game).
      if (player.role === 'hider' && endGameActiveRef.current) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // Clear any previous GPS error on a successful fix
          setGpsError((prev) => (prev !== null ? null : prev));
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
        handleGpsError,
      );
    };

    // Send immediately on mount, then every LOCATION_INTERVAL_MS
    send();
    const id = setInterval(send, LOCATION_INTERVAL_MS);
    return () => clearInterval(id);
  }, [player.playerId, game.gameId]);

  return (
    <div aria-label="Game map">
      <div className={styles.gameHeader}>
        <span>
          Game: <code>{game.gameId}</code> · Phase: <strong>{phase}</strong>
        </span>
        <span>
          {player.name} ({player.role}){myTeam ? ` · Team ${myTeam}` : ''}
        </span>
      </div>

      {wsStatus === 'reconnecting' && (
        <p role="status" data-testid="reconnecting-banner" className={styles.reconnectingBanner}>
          Reconnecting…
        </p>
      )}

      {joinError && (
        <p role="alert" data-testid="join-error-banner" className={styles.alertBanner}>
          {joinError}
        </p>
      )}

      {outOfZone && player.role === 'hider' && (
        <p role="alert" data-testid="out-of-zone-banner" className={styles.warningBanner}>
          Warning: You are outside your hiding zone — return immediately!
        </p>
      )}

      {hiderOutOfZone && player.role === 'seeker' && (
        <p role="status" data-testid="hider-out-of-zone-banner" className={styles.infoBanner}>
          The hider has left their hiding zone!
        </p>
      )}

      {movementLocked && player.role === 'hider' && (
        <p role="alert" data-testid="movement-locked-banner" className={styles.alertBanner}>
          Movement locked — you cannot move during End Game!
        </p>
      )}

      {locationRejected && (
        <p role="alert" data-testid="location-rejected-banner" className={styles.alertBanner}>
          Your location is outside game bounds
          <button onClick={() => setLocationRejected(false)} className={styles.dismissBtn} aria-label="Dismiss">✕</button>
        </p>
      )}

      {gpsError && (
        <p role="alert" data-testid="gps-error-banner" className={styles.alertBanner}>
          {gpsError}
          <button onClick={() => setGpsError(null)} className={styles.dismissBtn} aria-label="Dismiss GPS error">✕</button>
        </p>
      )}

      {endGameActive && player.role === 'hider' && (
        <p role="alert" data-testid="end-game-banner-hider" className={styles.endGameBanner}>
          End Game: Stay put! Seekers are looking for you.
        </p>
      )}

      {endGameActive && player.role === 'seeker' && (
        <p role="status" data-testid="end-game-banner-seeker" className={styles.endGameBanner}>
          End Game! Find and spot the hider.
        </p>
      )}

      {captureMsg && (
        <p role="alert" className={styles.captureBanner}>
          {captureMsg}
        </p>
      )}

      {pendingQuestionExpiresAt ? (
        <p data-testid="timer-banner" className={styles.timer}>
          Question expires in {formatCountdown(pendingQuestionExpiresAt)}
        </p>
      ) : phaseEndsAt && endGameActive ? (
        <p data-testid="timer-banner" className={styles.timer}>
          {player.role === 'hider' ? 'You win if not spotted in' : 'Find the hider in'}{' '}
          {formatCountdown(phaseEndsAt)}
        </p>
      ) : phaseEndsAt && (phase === 'hiding' || phase === 'seeking') ? (
        <p data-testid="timer-banner" className={styles.timer}>
          {phase === 'hiding' ? 'Hiding ends in' : 'Seeking ends in'} {formatCountdown(phaseEndsAt)}
        </p>
      ) : null}

      {player.role === 'hider' &&
        (phase === 'hiding' || phase === 'seeking') &&
        hidingStartedAtRef.current !== null && (
          <p data-testid="elapsed-timer" className={styles.elapsedTimer}>
            Hiding time:{' '}
            {formatDuration(
              (Date.now() - hidingStartedAtRef.current) + bonusSecondsRef.current * 1_000,
            )}
          </p>
        )}

      <div className={styles.mapWrapper}>
        <div
          ref={mapContainerRef}
          data-testid="map-container"
          className={styles.mapContainer}
        />

        {player.role === 'seeker' && endGameActive && (
          <button
            type="button"
            data-testid="spot-hider-btn"
            className={styles.spotButton}
            disabled={spotResult === 'pending' || spotResult === 'confirmed' || myOnTransit}
            onClick={() => {
              setSpotResult('pending');
              setSpotDistance({ distanceM: null, spotRadiusM: null });
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'spot_hider',
                  gameId: game.gameId,
                  playerId: player.playerId,
                }));
              }
            }}
          >
            {spotResult === 'confirmed'
              ? 'Hider Spotted!'
              : spotResult === 'rejected'
                ? 'Not Close Enough'
                : myOnTransit
                  ? SPOT_ON_TRANSIT_LABEL
                  : 'I See the Hider!'}
          </button>
        )}
      </div>

      {spotResult === 'rejected' && player.role === 'seeker' && endGameActive && (
        <span data-testid="spot-rejected-msg" className={styles.spotRejectedMsg}>
          {spotDistance.distanceM != null && spotDistance.spotRadiusM != null
            ? `You are ${Math.round(spotDistance.distanceM)} m away; need to be within ${spotDistance.spotRadiusM} m`
            : 'You are not close enough to the hider yet.'}
        </span>
      )}

      {player.role === 'seeker' && phase === 'seeking' && (
        <div className={styles.transitToggleWrapper}>
          <button
            type="button"
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
            className={`${styles.transitToggle} ${myOnTransit ? styles.transitToggleOn : styles.transitToggleOff}`}
          >
            {myOnTransit ? '🚌 On Transit' : '🚶 Off Transit'}
          </button>
        </div>
      )}

      {player.role === 'seeker' && (
        <QuestionPanel player={player} game={game} teamId={myTeam} qaRefresh={qaRefresh} curseEndsAt={curseEndsAt} hiderId={hiderId} />
      )}

      {player.role === 'hider' && phase === 'hiding' && !lockedZone && (
        <>
          {zonesError && (
            <p role="alert">{zonesError}</p>
          )}
          <ZoneSelector
            player={player}
            game={game}
            zones={availableZones}
            onZoneLocked={(zone) => setLockedZone(zone)}
          />
        </>
      )}

      {player.role === 'hider' && (
        <AnswerPanel player={player} game={game} refreshTrigger={qaRefresh} />
      )}

      {player.role === 'hider' && (
        <Suspense fallback={null}>
          <CardPanel
            player={player}
            game={game}
            refreshTrigger={cardRefresh}
            onTimeBonusPlayed={(mins) => { bonusSecondsRef.current += mins * 60; }}
          />
        </Suspense>
      )}

      {scoreError && (
        <p role="alert" data-testid="score-error-banner" className={styles.alertBanner}>
          {scoreError}
          <button onClick={() => setScoreError(null)} className={styles.dismissBtn} aria-label="Dismiss score error">✕</button>
        </p>
      )}

      {gameResult && (
        <Suspense fallback={null}>
          <ResultsScreen
            winner={gameResult.winner}
            elapsedMs={gameResult.elapsedMs}
            bonusSeconds={gameResult.bonusSeconds}
            onPlayAgain={onPlayAgain}
          />
        </Suspense>
      )}
    </div>
  );
}
