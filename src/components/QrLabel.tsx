/**
 * A single printable label: a square QR with the code in small type beneath,
 * so a damaged or unreadable label can still be entered by hand.
 */
export default function QrLabel({
  code,
  svg,
  size = 'md',
}: {
  code: string
  svg: string | undefined
  size?: 'sm' | 'md'
}) {
  return (
    <figure className={`qr-label qr-label-${size}`}>
      <div
        className="qr-label-code"
        aria-hidden="true"
        // Rendered by the qrcode library from the code below; no user input.
        dangerouslySetInnerHTML={{ __html: svg ?? '' }}
      />
      <figcaption className="qr-label-text">{code}</figcaption>
    </figure>
  )
}
