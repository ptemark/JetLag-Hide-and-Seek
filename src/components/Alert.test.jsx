import { render, screen } from '@testing-library/react';
import Alert from './Alert.jsx';

describe('Alert', () => {
  it('renders with role="alert"', () => {
    render(<Alert>Something went wrong</Alert>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders children text', () => {
    render(<Alert>Error: invalid input</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Error: invalid input');
  });

  it('applies the module CSS class', () => {
    render(<Alert>Styled error</Alert>);
    const el = screen.getByRole('alert');
    // CSS Modules produce a hashed class name; verify at least one class is applied.
    expect(el.className).not.toBe('');
  });
});
