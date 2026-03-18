// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// Mock API module before importing components that use it.
vi.mock('../api.js', () => ({
  registerPlayer:       vi.fn(),
  createGame:           vi.fn(),
  lookupGame:           vi.fn(),
  submitQuestion:       vi.fn(),
  listQuestions:        vi.fn(),
  submitAnswer:         vi.fn(),
  uploadQuestionPhoto:  vi.fn(),
  fetchQuestionPhoto:   vi.fn(),
  lockZone:             vi.fn(),
}));

import * as api from '../api.js';
import QuestionPanel from './QuestionPanel.jsx';
import AnswerPanel from './AnswerPanel.jsx';

// Stub FileReader so tests can simulate file reads synchronously.
class StubFileReader {
  readAsDataURL(_file) {
    this.result = 'data:image/png;base64,stub';
    this.onload?.();
  }
}
vi.stubGlobal('FileReader', StubFileReader);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SEEKER = { playerId: 'p1', name: 'Alice', role: 'seeker' };
const HIDER  = { playerId: 'p2', name: 'Bob',   role: 'hider' };
const GAME   = { gameId: 'g1', size: 'medium', status: 'seeking' };

const QUESTION = {
  questionId: 'q1',
  gameId:     'g1',
  askerId:    'p1',
  targetId:   'p2',
  category:   'matching',
  text:       'Are you near a park?',
  status:     'pending',
  createdAt:  '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: return empty questions regardless of which param shape is used.
  api.listQuestions.mockResolvedValue({ questions: [] });
});

// ── QuestionPanel ─────────────────────────────────────────────────────────────

