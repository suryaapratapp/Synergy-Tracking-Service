import { useId } from 'react'

/**
 * The app mark: a frosted-glass card over soft coloured light, with the scan frame
 * and a glowing beam. Same design as public/icon.svg and the launcher icon
 * (scripts/make-icons.py).
 */
export default function BrandMark({ size = 64 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} role="img" aria-label="Tex-Trak" className="brand-mark">

  <defs>
    <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#16b8a6"/><stop offset="1" stopColor="#093e3c"/></linearGradient>
    <linearGradient id={`${uid}-veil`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".38"/><stop offset="1" stopColor="#fff" stopOpacity=".06"/></linearGradient>
    <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".9"/><stop offset=".6" stopColor="#fff" stopOpacity=".25"/><stop offset="1" stopColor="#fff" stopOpacity=".12"/></linearGradient>
    <filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="46"/></filter>
    <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <clipPath id={`${uid}-tile`}><rect width="512" height="512" rx="112"/></clipPath>
  </defs>
  <g clipPath={`url(#${uid}-tile)`}>
    <rect width="512" height="512" fill={`url(#${uid}-bg)`}/>
    <g filter={`url(#${uid}-blur)`}>
      <circle cx="410" cy="92" r="130" fill="#ff8a4c" opacity=".92"/>
      <circle cx="86" cy="430" r="150" fill="#4aa3ff" opacity=".85"/>
      <circle cx="140" cy="84" r="100" fill="#7ef0d8" opacity=".55"/>
      <circle cx="436" cy="448" r="90" fill="#8f72e0" opacity=".5"/>
    </g>
    <rect x="86" y="96" width="340" height="340" rx="92" fill="#022" opacity=".35" filter={`url(#${uid}-soft)`}/>
    <rect x="86" y="86" width="340" height="340" rx="92" fill={`url(#${uid}-veil)`}/>
    <path d="M118 150a60 60 0 0 1 60-60h156a60 60 0 0 1 60 60 200 90 0 0 1-276 0Z" fill="#fff" opacity=".13"/>
    <rect x="87" y="87" width="338" height="338" rx="91" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="4"/>
    <g fill="none" stroke="#fff" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round">
      <path d="M170 214v-34a10 10 0 0 1 10-10h34M298 170h34a10 10 0 0 1 10 10v34M342 298v34a10 10 0 0 1-10 10h-34M214 342h-34a10 10 0 0 1-10-10v-34"/>
    </g>
    <rect x="196" y="244" width="120" height="24" rx="12" fill="#ff9a5c" opacity=".8" filter={`url(#${uid}-soft)`}/>
    <rect x="200" y="246" width="112" height="20" rx="10" fill="#ffece0"/>
  </g>

    </svg>
  )
}
