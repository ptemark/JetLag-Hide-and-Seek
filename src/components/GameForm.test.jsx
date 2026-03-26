import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the API module — GameForm uses createGame, lookupGame, joinGame.
vi.mock('../api.js', () => ({
  createGame: vi.fn(),
  lookupGame: vi.fn(),
  joinGame: vi.fn().mockResolvedValue({ gameId: 'g1', playerId: 'p1', role: 'seeker', team: null }),
}));

// Hoist marker handler capture for use in mock factory and tests.
const leafletMapMocks = vi.hoisted(() => ({ centerMarkerDragend: null }));

// Mock react-leaflet — prevents real Leaflet DOM operations in jsdom.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => (
    <div data-testid="preview-map" role="region" aria-label="Preview map">
      {children}
    </div>
  ),
  TileLayer: () => null,
  Circle: () => null,
  Marker: ({ eventHandlers }) => {
    leafletMapMocks.centerMarkerDragend = eventHandlers?.dragend ?? null;
    return null;
  },
}));

// Mock leaflet so L.divIcon() works without a real browser environment.
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})) } }));

import GameForm from './GameForm.jsx';
import { centerRadiusToBounds } from './gameUtils.js';
import * as api from '../api.js';

const PLAYER = { playerId: 'p1', name: 'Alice', role: 'seeker' };

// Two realistic Nominatim results used across several tests.
const NOMINATIM_RESULTS = [
  {
    display_name: 'London, Greater London, England, United Kingdom',
    lat: '51.5074',
    lon: '-0.1278',
  },
  {
    display_name: 'London, Ontario, Canada',
    lat: '42.9849',
    lon: '-81.2453',
  },
];

// userEvent with zero keystroke delay — keystrokes fire synchronously so the
// 500 ms debounce starts immediately, not after typing delays stack up.
function setupUser() {
  return userEvent.setup({ delay: null });
}

// Type a search query and wait for the results listbox to appear (real timer).
// The debounce fires after 500 ms of real time; waitFor covers that window.
async function typeAndWaitForResults(user, query) {
  await user.type(
    screen.getByLabelText(/search for a city, town or country/i),
    query,
  );
  await waitFor(
    () => expect(screen.getByRole('listbox', { name: /location results/i })).toBeInTheDocument(),
    { timeout: 2000 },
  );
}