describe('QuestionPanel', () => {
  it('renders hider ID input, category selector, question textarea, and submit button', () => {
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    expect(screen.getByLabelText(/hider id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /question/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit question/i })).toBeInTheDocument();
  });

  it('renders all six category options', () => {
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    const select = screen.getByLabelText(/category/i);
    expect(select).toBeInTheDocument();
    ['matching', 'measuring', 'transit', 'thermometer', 'photo', 'tentacle'].forEach((cat) => {
      expect(screen.getByRole('option', { name: cat })).toBeInTheDocument();
    });
  });

  it('shows a question type hint below the selector', () => {
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    expect(screen.getByLabelText(/question type hint/i)).toBeInTheDocument();
  });

  it('updates the hint when a different category is selected', async () => {
    const user = userEvent.setup();
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await user.selectOptions(screen.getByLabelText(/category/i), 'measuring');
    expect(screen.getByLabelText(/question type hint/i)).toHaveTextContent(/closer/i);
  });

  it('shows error when submitting with empty hider ID', async () => {
    const user = userEvent.setup();
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await user.click(screen.getByRole('button', { name: /submit question/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/target player id is required/i);
  });

  it('shows error when submitting with empty question text', async () => {
    const user = userEvent.setup();
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.click(screen.getByRole('button', { name: /submit question/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/question text is required/i);
  });

  it('calls submitQuestion with correct arguments', async () => {
    const user = userEvent.setup();
    api.submitQuestion.mockResolvedValue(QUESTION);
    render(<QuestionPanel player={SEEKER} game={GAME} />);

    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.selectOptions(screen.getByLabelText(/category/i), 'thermometer');
    await user.type(screen.getByRole('textbox', { name: /question/i }), 'Are you near a park?');
    await user.click(screen.getByRole('button', { name: /submit question/i }));

    await waitFor(() =>
      expect(api.submitQuestion).toHaveBeenCalledWith({
        gameId:   'g1',
        askerId:  'p1',
        targetId: 'p2',
        category: 'thermometer',
        text:     'Are you near a park?',
      })
    );
  });

  it('adds submitted question to the local list on success', async () => {
    const user = userEvent.setup();
    api.submitQuestion.mockResolvedValue(QUESTION);
    render(<QuestionPanel player={SEEKER} game={GAME} />);

    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.type(screen.getByRole('textbox', { name: /question/i }), 'Are you near a park?');
    await user.click(screen.getByRole('button', { name: /submit question/i }));

    await waitFor(() =>
      expect(screen.getByText(/Are you near a park\?/)).toBeInTheDocument()
    );
  });

  it('clears question text after successful submission', async () => {
    const user = userEvent.setup();
    api.submitQuestion.mockResolvedValue(QUESTION);
    render(<QuestionPanel player={SEEKER} game={GAME} />);

    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.type(screen.getByRole('textbox', { name: /question/i }), 'Are you near a park?');
    await user.click(screen.getByRole('button', { name: /submit question/i }));

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /question/i })).toHaveValue('')
    );
  });

  it('shows error when submitQuestion rejects', async () => {
    const user = userEvent.setup();
    api.submitQuestion.mockRejectedValue(new Error('server error'));
    render(<QuestionPanel player={SEEKER} game={GAME} />);

    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.type(screen.getByRole('textbox', { name: /question/i }), 'Hello?');
    await user.click(screen.getByRole('button', { name: /submit question/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/server error/i)
    );
  });

  it('shows submitted questions section only after first submission (no server history)', async () => {
    const user = userEvent.setup();
    api.submitQuestion.mockResolvedValue(QUESTION);
    render(<QuestionPanel player={SEEKER} game={GAME} />);

    expect(screen.queryByText(/question history/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.type(screen.getByRole('textbox', { name: /question/i }), 'Hello?');
    await user.click(screen.getByRole('button', { name: /submit question/i }));

    await waitFor(() =>
      expect(screen.getByText(/question history/i)).toBeInTheDocument()
    );
  });

  it('fetches Q&A history by gameId on mount', async () => {
    api.listQuestions.mockResolvedValue({ gameId: 'g1', questions: [] });
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await waitFor(() =>
      expect(api.listQuestions).toHaveBeenCalledWith({ gameId: 'g1' })
    );
  });

  it('displays server-side Q&A history on mount', async () => {
    const answeredQ = {
      ...QUESTION,
      status: 'answered',
      answer: { text: 'Yes, near the park.', createdAt: '2026-01-01T00:01:00Z' },
    };
    api.listQuestions.mockResolvedValue({ gameId: 'g1', questions: [answeredQ] });
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await waitFor(() => {
      expect(screen.getByText(/Are you near a park\?/)).toBeInTheDocument();
      expect(screen.getByText(/Yes, near the park\./)).toBeInTheDocument();
    });
  });

  it('shows history section heading when server history is non-empty', async () => {
    api.listQuestions.mockResolvedValue({ gameId: 'g1', questions: [QUESTION] });
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByText(/question history/i)).toBeInTheDocument()
    );
  });

  it('re-fetches history when qaRefresh increments', async () => {
    api.listQuestions.mockResolvedValue({ gameId: 'g1', questions: [] });
    const { rerender } = render(<QuestionPanel player={SEEKER} game={GAME} qaRefresh={0} />);
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledTimes(1));

    rerender(<QuestionPanel player={SEEKER} game={GAME} qaRefresh={1} />);
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledTimes(2));
  });

  it('shows history load error when listQuestions rejects', async () => {
    api.listQuestions.mockRejectedValue(new Error('history load failed'));
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/history load failed/i)
    );
  });

  it('shows curse banner and disables submit when curseEndsAt is in the future', async () => {
    const curseEndsAt = new Date(Date.now() + 60_000).toISOString();
    render(<QuestionPanel player={SEEKER} game={GAME} curseEndsAt={curseEndsAt} />);
    await waitFor(() => screen.getByTestId('curse-banner'));
    expect(screen.getByTestId('curse-banner')).toHaveTextContent(/questions blocked/i);
    expect(screen.getByRole('button', { name: /submit question/i })).toBeDisabled();
  });

  it('does not show curse banner when curseEndsAt is null', async () => {
    render(<QuestionPanel player={SEEKER} game={GAME} curseEndsAt={null} />);
    await waitFor(() => screen.getByRole('button', { name: /submit question/i }));
    expect(screen.queryByTestId('curse-banner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit question/i })).not.toBeDisabled();
  });

  it('does not show curse banner when curseEndsAt is in the past', async () => {
    const pastCurse = new Date(Date.now() - 1000).toISOString();
    render(<QuestionPanel player={SEEKER} game={GAME} curseEndsAt={pastCurse} />);
    await waitFor(() => screen.getByRole('button', { name: /submit question/i }));
    expect(screen.queryByTestId('curse-banner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit question/i })).not.toBeDisabled();
  });
});

// ── AnswerPanel ───────────────────────────────────────────────────────────────

describe('AnswerPanel', () => {
  it('shows "No pending questions" when list is empty', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByText(/no pending questions/i)).toBeInTheDocument()
    );
  });

  it('fetches questions for the hider on mount', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledWith({ playerId: 'p2' }));
  });

  it('displays pending questions with category and text', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => {
      expect(screen.getByText(/matching/i)).toBeInTheDocument();
      expect(screen.getByText(/Are you near a park\?/)).toBeInTheDocument();
    });
  });

  it('renders an answer textarea and submit button per question', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /submit answer/i })).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument();
  });

  it('shows error when submitting empty answer', async () => {
    const user = userEvent.setup();
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByRole('button', { name: /submit answer/i }));
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/answer text is required/i);
  });

  it('calls submitAnswer with correct arguments', async () => {
    const user = userEvent.setup();
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    api.submitAnswer.mockResolvedValue({ answerId: 'a1', questionId: 'q1' });
    render(<AnswerPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByLabelText(/your answer/i));
    await user.type(screen.getByLabelText(/your answer/i), 'Yes, near the park.');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() =>
      expect(api.submitAnswer).toHaveBeenCalledWith({
        questionId:  'q1',
        responderId: 'p2',
        text:        'Yes, near the park.',
      })
    );
  });

  it('hides answered question from the pending list', async () => {
    const user = userEvent.setup();
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    api.submitAnswer.mockResolvedValue({ answerId: 'a1', questionId: 'q1' });
    render(<AnswerPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByLabelText(/your answer/i));
    await user.type(screen.getByLabelText(/your answer/i), 'Yes, near the park.');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /submit answer/i })).not.toBeInTheDocument()
    );
  });

  it('shows answered count after submitting', async () => {
    const user = userEvent.setup();
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    api.submitAnswer.mockResolvedValue({ answerId: 'a1', questionId: 'q1' });
    render(<AnswerPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByLabelText(/your answer/i));
    await user.type(screen.getByLabelText(/your answer/i), 'Yes.');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() =>
      expect(screen.getByText(/1 question\(s\) answered/i)).toBeInTheDocument()
    );
  });

  it('shows error when submitAnswer rejects', async () => {
    const user = userEvent.setup();
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    api.submitAnswer.mockRejectedValue(new Error('answer failed'));
    render(<AnswerPanel player={HIDER} game={GAME} />);

    await waitFor(() => screen.getByLabelText(/your answer/i));
    await user.type(screen.getByLabelText(/your answer/i), 'Something');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/answer failed/i)
    );
  });

  it('shows load error when listQuestions rejects', async () => {
    api.listQuestions.mockRejectedValue(new Error('load failed'));
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/load failed/i)
    );
  });

  it('re-fetches questions when refreshTrigger changes', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [] });
    const { rerender } = render(<AnswerPanel player={HIDER} game={GAME} refreshTrigger={0} />);
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledTimes(1));

    rerender(<AnswerPanel player={HIDER} game={GAME} refreshTrigger={1} />);
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledTimes(2));
  });

  it('shows a file input for photo questions', async () => {
    const photoQuestion = { ...QUESTION, questionId: 'q-photo', category: 'photo' };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [photoQuestion] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/photo upload/i)).toBeInTheDocument()
    );
  });

  it('does not show a file input for non-photo questions', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => screen.getByLabelText(/your answer/i));
    expect(screen.queryByLabelText(/photo upload/i)).not.toBeInTheDocument();
  });

  it('calls uploadQuestionPhoto before submitAnswer when a photo file is selected', async () => {
    const user = userEvent.setup();
    const photoQuestion = { ...QUESTION, questionId: 'q-photo', category: 'photo' };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [photoQuestion] });
    api.uploadQuestionPhoto.mockResolvedValue({ photoId: 'ph-1', questionId: 'q-photo', uploadedAt: '' });
    api.submitAnswer.mockResolvedValue({ answerId: 'a1', questionId: 'q-photo' });

    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => screen.getByLabelText(/photo upload/i));

    // Simulate file selection (FileReader stub will set result synchronously via onload).
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/photo upload/i), file);

    await user.type(screen.getByLabelText(/your answer/i), 'Here is my photo.');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => {
      expect(api.uploadQuestionPhoto).toHaveBeenCalledWith({
        questionId: 'q-photo',
        photoData: 'data:image/png;base64,stub',
      });
      expect(api.submitAnswer).toHaveBeenCalled();
    });
  });

  it('submits answer without uploadQuestionPhoto when no photo is selected', async () => {
    const user = userEvent.setup();
    const photoQuestion = { ...QUESTION, questionId: 'q-photo', category: 'photo' };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [photoQuestion] });
    api.submitAnswer.mockResolvedValue({ answerId: 'a1', questionId: 'q-photo' });

    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => screen.getByLabelText(/your answer/i));

    await user.type(screen.getByLabelText(/your answer/i), 'No photo.');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => expect(api.submitAnswer).toHaveBeenCalled());
    expect(api.uploadQuestionPhoto).not.toHaveBeenCalled();
  });

  // ── Thermometer hints ──────────────────────────────────────────────────────

  it('shows "warmer" thermometer hint when current distance < previous distance', async () => {
    const q = { ...QUESTION, category: 'thermometer', thermometerCurrentDistanceM: 200, thermometerPreviousDistanceM: 400 };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('thermometer-hint')).toHaveTextContent(/warmer/i)
    );
  });

  it('shows "colder" thermometer hint when current distance > previous distance', async () => {
    const q = { ...QUESTION, category: 'thermometer', thermometerCurrentDistanceM: 600, thermometerPreviousDistanceM: 300 };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('thermometer-hint')).toHaveTextContent(/colder/i)
    );
  });

  it('shows "same" thermometer hint when current distance equals previous distance', async () => {
    const q = { ...QUESTION, category: 'thermometer', thermometerCurrentDistanceM: 350, thermometerPreviousDistanceM: 350 };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('thermometer-hint')).toHaveTextContent(/same/i)
    );
  });

  it('shows "unknown" thermometer hint when distances are null', async () => {
    const q = { ...QUESTION, category: 'thermometer', thermometerCurrentDistanceM: null, thermometerPreviousDistanceM: null };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('thermometer-hint')).toHaveTextContent(/unknown/i)
    );
  });

  it('does not render a thermometer hint for non-thermometer questions', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => screen.getByLabelText(/your answer/i));
    expect(screen.queryByTestId('thermometer-hint')).not.toBeInTheDocument();
  });

  // ── Tentacle hints ────────────────────────────────────────────────────────

  it('shows "within radius" tentacle hint when withinRadius is true', async () => {
    const q = { ...QUESTION, category: 'tentacle', tentacleWithinRadius: true, tentacleDistanceKm: 1.23 };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('tentacle-hint')).toHaveTextContent(/within radius/i)
    );
    expect(screen.getByTestId('tentacle-hint')).toHaveTextContent('1.23 km away');
  });

  it('shows "outside radius" tentacle hint when withinRadius is false', async () => {
    const q = { ...QUESTION, category: 'tentacle', tentacleWithinRadius: false, tentacleDistanceKm: 5.67 };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('tentacle-hint')).toHaveTextContent(/outside radius/i)
    );
    expect(screen.getByTestId('tentacle-hint')).toHaveTextContent('5.67 km away');
  });

  it('shows "unknown" tentacle hint when withinRadius and distanceKm are null', async () => {
    const q = { ...QUESTION, category: 'tentacle', tentacleWithinRadius: null, tentacleDistanceKm: null };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('tentacle-hint')).toHaveTextContent(/unknown/i)
    );
  });

  it('does not render a tentacle hint for non-tentacle questions', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => screen.getByLabelText(/your answer/i));
    expect(screen.queryByTestId('tentacle-hint')).not.toBeInTheDocument();
  });

  // ── Measuring hints ───────────────────────────────────────────────────────

  it('shows "hider is closer" measuring hint when hiderIsCloser is true', async () => {
    const q = { ...QUESTION, category: 'measuring', measuringHiderIsCloser: true, measuringHiderDistanceKm: 1.23, measuringSeekerDistanceKm: 4.56 };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('measuring-hint')).toHaveTextContent(/hider is closer/i)
    );
    expect(screen.getByTestId('measuring-hint')).toHaveTextContent('1.23 km');
    expect(screen.getByTestId('measuring-hint')).toHaveTextContent('4.56 km');
  });

  it('shows "seeker is closer" measuring hint when hiderIsCloser is false', async () => {
    const q = { ...QUESTION, category: 'measuring', measuringHiderIsCloser: false, measuringHiderDistanceKm: 5.00, measuringSeekerDistanceKm: 2.00 };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('measuring-hint')).toHaveTextContent(/seeker is closer/i)
    );
    expect(screen.getByTestId('measuring-hint')).toHaveTextContent('5.00 km');
    expect(screen.getByTestId('measuring-hint')).toHaveTextContent('2.00 km');
  });

  it('shows "unknown" measuring hint when hiderIsCloser is null', async () => {
    const q = { ...QUESTION, category: 'measuring', measuringHiderIsCloser: null, measuringHiderDistanceKm: null, measuringSeekerDistanceKm: null };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('measuring-hint')).toHaveTextContent(/unknown/i)
    );
  });

  it('does not render a measuring hint for non-measuring questions', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => screen.getByLabelText(/your answer/i));
    expect(screen.queryByTestId('measuring-hint')).not.toBeInTheDocument();
  });

  // ── Transit hints ─────────────────────────────────────────────────────────

  it('shows "nearest station is [name]" transit hint with distance when station data is present', async () => {
    const q = { ...QUESTION, category: 'transit', transitNearestStationName: 'Central Station', transitNearestStationDistanceKm: 0.75 };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('transit-hint')).toHaveTextContent(/nearest station is Central Station/i)
    );
    expect(screen.getByTestId('transit-hint')).toHaveTextContent('0.75 km away');
  });

  it('shows "unknown" transit hint when station name is null', async () => {
    const q = { ...QUESTION, category: 'transit', transitNearestStationName: null, transitNearestStationDistanceKm: null };
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [q] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() =>
      expect(screen.getByTestId('transit-hint')).toHaveTextContent(/unknown/i)
    );
  });

  it('does not render a transit hint for non-transit questions', async () => {
    api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [QUESTION] });
    render(<AnswerPanel player={HIDER} game={GAME} />);
    await waitFor(() => screen.getByLabelText(/your answer/i));
    expect(screen.queryByTestId('transit-hint')).not.toBeInTheDocument();
  });
});

