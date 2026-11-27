// Parses the "Allowed networks" list on Admin → Exam security: one IPv4/IPv6
// address or CIDR range per line. A bare address means just that address
// (/32 or /128). Postgres' cidr type rejects a range with host bits set
// (203.0.113.5/24), so that is reported with the range that was meant.

export type CidrResult = { ok: true; cidr: string } | { ok: false; error: string }

function parseV4(s: string): number[] | null {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  const out = parts.map(p => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  return out.every(n => n >= 0 && n <= 255) ? out : null
}

// 8 groups of 16 bits; supports "::" and a trailing dotted IPv4 part.
function parseV6(s: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(s) || s.split('::').length > 2) return null
  let tail: number[] = []
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const b = parseV4(v4[2])
    if (!b) return null
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]]
    s = v4[1].endsWith('::') ? v4[1] : v4[1].slice(0, -1)
  }
  const group = (g: string) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN)
  const [head, rest] = s.split('::')
  const hs = head ? head.split(':').map(group) : []
  const rs = rest !== undefined && rest !== '' ? rest.split(':').map(group) : []
  if ([...hs, ...rs].some(Number.isNaN)) return null
  const fixed = hs.length + rs.length + tail.length
  if (rest === undefined) return fixed === 8 ? [...hs, ...tail] : null
  if (fixed > 7) return null
  return [...hs, ...Array(8 - fixed).fill(0), ...rs, ...tail]
}

function mask(words: number[], bitsPerWord: number, prefix: number): number[] {
  return words.map((w, i) => {
    const keep = Math.max(0, Math.min(bitsPerWord, prefix - i * bitsPerWord))
    return keep === 0 ? 0 : (w & ((0xffff_ffff << (bitsPerWord - keep)) >>> 0) & ((1 << bitsPerWord) - 1))
  })
}

const fmtV6 = (g: number[]) => {
  // Compress the longest run of zero groups (RFC 5952 style).
  let best = -1, bestLen = 0
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue }
    let j = i
    while (j < 8 && g[j] === 0) j++
    if (j - i > bestLen && j - i > 1) { best = i; bestLen = j - i }
    i = j
  }
  const hex = g.map(x => x.toString(16))
  if (best < 0) return hex.join(':')
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`
}

export function parseCidr(input: string): CidrResult {
  const raw = input.trim()
  const [addr, pfx, extra] = raw.split('/')
  if (extra !== undefined || !addr) return { ok: false, error: `Not an IP address or range: ${raw}` }
  const v4 = parseV4(addr)
  const v6 = v4 ? null : parseV6(addr)
  if (!v4 && !v6) return { ok: false, error: `Not an IP address or range: ${raw}` }
  const max = v4 ? 32 : 128
  if (pfx !== undefined && !/^\d{1,3}$/.test(pfx)) return { ok: false, error: `Bad prefix length in ${raw}` }
  const prefix = pfx === undefined ? max : Number(pfx)
  if (prefix > max) return { ok: false, error: `Prefix length in ${raw} must be 0–${max}` }
  if (prefix < (v4 ? 8 : 16)) return { ok: false, error: `${raw} is far too wide to be one exam room's network` }
  const words = v4 ?? v6!
  // The laptop's own Wi-Fi address (192.168.x.x etc.) never reaches the
  // server; only the network's public address does.
  const priv = v4
    ? v4[0] === 10 || v4[0] === 127 || (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) || (v4[0] === 192 && v4[1] === 168)
      || (v4[0] === 169 && v4[1] === 254) || (v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127)
    : (v6![0] & 0xfe00) === 0xfc00 || (v6![0] & 0xffc0) === 0xfe80 || v6!.every((w, i) => w === (i === 7 ? 1 : 0))
  if (priv) return { ok: false, error: `${raw} is a private/local address. Enter the network's PUBLIC address (open https://api.ipify.org on the exam-room Wi-Fi).` }
  const masked = mask(words, v4 ? 8 : 16, prefix)
  const show = (w: number[]) => (v4 ? w.join('.') : fmtV6(w))
  if (masked.some((w, i) => w !== words[i])) {
    return { ok: false, error: `${raw} has host bits set. Did you mean ${show(masked)}/${prefix}? (or ${addr} alone for a single address)` }
  }
  return { ok: true, cidr: `${show(words)}/${prefix}` }
}

// Splits the textarea (lines, commas or spaces; "#" starts a comment).
export function parseCidrList(text: string): { cidrs: string[]; errors: string[] } {
  const cidrs: string[] = [], errors: string[] = []
  for (const line of text.split('\n')) {
    for (const item of line.replace(/#.*/, '').split(/[\s,;]+/).filter(Boolean)) {
      const r = parseCidr(item)
      if (r.ok) { if (!cidrs.includes(r.cidr)) cidrs.push(r.cidr) } else errors.push(r.error)
    }
  }
  return { cidrs, errors }
}
