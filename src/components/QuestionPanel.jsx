import { useState, useEffect, useRef } from 'react';
import { submitQuestion, listQuestions, fetchQuestionPhoto } from '../api.js';
import { tentacleHint, measuringHint, matchingHint, transitHint, thermometerHint } from './questionHints.js';
import { formatCountdown } from './gameUtils.js';
import styles from './QuestionPanel.module.css';

/** Interval in ms for the curse-countdown live update tick. */
const COUNTDOWN_TICK_MS = 1_000;

const CATEGORIES = ['matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle'];

const MATCHING_FEATURE_TYPES = ['airport', 'train_station', 'bus_station', 'ferry_terminal', 'university', 'hospital'];

/** One-line hint shown below the category selector to guide the seeker. */
const CATEGORY_HINTS = {
  matching:    'Is your nearest [landmark] the same as mine?',
  measuring:   'Am I closer to [place] than you are?',
  transit:     'Is my station on your current transit route?',
  thermometer: 'Am I warmer or colder relative to [reference]?',
  photo:       'Send a photo matching the specified criteria.',
  tentacle:    'Is [location] within X km of me?',
};

/**
 * QuestionPanel — seeker UI for submitting questions to the hider.
 *
 * Props:
 *   player      — { playerId, name, role }
 *   game        — { gameId }
 *   teamId      — 'A' | 'B' | null; the player's team assignment delivered via the
 *                 joined_game WebSocket message and stored in GameMap as myTeam.
 *                 When provided, only questions belonging to this team are fetched.
 *                 Optional — omit (or pass null/undefined) for single-team games.
 *   qaRefresh   — number; increment to force a history re-fetch (e.g. on
 *                 question_answered WS event). Defaults to 0.
 *   curseEndsAt — ISO timestamp string while a curse card is active; null otherwise.
 *                 Submit is disabled and a countdown is shown until the curse expires.
 *
 * Maintains a local list of submitted questions (optimistic) merged with the
 * server-side Q&A history fetched on mount and on each qaRefresh change.
 */
