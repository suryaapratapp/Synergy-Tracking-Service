import QRCode from 'qrcode'

/**
 * Label codes are `RZCIR-<first four letters of the product>-<6 digits>`,
 * e.g. RZCIR-CURT-048213. The database generates and reserves them; these
 * helpers only mirror the format for previews and validation.
 */
export const CODE_PREFIX = 'RZCIR'

export function codePrefixFor(productType: string): string {
  const letters = (productType || 'Product').replace(/[^a-zA-Z]/g, '').slice(0, 4)
  return `${CODE_PREFIX}-${letters.padEnd(4, 'X').toUpperCase()}-`
}

export function sampleCode(productType: string): string {
  return `${codePrefixFor(productType)}000000`
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
