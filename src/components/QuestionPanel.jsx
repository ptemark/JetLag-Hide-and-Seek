import { useState, useEffect } from 'react';
import { submitQuestion, listQuestions } from '../api.js';

const CATEGORIES = ['matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle'];

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
 *   qaRefresh   — number; increment to force a history re-fetch (e.g. on
 *                 question_answered WS event). Defaults to 0.
 *
 * Maintains a local list of submitted questions (optimistic) merged with the
 * server-side Q&A history fetched on mount and on each qaRefresh change.
 */
export default function QuestionPanel({ player, game, qaRefresh = 0 }) {
  const [targetId, setTargetId] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState([]);  // optimistic local submissions
  const [history, setHistory] = useState([]);       // server-side Q&A history
  const [historyError, setHistoryError] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch full Q&A history for the game on mount and whenever qaRefresh changes.
  useEffect(() => {
    setHistoryError(null);
    listQuestions({ gameId: game.gameId })
      .then((data) => {
        setHistory(data.questions ?? []);
        // Drop optimistically-submitted questions that are now in the server history.
        setSubmitted((prev) => {
          const serverIds = new Set((data.questions ?? []).map(q => q.questionId));
          return prev.filter(q => !serverIds.has(q.questionId));
        });
      })
      .catch((err) => setHistoryError(err.message));
  }, [game.gameId, qaRefresh]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetId.trim()) { setError('Target player ID is required'); return; }
    if (!text.trim())     { setError('Question text is required'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const question = await submitQuestion({
        gameId:   game.gameId,
        askerId:  player.playerId,
        targetId: targetId.trim(),
        category,
        text:     text.trim(),
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

        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Submit question'}
        </button>
      </form>

      {historyError && <p role="alert">{historyError}</p>}

      {allQuestions.length > 0 && (
        <div aria-label="Question history">
          <h4>Question history</h4>
          <ul>
            {allQuestions.map((q) => (
              <li key={q.questionId}>
                <strong>[{q.category}]</strong> {q.text}{' '}
                <em aria-label={`status: ${q.status}`}>— {q.status}</em>
                {q.answer && (
                  <span aria-label="answer"> → {q.answer.text}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