// ── QuestionPanel measuring inputs ────────────────────────────────────────────

describe('QuestionPanel measuring', () => {
  it('shows target lat/lon inputs when category is measuring', async () => {
    const user = userEvent.setup();
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await user.selectOptions(screen.getByLabelText(/category/i), 'measuring');
    expect(screen.getByLabelText(/target latitude/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target longitude/i)).toBeInTheDocument();
  });

  it('includes measuring params in submitQuestion call when category is measuring', async () => {
    const user = userEvent.setup();
    api.submitQuestion.mockResolvedValue({ ...QUESTION, category: 'measuring', questionId: 'q-m1' });
    render(<QuestionPanel player={SEEKER} game={GAME} />);

    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.selectOptions(screen.getByLabelText(/category/i), 'measuring');
    await user.type(screen.getByRole('textbox', { name: /question/i }), 'Are you closer to the tower?');
    await user.type(screen.getByLabelText(/target latitude/i), '51.5');
    await user.type(screen.getByLabelText(/target longitude/i), '-0.1');
    await user.click(screen.getByRole('button', { name: /submit question/i }));

    await waitFor(() =>
      expect(api.submitQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          category:           'measuring',
          measuringTargetLat: 51.5,
          measuringTargetLon: -0.1,
        })
      )
    );
  });
});

