import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App.jsx';

vi.mock('./components/Lobby.jsx', () => ({
  default: () => <h1>JetLag: The Game</h1>,
}));

describe('App', () => {
  it('renders without error', () => {
    render(<App />);
    expect(document.body).toBeTruthy();
  });

  it('renders the Lobby component', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /JetLag/i })).toBeInTheDocument();
  });
});
