import { useEffect, useState } from 'react';
import { fetchCards, playCardApi } from '../api.js';
import Alert from './Alert.jsx';
import { CARD_LABELS, CARD_DESCRIPTIONS } from './gameUtils.js';
import styles from './CardPanel.module.css';

/**
 * CardPanel — displays the hider's hand of up to 6 challenge cards.
 *
 * Props:
 *   player         — { playerId, name, role }
 *   game           — { gameId, ... }
 *   refreshTrigger — number, increment to re-fetch hand
 *   onTimeBonusPlayed — optional callback fired with minutesAdded when a time_bonus card is played
 */
export default function CardPanel({ player, game, refreshTrigger = 0, onTimeBonusPlayed }) {
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
      if (played.type === 'time_bonus' && onTimeBonusPlayed) {
        onTimeBonusPlayed(played.effect?.minutesAdded ?? 10);
      }
    } catch (err) {
      setPlayError(err.message);
    } finally {
      setPlayingId(null);
    }
  }

  return (
    <section aria-label="Card panel" className={styles.panel}>
      <h3>Your Cards ({hand.length}/6)</h3>

      {loadError && <Alert>{loadError}</Alert>}

      {playError && <Alert>{playError}</Alert>}

      {confirmation && (
        <p
          role="status"
          aria-label="card played"
          className={styles.confirmation}
        >
          Played <strong>{CARD_LABELS[confirmation.type] ?? confirmation.type}</strong>!{' '}
          Effect: {CARD_DESCRIPTIONS[confirmation.type] ?? JSON.stringify(confirmation.effect)}
        </p>
      )}

      {hand.length === 0 && !loadError ? (
        <p>No cards in hand.</p>
      ) : (
        <ul className={styles.hand}>
          {hand.map((card) => (
            <li key={card.cardId} className={styles.card}>
              <span className={styles.cardType}>{CARD_LABELS[card.type] ?? card.type}</span>
              <small>{CARD_DESCRIPTIONS[card.type] ?? ''}</small>
              <button
                type="button"
                aria-label={`Play ${CARD_LABELS[card.type] ?? card.type}`}
                disabled={playingId === card.cardId}
                onClick={() => handlePlay(card)}
                className={styles.playBtn}
              >
                Play
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
