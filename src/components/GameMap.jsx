import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const LOCATION_INTERVAL_MS = 10_000;
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

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
 *   player    — { playerId, name, role }
 *   game      — { gameId, size, status, bounds: { lat_min, lat_max, lon_min, lon_max } }
 *   zones     — array of { lat, lon, radius } hiding zones (optional)
 *   serverUrl — WebSocket server base URL (e.g. "ws://localhost:3001")
 *
 * Responsibilities:
 *   - Render an OSM Leaflet map centred on game bounds.
 *   - Draw a rectangle overlay for game bounds.
 *   - Draw circle overlays for hiding zones.
 *   - Connect to the managed game server via WebSocket.
 *   - Poll GPS every 10 s and send location_update messages.
 *   - Receive player_location / game_state / phase_change / capture messages.
 *   - Update player markers on state change; redraw only when data changes.
 */
export default function GameMap({ player, game, zones = [], serverUrl }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});   // { [playerId]: L.circleMarker }
  const wsRef = useRef(null);

  const [players, setPlayers] = useState({});      // { [playerId]: { lat, lon } }
  const [phase, setPhase] = useState(game.status);
  const [captureMsg, setCaptureMsg] = useState(null);

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

  // ── Update player markers when players state changes ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Add or move existing markers
    for (const [pid, pos] of Object.entries(players)) {
      if (markersRef.current[pid]) {
        markersRef.current[pid].setLatLng([pos.lat, pos.lon]);
      } else {
        const isMe = pid === player.playerId;
        markersRef.current[pid] = L.circleMarker([pos.lat, pos.lon], {
          radius: isMe ? 10 : 7,
          color: isMe ? '#0000ff' : '#cc0000',
          fillColor: isMe ? '#0000ff' : '#cc0000',
          fillOpacity: 0.7,
        })
          .bindTooltip(isMe ? 'You' : pid, { permanent: false })
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
  }, [players, player.playerId]);

  // ── WebSocket connection ───────────────────────────────────────────────────
  useEffect(() => {
    if (!serverUrl) return;

    const url = `${serverUrl}?playerId=${encodeURIComponent(player.playerId)}&gameId=${encodeURIComponent(game.gameId)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      if (msg.type === 'player_location') {
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
      } else if (msg.type === 'capture') {
        setCaptureMsg(msg.winner === 'seekers' ? 'Seekers win!' : 'Hiders win!');
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [player.playerId, game.gameId, serverUrl]);

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
        <span>{player.name} ({player.role})</span>
      </div>

      {captureMsg && (
        <p role="alert" style={{ background: '#ffe', padding: '0.5rem', fontWeight: 'bold' }}>
          {captureMsg}
        </p>
      )}

      <div
        ref={mapContainerRef}
        data-testid="map-container"
        style={{ height: '60vh', width: '100%', border: '1px solid #ccc' }}
      />
    </div>
  );
}
