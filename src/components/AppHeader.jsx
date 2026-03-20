import styles from './AppHeader.module.css';

/**
 * AppHeader — branded page header for JetLag: The Game.
 *
 * Renders the sunset semicircle logo (five concentric arcs in the brand
 * sunset palette) with an airplane silhouette, followed by the app title
 * and tagline.  No props required.
 */
export default function AppHeader() {
  return (
    <header className={styles.header}>
      {/*
        Logo: 120×70 viewBox.
        Sunset semicircles are drawn with the centre at (60, 70) — the
        bottom of the viewport — so only the upper half of each circle is
        visible, producing the "rising sun" band effect.
        Arcs are painted outermost-first so each inner arc covers the previous.
        The airplane silhouette (top-down, pointing up) sits in the upper
        portion of the viewBox.
      */}
      <svg
        className={styles.logo}
        viewBox="0 0 120 70"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="JetLag logo"
        role="img"
      >
        {/* Dark navy background */}
        <rect width="120" height="70" fill="#1B2A3A" />

        {/* Sunset semicircle arcs — centre (60, 70), bottom-half upward */}
        {/* r=60  sunset-4 deep red-orange */}
        <path d="M0,70 A60,60 0 0,1 120,70 Z" fill="#C83A18" />
        {/* r=48  sunset-3 burnt orange */}
        <path d="M12,70 A48,48 0 0,1 108,70 Z" fill="#E05828" />
        {/* r=36  sunset-2 amber orange */}
        <path d="M24,70 A36,36 0 0,1 96,70 Z" fill="#F08730" />
        {/* r=24  sunset-1 warm yellow */}
        <path d="M36,70 A24,24 0 0,1 84,70 Z" fill="#F5C84A" />
        {/* r=12  white inner highlight */}
        <path d="M48,70 A12,12 0 0,1 72,70 Z" fill="#FDFAF4" />

        {/*
          Airplane silhouette — top-down view, pointing upward, centred at
          (60, 30).  All in dark navy so it reads as a cutout over the arcs.
        */}
        <path
          d="M60,13
             L63,27 L76,34 L76,38 L63,32
             L65,42 L70,45 L70,47 L60,44
             L50,47 L50,45 L55,42
             L57,32 L44,38 L44,34 L57,27
             Z"
          fill="#1B2A3A"
        />
      </svg>

      <h1>JetLag: The Game</h1>
      <p>Hide and seek across transit networks.</p>
    </header>
  );
}
