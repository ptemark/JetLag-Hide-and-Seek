import { useEffect, useState } from 'react';
import { fetchCards, playCardApi } from '../api.js';

const CARD_LABELS = {
  time_bonus: 'Time Bonus',
  powerup:    'Power-Up',
  curse:      'Curse',
};

const CARD_DESCRIPTIONS = {
  time_bonus: '+10 min hiding time',
  powerup:    'Create a false zone',
  curse:      'Block seeker questions for 2 min',
};

const CARD_COLORS = {
  time_bonus: '#d4edda',
  powerup:    '#cce5ff',
  curse:      '#f8d7da',
};

/**
 * CardPanel — displays the hider's hand of up to 6 challenge cards.
 *
 * Props:
 *   player         — { playerId, name, role }
 *   game           — { gameId, ... }
 *   refreshTrigger — number, increment to re-fetch hand
 */
export default function CardPanel({ player, game, refreshTrigger = 0 }) {
  const [hand, setHand] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const [confirmation, setConfirmation] = useState(null); // { cardId, type, effect }
  const [playError, setPlayError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchCards({ gameId: game.gameId, playerId: player.playerId })
      .then(({ hand: h }) => { if (!cancelled) setHand(h); })
      .catch((err) => { if (!cancelled) setLoadError(err.message); });
    return () => { cancelled = true; };
  }, [game.gameId, player.playerId, refreshTrigger]);

  async function handlePlay(card) {
    setPlayingId(card.cardId);
    setPlayError(null);
    setConfirmation(null);
    try {
      const played = await playCardApi({ cardId: card.cardId, playerId: player.playerId });
      setHand((prev) => prev.filter((c) => c.cardId !== card.cardId));
      setConfirmation(played);
    } catch (err) {
      setPlayError(err.message);
    } finally {
      setPlayingId(null);
    }
  }

  return (
    <section aria-label="Card panel">
      <h3 style={{ margin: '0.75rem 0 0.5rem' }}>Your Cards ({hand.length}/6)</h3>

      {loadError && (
        <p role="alert" style={{ color: '#721c24' }}>{loadError}</p>
      )}

      {playError && (
        <p role="alert" style={{ color: '#721c24' }}>{playError}</p>
      )}

      {confirmation && (
        <p
          role="status"
          aria-label="card played"
          style={{ background: '#d4edda', padding: '0.4rem 0.6rem', borderRadius: 4 }}
        >
          Played <strong>{CARD_LABELS[confirmation.type] ?? confirmation.type}</strong>!{' '}
          Effect: {CARD_DESCRIPTIONS[confirmation.type] ?? JSON.stringify(confirmation.effect)}
        </p>
      )}

      {hand.length === 0 && !loadError ? (
        <p>No cards in hand.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {hand.map((card) => (
            <li key={card.cardId}>
              <button
                aria-label={`Play ${CARD_LABELS[card.type] ?? card.type}`}
                disabled={playingId === card.cardId}
                onClick={() => handlePlay(card)}
                style={{
                  background: CARD_COLORS[card.type] ?? '#f0f0f0',
                  border: '1px solid #aaa',
                  borderRadius: 8,
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  minWidth: 110,
                  textAlign: 'center',
                }}
              >
                <strong>{CARD_LABELS[card.type] ?? card.type}</strong>
                <br />
                <small>{CARD_DESCRIPTIONS[card.type] ?? ''}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
