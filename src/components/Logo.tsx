/** Brand mark: a crescent moon (see assets/icon.svg), drawn in the current text colour. */
export function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <mask id="octlook-crescent">
        <circle cx="11.6" cy="12.6" r="9" fill="#fff" />
        <circle cx="15.3" cy="9.3" r="7.5" fill="#000" />
      </mask>
      <rect width="24" height="24" fill="currentColor" mask="url(#octlook-crescent)" />
    </svg>
  );
}
