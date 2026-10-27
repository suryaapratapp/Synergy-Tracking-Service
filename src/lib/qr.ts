import QRCode from 'qrcode'

/**
 * Label codes are `RZCIR-<product code>-AAA999`, e.g.
 * `RZCIR-MVN191-AAA001` — three letters then three digits, issued in
 * ascending serial order. The database mints and reserves them; these
 * helpers only mirror the format for previews.
 */
export const CODE_PREFIX = 'RZCIR'
/** The product code for the curtain line currently in service. */
export const DEFAULT_PRODUCT_CODE = 'MVN191'
/** Shape of the serial block, shown in previews. */
export const SERIAL_SAMPLE = 'AAA001'

/** Uppercase, letters and digits only — matches what the database accepts. */
export function normaliseProductCode(code: string): string {
  return (code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

export function codePrefixFor(productCode: string): string {
  return `${CODE_PREFIX}-${normaliseProductCode(productCode) || DEFAULT_PRODUCT_CODE}-`
}

export function sampleCode(productCode: string): string {
  return `${codePrefixFor(productCode)}${SERIAL_SAMPLE}`
}

/** Renders a code as a standalone SVG string, sized by the caller's CSS. */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 256,
  })
}

/** Strips the fixed width/height so the SVG scales to its container. */
export function responsiveSvg(svg: string): string {
  return svg.replace(/<svg([^>]*)>/, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)="[^"]*"/g, '')
    return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`
  })
}

export async function qrSvgMany(codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const code of codes) {
    out.set(code, responsiveSvg(await qrSvg(code)))
  }
  return out
}
