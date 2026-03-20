import { render, screen } from '@testing-library/react';
import AppHeader from './AppHeader.jsx';

describe('AppHeader', () => {
  it('renders heading with text "JetLag: The Game"', () => {
    render(<AppHeader />);
    expect(screen.getByRole('heading', { name: /JetLag: The Game/i })).toBeInTheDocument();
  });

  it('renders the tagline', () => {
    render(<AppHeader />);
    expect(screen.getByText(/Hide and seek across transit networks/i)).toBeInTheDocument();
  });

  it('renders an SVG element with aria-label="JetLag logo"', () => {
    render(<AppHeader />);
    expect(screen.getByRole('img', { name: /JetLag logo/i })).toBeInTheDocument();
  });
});
