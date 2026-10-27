import QRCode from 'qrcode'

/**
 * Label codes are `<prefix>-<product code>-<letters><digits>`, e.g.
 * `RZCIR-MVN191-AAA001` — by default prefix RZCIR, then three letters and
 * three digits, issued in ascending serial order. An administrator can change
 * the prefix and how many letters and digits (stored in
 * `app_settings.code_format`). The database mints and reserves the codes;
 * these helpers only mirror the format for previews.
 */
export const CODE_PREFIX = 'RZCIR'
/** The product code for the curtain line currently in service. */
export const DEFAULT_PRODUCT_CODE = 'MVN191'

/** How many letters and digits make up the serial block. */
export interface CodeFormat {
  prefix: string
  letters: number
  digits: number
}

export const DEFAULT_CODE_FORMAT: CodeFormat = { prefix: CODE_PREFIX, letters: 3, digits: 3 }

/** Uppercase letters and digits only, at most 10 - what the database accepts as a prefix. */
export function normalisePrefix(raw: string): string {
  return (raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10)
}

export function isValidPrefix(prefix: string): boolean {
  return /^[A-Z0-9]{3,10}$/.test(prefix)
}
export const MAX_LETTERS = 6
export const MAX_DIGITS = 8

/** The first serial of a format, shown in previews: AAA001, AAAA0001, … */
export function serialSample(f: CodeFormat): string {
  return 'A'.repeat(f.letters) + '0'.repeat(Math.max(0, f.digits - 1)) + '1'
}

/** How many codes a format can ever issue per product line (the digits never run to all zeros). */
export function codeCapacity(f: CodeFormat): bigint {
  return 26n ** BigInt(f.letters) * (10n ** BigInt(f.digits) - 1n)
}

/** Uppercase, letters and digits only — matches what the database accepts. */
export function normaliseProductCode(code: string): string {
  return (code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

export function codePrefixFor(productCode: string, prefix: string = CODE_PREFIX): string {
  return `${prefix || CODE_PREFIX}-${normaliseProductCode(productCode) || DEFAULT_PRODUCT_CODE}-`
}

export function sampleCode(productCode: string, format: CodeFormat = DEFAULT_CODE_FORMAT): string {
  return `${codePrefixFor(productCode, format.prefix)}${serialSample(format)}`
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