// ── QuestionPanel tentacle inputs ─────────────────────────────────────────────

describe('QuestionPanel tentacle', () => {
  it('shows target lat/lon/radius inputs when category is tentacle', async () => {
    const user = userEvent.setup();
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    await user.selectOptions(screen.getByLabelText(/category/i), 'tentacle');
    expect(screen.getByLabelText(/target latitude/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target longitude/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/radius \(km\)/i)).toBeInTheDocument();
  });

  it('includes tentacle params in submitQuestion call when category is tentacle', async () => {
    const user = userEvent.setup();
    api.submitQuestion.mockResolvedValue({ ...QUESTION, category: 'tentacle', questionId: 'q-t1' });
    render(<QuestionPanel player={SEEKER} game={GAME} />);

    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.selectOptions(screen.getByLabelText(/category/i), 'tentacle');
    await user.type(screen.getByRole('textbox', { name: /question/i }), 'Are you near the tower?');
    await user.type(screen.getByLabelText(/target latitude/i), '51.5');
    await user.type(screen.getByLabelText(/target longitude/i), '-0.1');
    await user.type(screen.getByLabelText(/radius \(km\)/i), '2');
    await user.click(screen.getByRole('button', { name: /submit question/i }));

    await waitFor(() =>
      expect(api.submitQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          category:           'tentacle',
          tentacleTargetLat:  51.5,
          tentacleTargetLon:  -0.1,
          tentacleRadiusKm:   2,
        })
      )
    );
  });
});