export default function QuestionPanel({ player, game, teamId = null, qaRefresh = 0, curseEndsAt = null }) {
  const [targetId, setTargetId] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [text, setText] = useState('');
  const [tentacleTargetLat, setTentacleTargetLat] = useState('');
  const [tentacleTargetLon, setTentacleTargetLon] = useState('');
  const [tentacleRadiusKm, setTentacleRadiusKm] = useState('');
  const [measuringTargetLat, setMeasuringTargetLat] = useState('');
  const [measuringTargetLon, setMeasuringTargetLon] = useState('');
  const [matchingFeatureType, setMatchingFeatureType] = useState(MATCHING_FEATURE_TYPES[0]);
  const [submitted, setSubmitted] = useState([]);  // optimistic local submissions
  const [history, setHistory] = useState([]);       // server-side Q&A history
  const [historyError, setHistoryError] = useState(null);
  const [error, setError] = useState(null);
  const [photoCache, setPhotoCache] = useState({}); // questionId → 'loading' | string | null
  const fetchedPhotosRef = useRef(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [, setTick] = useState(0); // 1-second tick to refresh curse countdown

  // Tick every second so the curse countdown stays live.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const isCurseActive = curseEndsAt != null && new Date(curseEndsAt) > new Date();
  const curseCountdown = isCurseActive ? formatCountdown(curseEndsAt) : null;

  // Fetch full Q&A history for the game on mount and whenever qaRefresh changes.
  useEffect(() => {
    setHistoryError(null);
    listQuestions({ gameId: game.gameId, ...(teamId ? { teamId } : {}) })
      .then((data) => {
        setHistory(data.questions ?? []);
        // Drop optimistically-submitted questions that are now in the server history.
        setSubmitted((prev) => {
          const serverIds = new Set((data.questions ?? []).map(q => q.questionId));
          return prev.filter(q => !serverIds.has(q.questionId));
        });
      })
      .catch((err) => setHistoryError(err.message));
  }, [game.gameId, teamId, qaRefresh]);

  // Fetch photos for answered photo questions that appear in the server history.
  useEffect(() => {
    history.forEach((q) => {
      if (q.category === 'photo' && q.answer && !fetchedPhotosRef.current.has(q.questionId)) {
        fetchedPhotosRef.current.add(q.questionId);
        setPhotoCache((prev) => ({ ...prev, [q.questionId]: 'loading' }));
        fetchQuestionPhoto(q.questionId)
          .then((data) => setPhotoCache((prev) => ({ ...prev, [q.questionId]: data?.photoData ?? null })))
          .catch(() => setPhotoCache((prev) => ({ ...prev, [q.questionId]: null })));
      }
    });
  }, [history]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetId.trim()) { setError('Target player ID is required'); return; }
    if (!text.trim())     { setError('Question text is required'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const tentacleParams = category === 'tentacle' ? {
        tentacleTargetLat: Number(tentacleTargetLat),
        tentacleTargetLon: Number(tentacleTargetLon),
        tentacleRadiusKm:  Number(tentacleRadiusKm),
      } : {};
      const measuringParams = category === 'measuring' ? {
        measuringTargetLat: Number(measuringTargetLat),
        measuringTargetLon: Number(measuringTargetLon),
      } : {};
      const matchingParams = category === 'matching' ? {
        matchingFeatureType,
      } : {};
      const question = await submitQuestion({
        gameId:   game.gameId,
        askerId:  player.playerId,
        targetId: targetId.trim(),
        category,
        text:     text.trim(),
        ...tentacleParams,
        ...measuringParams,
        ...matchingParams,
      });
      setSubmitted((prev) => [question, ...prev]);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Combined list: optimistic submissions first (newest), then server history.
  // Dedup by questionId so a newly-answered optimistic entry is not shown twice.
  const historyIds = new Set(history.map(q => q.questionId));
  const allQuestions = [
    ...submitted.filter(q => !historyIds.has(q.questionId)),
    ...history,
  ];

  return (
    <section aria-label="Question panel">
      <h3>Ask a Question</h3>
      {isCurseActive && (
        <p role="status" data-testid="curse-banner" className={styles.curseBanner}>
          Questions blocked by curse — {curseCountdown} remaining
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}

        <label>
          Hider ID
          <input
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="Enter hider's player ID"
          />
        </label>

        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <small aria-label="question type hint">{CATEGORY_HINTS[category]}</small>

        <label>
          Question
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your question…"
            rows={3}
          />
        </label>

        {category === 'tentacle' && (
          <>
            <label>
              Target latitude
              <input
                type="number"
                step="0.000001"
                value={tentacleTargetLat}
                onChange={(e) => setTentacleTargetLat(e.target.value)}
                aria-label="Target latitude"
              />
            </label>
            <label>
              Target longitude
              <input
                type="number"
                step="0.000001"
                value={tentacleTargetLon}
                onChange={(e) => setTentacleTargetLon(e.target.value)}
                aria-label="Target longitude"
              />
            </label>
            <label>
              Radius (km)
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={tentacleRadiusKm}
                onChange={(e) => setTentacleRadiusKm(e.target.value)}
                aria-label="Radius (km)"
              />
            </label>
          </>
        )}

        {category === 'measuring' && (
          <>
            <label>
              Target latitude
              <input
                type="number"
                step="0.000001"
                value={measuringTargetLat}
                onChange={(e) => setMeasuringTargetLat(e.target.value)}
                aria-label="Target latitude"
              />
            </label>
            <label>
              Target longitude
              <input
                type="number"
                step="0.000001"
                value={measuringTargetLon}
                onChange={(e) => setMeasuringTargetLon(e.target.value)}
                aria-label="Target longitude"
              />
            </label>
          </>
        )}

        {category === 'matching' && (
          <label>
            Feature type
            <select
              value={matchingFeatureType}
              onChange={(e) => setMatchingFeatureType(e.target.value)}
              aria-label="Feature type"
            >
              {MATCHING_FEATURE_TYPES.map((ft) => (
                <option key={ft} value={ft}>{ft}</option>
              ))}
            </select>
          </label>
        )}

        <button type="submit" disabled={submitting || isCurseActive}>
          {submitting ? 'Sending…' : 'Submit question'}
        </button>
      </form>

      {historyError && <p role="alert">{historyError}</p>}

      {allQuestions.length > 0 && (
        <div aria-label="Question history">
          <h4>Question history</h4>
          <ul className={styles.history}>
            {allQuestions.map((q) => (
              <li key={q.questionId} className={styles.historyItem}>
                <span className={styles.category}>[{q.category}]</span>{' '}{q.text}{' '}
                <em aria-label={`status: ${q.status}`}>— {q.status}</em>
                {q.answer && (
                  <span aria-label="answer"> → {q.answer.text}</span>
                )}
                {q.answer && q.category === 'thermometer' && (
                  <p data-testid="question-thermometer-hint" className={styles.hint}>
                    {thermometerHint(q.thermometerCurrentDistanceM, q.thermometerPreviousDistanceM)}
                  </p>
                )}
                {q.answer && q.category === 'tentacle' && (
                  <p data-testid="question-tentacle-hint" className={styles.hint}>
                    {tentacleHint(q.tentacleWithinRadius, q.tentacleDistanceKm)}
                  </p>
                )}
                {q.answer && q.category === 'measuring' && (
                  <p data-testid="question-measuring-hint" className={styles.hint}>
                    {measuringHint(q.measuringHiderIsCloser, q.measuringHiderDistanceKm, q.measuringSeekerDistanceKm)}
                  </p>
                )}
                {q.answer && q.category === 'transit' && (
                  <p data-testid="question-transit-hint" className={styles.hint}>
                    {transitHint(q.transitNearestStationName, q.transitNearestStationDistanceKm)}
                  </p>
                )}
                {q.answer && q.category === 'matching' && (
                  <p data-testid="question-matching-hint" className={styles.hint}>
                    {matchingHint(q.matchingFeaturesMatch, q.matchingFeatureType, q.matchingHiderFeatureName, q.matchingSeekerFeatureName)}
                  </p>
                )}
                {q.category === 'photo' && q.answer && (() => {
                  const cached = photoCache[q.questionId];
                  if (typeof cached === 'string' && cached !== '') {
                    return <img data-testid="question-photo-img" src={cached} alt="Hider photo" className={styles.questionPhoto} />;
                  }
                  if (cached === null) {
                    return <span data-testid="no-photo">No photo attached</span>;
                  }
                  return <span>Loading photo…</span>;
                })()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
