import { useState, useEffect } from 'react';
import { listQuestions, submitAnswer, uploadQuestionPhoto } from '../api.js';

/**
 * AnswerPanel — hider UI for viewing and answering pending questions.
 *
 * Props:
 *   player         — { playerId, name, role }
 *   game           — { gameId }
 *   refreshTrigger — number; increment to force a re-fetch (e.g. on WS event)
 */
export default function AnswerPanel({ player, game, refreshTrigger = 0 }) {
  const [questions, setQuestions] = useState([]);
  const [loadError, setLoadError] = useState(null);
  // Per-question answer text and submission state
  const [answers, setAnswers] = useState({});    // { [questionId]: string }
  const [photos, setPhotos] = useState({});      // { [questionId]: string } — base64 data URLs
  const [submitting, setSubmitting] = useState({}); // { [questionId]: bool }
  const [errors, setErrors] = useState({});         // { [questionId]: string }
  const [answered, setAnswered] = useState(new Set());

  // Reload question list whenever the component mounts or refreshTrigger changes.
  useEffect(() => {
    setLoadError(null);
    listQuestions({ playerId: player.playerId })
      .then((data) => setQuestions(data.questions ?? []))
      .catch((err) => setLoadError(err.message));
  }, [player.playerId, refreshTrigger]);

  function setAnswerText(questionId, value) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function handlePhotoChange(questionId, file) {
    if (!file) {
      setPhotos((prev) => ({ ...prev, [questionId]: null }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPhotos((prev) => ({ ...prev, [questionId]: reader.result }));
    };
    reader.readAsDataURL(file);
  }

  async function handleAnswer(e, questionId, category) {
    e.preventDefault();
    const text = (answers[questionId] ?? '').trim();
    if (!text) {
      setErrors((prev) => ({ ...prev, [questionId]: 'Answer text is required' }));
      return;
    }
    setErrors((prev) => ({ ...prev, [questionId]: null }));
    setSubmitting((prev) => ({ ...prev, [questionId]: true }));
    try {
      if (category === 'photo' && photos[questionId]) {
        await uploadQuestionPhoto({ questionId, photoData: photos[questionId] });
      }
      await submitAnswer({ questionId, responderId: player.playerId, text });
      setAnswered((prev) => new Set([...prev, questionId]));
    } catch (err) {
      setErrors((prev) => ({ ...prev, [questionId]: err.message }));
    } finally {
      setSubmitting((prev) => ({ ...prev, [questionId]: false }));
    }
  }

  const pending = questions.filter(
    (q) => q.status === 'pending' && !answered.has(q.questionId),
  );

  return (
    <section aria-label="Answer panel">
      <h3>Incoming Questions</h3>

      {loadError && (
        <p role="alert">{loadError}</p>
      )}

      {!loadError && pending.length === 0 && (
        <p>No pending questions.</p>
      )}

      {pending.map((q) => (
        <div key={q.questionId} aria-label={`Question ${q.questionId}`}>
          <p>
            <strong>[{q.category}]</strong> {q.text}
          </p>
          <form
            onSubmit={(e) => handleAnswer(e, q.questionId, q.category)}
            aria-label={`Answer form for ${q.questionId}`}
          >
            {errors[q.questionId] && (
              <p role="alert">{errors[q.questionId]}</p>
            )}
            {q.category === 'photo' && (
              <label>
                Photo
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Photo upload"
                  onChange={(e) => handlePhotoChange(q.questionId, e.target.files?.[0] ?? null)}
                />
              </label>
            )}
            <label>
              Your answer
              <textarea
                value={answers[q.questionId] ?? ''}
                onChange={(e) => setAnswerText(q.questionId, e.target.value)}
                rows={2}
                placeholder="Type your answer…"
              />
            </label>
            <button type="submit" disabled={submitting[q.questionId]}>
              {submitting[q.questionId] ? 'Sending…' : 'Submit answer'}
            </button>
          </form>
        </div>
      ))}

      {answered.size > 0 && (
        <p aria-live="polite">{answered.size} question(s) answered this session.</p>
      )}
    </section>
  );
}
