import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeekerNotes from './SeekerNotes.jsx';

const GAME_ID = 'game-abc';
const STORAGE_KEY = `jetlag_notes_${GAME_ID}`;
const NOTES_DEBOUNCE_MS = 500;

describe('SeekerNotes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('(a) renders with label "Investigation Notes"', () => {
    render(<SeekerNotes gameId={GAME_ID} />);
    expect(screen.getByLabelText('Investigation Notes')).toBeTruthy();
  });

  it('(b) textarea has placeholder "Write your deductions here…"', () => {
    render(<SeekerNotes gameId={GAME_ID} />);
    const textarea = screen.getByLabelText('Investigation Notes');
    expect(textarea.placeholder).toBe('Write your deductions here…');
  });

  it('(c) loads existing localStorage value as initial content', () => {
    localStorage.setItem(STORAGE_KEY, 'Thermometer warmer, within 10km of park');
    render(<SeekerNotes gameId={GAME_ID} />);
    const textarea = screen.getByLabelText('Investigation Notes');
    expect(textarea.value).toBe('Thermometer warmer, within 10km of park');
  });

  // Tests (d–f) test the debounce mechanism specifically.  userEvent.type uses
  // internal async scheduling that conflicts with vi.useFakeTimers, so we use
  // fireEvent.change to directly trigger onChange (testing the debounce logic,
  // not the keyboard-input path, which is covered by tests a–c).
  it('(d) triggers localStorage.setItem after NOTES_DEBOUNCE_MS when typing', () => {
    vi.useFakeTimers();
    try {
      render(<SeekerNotes gameId={GAME_ID} />);
      const textarea = screen.getByLabelText('Investigation Notes');

      fireEvent.change(textarea, { target: { value: 'Clue: warmer' } });
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // debounce not yet fired

      vi.advanceTimersByTime(NOTES_DEBOUNCE_MS);
      expect(localStorage.getItem(STORAGE_KEY)).toBe('Clue: warmer');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('(e) debounces — rapid change events write only the final value to localStorage', () => {
    vi.useFakeTimers();
    try {
      render(<SeekerNotes gameId={GAME_ID} />);
      const textarea = screen.getByLabelText('Investigation Notes');

      // Fire multiple change events quickly — each resets the debounce timer.
      fireEvent.change(textarea, { target: { value: 'A' } });
      fireEvent.change(textarea, { target: { value: 'AB' } });
      fireEvent.change(textarea, { target: { value: 'ABC' } });

      // Debounce not yet fired — localStorage still empty.
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      // Advance past debounce — only the final value is written.
      vi.advanceTimersByTime(NOTES_DEBOUNCE_MS);
      expect(localStorage.getItem(STORAGE_KEY)).toBe('ABC');

      // Verify no intermediate values were written by advancing past another debounce period.
      vi.advanceTimersByTime(NOTES_DEBOUNCE_MS * 2);
      // Still only the final 'ABC' value (no additional write).
      expect(localStorage.getItem(STORAGE_KEY)).toBe('ABC');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('(f) clears pending debounce timer on unmount — no setItem fires after unmount', () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const { unmount } = render(<SeekerNotes gameId={GAME_ID} />);
      const textarea = screen.getByLabelText('Investigation Notes');

      fireEvent.change(textarea, { target: { value: 'Note' } });
      expect(setSpy).not.toHaveBeenCalled();

      unmount(); // should clear the debounce timer

      vi.advanceTimersByTime(NOTES_DEBOUNCE_MS * 2);
      expect(setSpy).not.toHaveBeenCalled(); // timer was cleared on unmount
    } finally {
      setSpy.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('(g) persists notes across re-renders (initial value from localStorage)', async () => {
    const user = userEvent.setup();
    render(<SeekerNotes gameId={GAME_ID} />);
    const textarea = screen.getByLabelText('Investigation Notes');

    // Simulate a real keystroke so React updates state.
    await user.type(textarea, 'My notes');
    // Debounce fires after real timers in test environment.
    await new Promise((r) => setTimeout(r, NOTES_DEBOUNCE_MS + 50));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('My notes');
  });
});
