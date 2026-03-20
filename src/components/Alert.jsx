import styles from './Alert.module.css';

/**
 * Alert — styled error/alert banner implementing the DESIGN.md §22 alert spec.
 *
 * Props:
 *   children — the message text or elements to display inside the alert.
 */
export default function Alert({ children }) {
  return (
    <div role="alert" className={styles.alert}>
      {children}
    </div>
  );
}
