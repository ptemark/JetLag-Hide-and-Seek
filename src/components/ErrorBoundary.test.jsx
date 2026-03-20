import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary.jsx';

/** Helper: a component that unconditionally throws during render. */
function ThrowingChild({ message = 'test error' }) {
  throw new Error(message);
}

/** Helper: a component that renders normally. */
function NormalChild() {
  return <p>All good</p>;
}

// Suppress React's console.error output for expected boundary errors in tests.
const originalConsoleError = console.error;
afterEach(() => {
  console.error = originalConsoleError;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <NormalChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders role="alert" fallback with "Something went wrong" when a child throws', () => {
    console.error = vi.fn(); // suppress React's error output
    render(
      <ErrorBoundary>
        <ThrowingChild message="render failure" />
      </ErrorBoundary>
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('render failure')).toBeInTheDocument();
  });

  it('"Reload" button calls window.location.reload', async () => {
    console.error = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('calls onError prop with the error and error info when an error is caught', () => {
    console.error = vi.fn();
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingChild message="caught by callback" />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, info] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('caught by callback');
    expect(info).toHaveProperty('componentStack');
  });
});