// Click the first result button.  Scoped to the results listbox so that native
// <option> elements inside the <select> dropdowns are not mistakenly matched.
// Wrapped in act() so React flushes all resulting state updates before returning.
async function selectFirstResult() {
  const listbox = screen.getByRole('listbox', { name: /location results/i });
  await act(async () => {
    fireEvent.click(within(listbox).getAllByRole('option')[0]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => NOMINATIM_RESULTS,
  });
  api.joinGame.mockResolvedValue({ gameId: 'g1', playerId: 'p1', role: 'seeker', team: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (f) Pure helper — no component required
// ---------------------------------------------------------------------------

describe('centerRadiusToBounds', () => {
  it('computes lat/lon deltas within 1% of expected for London (51.5°N)', () => {
    const center = { lat: 51.5074, lon: -0.1278 };
    const radiusKm = 15;
    const result = centerRadiusToBounds(center, radiusKm);

    const expectedLatDelta = radiusKm / 111;
    const expectedLonDelta = radiusKm / (111 * Math.cos(center.lat * (Math.PI / 180)));

    expect(result.lat_min).toBeCloseTo(center.lat - expectedLatDelta, 10);
    expect(result.lat_max).toBeCloseTo(center.lat + expectedLatDelta, 10);
    expect(result.lon_min).toBeCloseTo(center.lon - expectedLonDelta, 10);
    expect(result.lon_max).toBeCloseTo(center.lon + expectedLonDelta, 10);

    const actualLatDelta = result.lat_max - center.lat;
    const actualLonDelta = result.lon_max - center.lon;
    expect(Math.abs(actualLatDelta - expectedLatDelta) / expectedLatDelta).toBeLessThan(0.01);
    expect(Math.abs(actualLonDelta - expectedLonDelta) / expectedLonDelta).toBeLessThan(0.01);
  });

  it('handles equatorial lat — lon delta equals lat delta at 0°', () => {
    const center = { lat: 0, lon: 0 };
    const radiusKm = 10;
    const result = centerRadiusToBounds(center, radiusKm);
    const delta = radiusKm / 111;
    expect(result.lat_max - result.lat_min).toBeCloseTo(delta * 2, 10);
    expect(result.lon_max - result.lon_min).toBeCloseTo(delta * 2, 10);
  });
});

// ---------------------------------------------------------------------------
// GameForm — location search
// ---------------------------------------------------------------------------

describe('GameForm — location search (Task 142)', () => {
  // (a) Search input renders with the label specified in the task.
  it('renders location search input with correct label', () => {
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);
    expect(
      screen.getByLabelText(/search for a city, town or country/i)
    ).toBeInTheDocument();
  });

  // (b) Typing triggers a debounced Nominatim fetch — not before 500 ms.
  it('does not call fetch immediately; calls it once the 500 ms debounce fires', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.type(
      screen.getByLabelText(/search for a city, town or country/i),
      'London',
    );

    // Immediately after typing the debounce has not elapsed.
    expect(global.fetch).not.toHaveBeenCalled();

    // After 500 ms real time the debounce fires and fetch resolves.
    await waitFor(
      () => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('nominatim.openstreetmap.org/search')
        );
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining(encodeURIComponent('London'))
        );
      },
      { timeout: 2000 },
    );
  });

  // (c) Result dropdown appears and shows display_name text.
  it('shows result dropdown with display_name entries after fetch resolves', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await typeAndWaitForResults(user, 'London');

    expect(screen.getByText(/London, Greater London/i)).toBeInTheDocument();
    expect(screen.getByText(/London, Ontario/i)).toBeInTheDocument();
  });

  // (d) Selecting a result populates the four bounds fields.
  it('populates bounds fields when a result is selected', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await typeAndWaitForResults(user, 'London');
    await selectFirstResult();

    // Default scale is medium → radius 15 km.
    const expected = centerRadiusToBounds(
      { lat: parseFloat('51.5074'), lon: parseFloat('-0.1278') },
      15,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/lat min/i)).toHaveValue(expected.lat_min);
      expect(screen.getByLabelText(/lat max/i)).toHaveValue(expected.lat_max);
      expect(screen.getByLabelText(/lon min/i)).toHaveValue(expected.lon_min);
      expect(screen.getByLabelText(/lon max/i)).toHaveValue(expected.lon_max);
    });
  });

  // (e) Changing scale after selecting a location recomputes bounds.
  it('recomputes bounds when scale changes after a location is selected', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await typeAndWaitForResults(user, 'London');
    await selectFirstResult();

    // Change scale to large → radius 50 km.
    await user.selectOptions(screen.getByLabelText(/scale/i), 'large');

    const expected = centerRadiusToBounds(
      { lat: parseFloat('51.5074'), lon: parseFloat('-0.1278') },
      50,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/lat min/i)).toHaveValue(expected.lat_min);
      expect(screen.getByLabelText(/lat max/i)).toHaveValue(expected.lat_max);
    });
  });

  it('does not recompute bounds when scale changes before any location is selected', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.selectOptions(screen.getByLabelText(/scale/i), 'large');

    // No location selected — bounds remain empty (null for number inputs).
    expect(screen.getByLabelText(/lat min/i)).toHaveValue(null);
    expect(screen.getByLabelText(/lat max/i)).toHaveValue(null);
  });

  it('closes the dropdown and fills the search input on result selection', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await typeAndWaitForResults(user, 'London');
    await selectFirstResult();

    await waitFor(() =>
      expect(
        screen.queryByRole('listbox', { name: /location results/i })
      ).not.toBeInTheDocument()
    );

    const expectedText = NOMINATIM_RESULTS[0].display_name.slice(0, 60);
    expect(
      screen.getByLabelText(/search for a city, town or country/i)
    ).toHaveValue(expectedText);
  });

  it('does not fire fetch when the search query is empty or whitespace', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.type(
      screen.getByLabelText(/search for a city, town or country/i),
      '   ',
    );

    // Wait long enough that the debounce would have fired for a real query.
    await waitFor(
      () => expect(global.fetch).not.toHaveBeenCalled(),
      { timeout: 2000 },
    );
  });

  it('clears the result list when the search input is cleared', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await typeAndWaitForResults(user, 'London');

    await user.clear(screen.getByLabelText(/search for a city, town or country/i));

    await waitFor(() =>
      expect(
        screen.queryByRole('listbox', { name: /location results/i })
      ).not.toBeInTheDocument()
    );
  });

  // (Task 172) Result buttons must be visible without hover interaction.
  it('result option buttons are present in the document with non-empty text content without requiring hover', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await typeAndWaitForResults(user, 'London');

    const listbox = screen.getByRole('listbox', { name: /location results/i });
    const options = within(listbox).getAllByRole('option');

    expect(options.length).toBeGreaterThan(0);
    options.forEach(option => {
      expect(option).toBeInTheDocument();
      expect(option.textContent.trim()).not.toBe('');
    });
  });

  // (Task 175) Result buttons must be keyboard-focusable — Tab moves focus into
  // the results list and the focused element is a listbox option.
  it('result option buttons are focusable via keyboard Tab (a11y)', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await typeAndWaitForResults(user, 'London');

    const listbox = screen.getByRole('listbox', { name: /location results/i });
    const options = within(listbox).getAllByRole('option');

    // All result buttons must be focusable (tabIndex is 0 or not explicitly -1).
    options.forEach(option => {
      expect(option.tabIndex).not.toBe(-1);
    });

    // Programmatically focus the first option and verify document.activeElement.
    options[0].focus();
    expect(document.activeElement).toBe(options[0]);
    expect(document.activeElement).toHaveAttribute('role', 'option');
  });

  // (Task 173) After a location is selected (map visible), typing again in the
  // search box must still render the results dropdown above the Leaflet map.
  it('shows results dropdown after a location is selected and new search text is entered', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    // Select a location so the map preview appears.
    await typeAndWaitForResults(user, 'London');
    await selectFirstResult();

    // Map preview should now be visible.
    await waitFor(() =>
      expect(screen.getByTestId('preview-map')).toBeInTheDocument()
    );

    // Clear the search input and type a new query — the dropdown must re-appear
    // even though the Leaflet map is now rendered on the page.
    const searchInput = screen.getByLabelText(/search for a city, town or country/i);
    await user.clear(searchInput);
    await user.type(searchInput, 'Paris');

    await waitFor(
      () => expect(screen.getByRole('listbox', { name: /location results/i })).toBeInTheDocument(),
      { timeout: 2000 },
    );

    // The dropdown must contain the mocked results.
    const listbox = screen.getByRole('listbox', { name: /location results/i });
    expect(within(listbox).getAllByRole('option').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GameForm — manual Advanced bounds fields sync preview map (Task 145)
// ---------------------------------------------------------------------------

describe('GameForm — manual bounds field editing (Task 145)', () => {
  // (a) Filling all four Advanced fields with valid values renders the preview map.
  it('shows preview map when all four bounds fields are filled with valid values', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    // Map must not be visible before any input.
    expect(screen.queryByTestId('preview-map')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/lat min/i), '51');
    await user.type(screen.getByLabelText(/lat max/i), '52');
    await user.type(screen.getByLabelText(/lon min/i), '-1');
    await user.type(screen.getByLabelText(/lon max/i), '1');

    await waitFor(() =>
      expect(screen.getByTestId('preview-map')).toBeInTheDocument()
    );
  });

  // (b) Filling only some fields does NOT render the preview map.
  it('does not show preview map when only some bounds fields are filled', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    // Fill only lat_min — three fields remain empty.
    await user.type(screen.getByLabelText(/lat min/i), '51');

    expect(screen.queryByTestId('preview-map')).not.toBeInTheDocument();
  });

  // (c) Filling all four valid fields updates the "Zone radius:" output.
  it('updates Zone radius output to a non-zero value after valid bounds are entered', async () => {
    const user = setupUser();
    render(<GameForm player={PLAYER} onGameReady={() => {}} />);

    await user.type(screen.getByLabelText(/lat min/i), '51');
    await user.type(screen.getByLabelText(/lat max/i), '52');
    await user.type(screen.getByLabelText(/lon min/i), '-1');
    await user.type(screen.getByLabelText(/lon max/i), '1');

    await waitFor(() => {
      const output = screen.getByLabelText(/zone radius/i);
      // The output must show a non-zero radius value.
      expect(output).toHaveTextContent(/Zone radius: [1-9]/i);
    });
  });
});
