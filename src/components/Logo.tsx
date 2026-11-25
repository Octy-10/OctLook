/** Brand mark: an octagonal frame around a gradient iris (see assets/icon.svg). */
export function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="octlook-iris" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B8CFF" />
          <stop offset="0.55" stopColor="#8F6BFF" />
          <stop offset="1" stopColor="#FF7AC6" />
        </linearGradient>
      </defs>
      <polygon
        points="8.3,2.5 15.7,2.5 21.5,8.3 21.5,15.7 15.7,21.5 8.3,21.5 2.5,15.7 2.5,8.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="4" fill="url(#octlook-iris)" />
    </svg>
  );
}
