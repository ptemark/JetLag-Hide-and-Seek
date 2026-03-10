import { useState } from 'react';
import { submitQuestion } from '../api.js';

const CATEGORIES = ['matching', 'thermometer', 'photo', 'tentacle'];

/**
 * QuestionPanel — seeker UI for submitting questions to the hider.
 *
 * Props:
 *   player — { playerId, name, role }
 *   game   — { gameId }
 *
 * Maintains a local list of submitted questions (optimistic). The hider's
 * player ID must be entered manually since the seeker may not know it from
 * the game state alone; it can be shared out-of-band like the game ID.
 */
export default function QuestionPanel({ player, game }) {
  const [targetId, setTargetId] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState([]);  // local history
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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

      {submitted.length > 0 && (
        <div aria-label="Submitted questions">
          <h4>Your questions</h4>
          <ul>
            {submitted.map((q) => (
              <li key={q.questionId}>
                <strong>[{q.category}]</strong> {q.text}{' '}
                <em aria-label={`status: ${q.status}`}>— {q.status}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
