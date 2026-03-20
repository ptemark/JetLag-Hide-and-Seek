import Lobby from './components/Lobby.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import styles from './App.module.css';

export default function App() {
  return (
    <ErrorBoundary>
      <div className={styles.root}>
        <Lobby />
      </div>
    </ErrorBoundary>
  );
}
