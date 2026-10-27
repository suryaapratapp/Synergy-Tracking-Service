/** The app mark: a scan frame on the brand teal. Used on the sign-in screen. */
export default function BrandMark({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Tex-Trak">
      <rect width="64" height="64" rx="17" fill="#0f766e" />
      <g fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 26v-5a3 3 0 0 1 3-3h5M38 18h5a3 3 0 0 1 3 3v5M46 38v5a3 3 0 0 1-3 3h-5M26 46h-5a3 3 0 0 1-3-3v-5" />
        <path d="M24 32h16" />
      </g>
    </svg>
  )
}
