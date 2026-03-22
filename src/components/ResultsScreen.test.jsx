// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ResultsScreen from './ResultsScreen.jsx';

describe('ResultsScreen', () => {
  const baseProps = {
    winner: 'seekers',
    elapsedMs: 90_000,    // 1m 30s
    bonusSeconds: 0,
    onPlayAgain: vi.fn(),
  };

  it('shows "Seekers Win!" when winner is seekers', () => {
    render(<ResultsScreen {...baseProps} winner="seekers" />);
    expect(screen.getByText(/Seekers Win!/i)).toBeInTheDocument();
  });

  it('shows "Hider Wins!" when winner is hider', () => {
    render(<ResultsScreen {...baseProps} winner="hider" />);
    expect(screen.getByText(/Hider Wins!/i)).toBeInTheDocument();
  });

  it('displays elapsed hiding time in human-readable format', () => {
    render(<ResultsScreen {...baseProps} elapsedMs={90_000} />); // 1m 30s
    expect(screen.getByText('1m 30s')).toBeInTheDocument();
  });

  it('displays hours when elapsed time exceeds one hour', () => {
    render(<ResultsScreen {...baseProps} elapsedMs={3_720_000} />); // 1h 2m 0s
    expect(screen.getByText('1h 2m 0s')).toBeInTheDocument();
  });

  it('shows final score in seconds', () => {
    render(<ResultsScreen {...baseProps} elapsedMs={60_000} bonusSeconds={0} />); // 60s score
    expect(screen.getByText('60s')).toBeInTheDocument();
  });

  it('adds bonus seconds to final score', () => {
    // 60s base + 600s bonus = 660s
    render(<ResultsScreen {...baseProps} elapsedMs={60_000} bonusSeconds={600} />);
    expect(screen.getByText('660s')).toBeInTheDocument();
  });

  it('shows card bonus row when bonusSeconds > 0', () => {
    render(<ResultsScreen {...baseProps} bonusSeconds={600} />);
    expect(screen.getByText(/Card bonus:/i)).toBeInTheDocument();
    expect(screen.getByText('+10m 0s')).toBeInTheDocument();
  });

  it('hides card bonus row when bonusSeconds is 0', () => {
    render(<ResultsScreen {...baseProps} bonusSeconds={0} />);
    expect(screen.queryByText(/Card bonus:/i)).not.toBeInTheDocument();
  });

  it('renders results table with accessible label', () => {
    render(<ResultsScreen {...baseProps} />);
    expect(screen.getByRole('table', { name: /game results/i })).toBeInTheDocument();
  });

  it('renders Play Again button', () => {
    render(<ResultsScreen {...baseProps} />);
    expect(screen.getByRole('button', { name: /play again/i })).toBeInTheDocument();
  });

  it('calls onPlayAgain when Play Again is clicked', () => {
    const onPlayAgain = vi.fn();
    render(<ResultsScreen {...baseProps} onPlayAgain={onPlayAgain} />);
    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(onPlayAgain).toHaveBeenCalledOnce();
  });

  it('renders as a dialog with accessible label', () => {
    render(<ResultsScreen {...baseProps} />);
    expect(screen.getByRole('dialog', { name: /results screen/i })).toBeInTheDocument();
  });

  it('handles zero elapsed time gracefully', () => {
    render(<ResultsScreen {...baseProps} elapsedMs={0} bonusSeconds={0} />);
    // Both hiding time and final score show "0s" — there should be at least one
    expect(screen.getAllByText('0s').length).toBeGreaterThanOrEqual(1);
  });

  it('handles negative elapsed time as zero', () => {
    render(<ResultsScreen {...baseProps} elapsedMs={-1000} bonusSeconds={0} />);
    expect(screen.getAllByText('0s').length).toBeGreaterThanOrEqual(1);
  });

  it('defaults bonusSeconds to 0 when not provided', () => {
    render(<ResultsScreen winner="hider" elapsedMs={30_000} onPlayAgain={vi.fn()} />);
    // 30s appears in both hiding time and final score rows; no bonus row
    expect(screen.getAllByText('30s').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Card bonus:/i)).not.toBeInTheDocument();
  });

  // captureTeam attribution (Task 171)
  it('shows "Seekers Win!" without team label when captureTeam is not provided', () => {
    render(<ResultsScreen {...baseProps} winner="seekers" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Seekers Win!');
    expect(screen.getByRole('heading').textContent).not.toMatch(/Team/);
  });

  it('shows "Seekers Win! (Team A)" when captureTeam is A', () => {
    render(<ResultsScreen {...baseProps} winner="seekers" captureTeam="A" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Seekers Win! (Team A)');
  });

  it('shows "Seekers Win! (Team B)" when captureTeam is B', () => {
    render(<ResultsScreen {...baseProps} winner="seekers" captureTeam="B" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Seekers Win! (Team B)');
  });

  it('ignores captureTeam when hider wins', () => {
    render(<ResultsScreen {...baseProps} winner="hider" captureTeam="A" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Hider Wins!');
    expect(screen.getByRole('heading').textContent).not.toMatch(/Team/);
  });
});
