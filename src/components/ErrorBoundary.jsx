/**
 * ErrorBoundary — catches unhandled render errors in the component tree below it.
 *
 * NOTE: React Error Boundaries must be class components. This is the one legitimate
 * exception to the project's "functional components only" rule — React does not
 * support getDerivedStateFromError or componentDidCatch in function components.
 *
 * Props:
 *   children — React node(s) to render when no error has occurred
 *   onError  — optional callback(error, errorInfo) fired when an error is caught (useful for tests)
 */
import { Component } from 'react';
import styles from './ErrorBoundary.module.css';

export default class ErrorBoundary extends Component {
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message ?? 'Unknown error' };
  }

  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className={styles.container}>
          <h2>Something went wrong</h2>
          <p className={styles.message}>{this.state.message}</p>
          <button
            type="button"
            className={styles.reloadBtn}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
