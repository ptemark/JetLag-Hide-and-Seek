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
  api.listQuestions.mockResolvedValue({ playerId: 'p2', questions: [] });
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

  it('renders all four category options', () => {
    render(<QuestionPanel player={SEEKER} game={GAME} />);
    const select = screen.getByLabelText(/category/i);
    expect(select).toBeInTheDocument();
    ['matching', 'thermometer', 'photo', 'tentacle'].forEach((cat) => {
      expect(screen.getByRole('option', { name: cat })).toBeInTheDocument();
    });
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

  it('shows submitted questions section only after first submission', async () => {
    const user = userEvent.setup();
    api.submitQuestion.mockResolvedValue(QUESTION);
    render(<QuestionPanel player={SEEKER} game={GAME} />);

    expect(screen.queryByText(/your questions/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/hider id/i), 'p2');
    await user.type(screen.getByRole('textbox', { name: /question/i }), 'Hello?');
    await user.click(screen.getByRole('button', { name: /submit question/i }));

    await waitFor(() =>
      expect(screen.getByText(/your questions/i)).toBeInTheDocument()
    );
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
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalledWith('p2'));
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
});
