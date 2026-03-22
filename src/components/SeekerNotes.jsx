/**
 * SeekerNotes — In-game notepad for seekers to record deductions (Investigation Book).
 *
 * Props:
 *   gameId — string; used to scope the localStorage persistence key so notes
 *             survive page refreshes but are isolated per game
 *
 * RULES.md §Players: "Seekers get the Investigation Book" — a place to record
 * deductions from thermometer, tentacle, matching, and measuring question answers.
 */
import { useState, useRef, useEffect } from 'react';
import styles from './SeekerNotes.module.css';

/** localStorage key prefix — scoped per game to avoid cross-game contamination. */
const NOTES_STORAGE_KEY_PREFIX = 'jetlag_notes_';

/** Debounce delay in ms before writing to localStorage (reduces write frequency). */
const NOTES_DEBOUNCE_MS = 500;

/**
 * @param {{ gameId: string }} props
 */
export default function SeekerNotes({ gameId }) {
  const [notes, setNotes] = useState(
    () => localStorage.getItem(NOTES_STORAGE_KEY_PREFIX + gameId) ?? '',
  );
  const saveTimerRef = useRef(null);

  // Clear any pending save timer on unmount to prevent post-unmount state updates.
  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  function handleChange(e) {
    const value = e.target.value;
    setNotes(value);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(NOTES_STORAGE_KEY_PREFIX + gameId, value);
    }, NOTES_DEBOUNCE_MS);
  }

  return (
    <section className={styles.notesSection}>
      <label htmlFor="seeker-notes">Investigation Notes</label>
      <textarea
        id="seeker-notes"
        value={notes}
        onChange={handleChange}
        placeholder="Write your deductions here…"
        className={styles.notesArea}
      />
    </section>
  );
}
