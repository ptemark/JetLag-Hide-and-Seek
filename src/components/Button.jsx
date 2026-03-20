import styles from './Button.module.css';

/**
 * Reusable button component with three visual variants.
 *
 * @param {object}   props
 * @param {'primary'|'ghost'|'danger'} [props.variant='primary'] - Visual style variant.
 * @param {React.ReactNode} props.children - Button label content.
 * @param {boolean}  [props.disabled=false] - Disables the button when true.
 * @param {'button'|'submit'|'reset'} [props.type='button'] - HTML button type attribute.
 * @param {Function} [props.onClick] - Click handler.
 * @param {string}   [props.className] - Additional CSS class to merge.
 * @param {string}   [props.aria-label] - Accessible label for icon-only buttons.
 */
export default function Button({
  variant = 'primary',
  children,
  disabled = false,
  type = 'button',
  onClick,
  className,
  ...rest
}) {
  const variantClass = styles[variant] ?? styles.primary;
  const combinedClass = [styles.btn, variantClass, className].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={combinedClass}
      {...rest}
    >
      {children}
    </button>
  );
}
