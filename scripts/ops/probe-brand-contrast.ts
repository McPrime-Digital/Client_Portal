import { deriveBrandTokens, contrastRatio, readBrandKit, brandStyle } from '../../lib/brandKit'

/** Colours chosen to be hostile: the pale ones are where every white-label
 *  product produces an unreadable button, and the near-blacks are where a dark
 *  shell swallows the brand entirely. */
const CASES: [string, string][] = [
  ['pale gold',        '#F2D57E'],
  ['neon yellow',      '#F5FF00'],
  ['white-ish',        '#FAFAFA'],
  ['near-black',       '#0A0A0A'],
  ['deep navy',        '#0B1E4B'],
  ['studio gold',      '#C8A24A'],
  ['hot pink',         '#FF2D9B'],
  ['mid grey',         '#808080'],
  ['pure red',         '#FF0000'],
  ['teal',             'teal'],
  ['css oklch',        'oklch(0.7 0.15 250)'],
]

function hslToHex(t: string): string {
  const [h, s, l] = t.replace(/%/g, '').split(' ').map(Number)
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

let fails = 0
const AA = 4.5
const UI = 3

console.log('  colour            theme  fill vs page   label vs fill   verdict')
console.log('  ─────────────────────────────────────────────────────────────────')
for (const [name, input] of CASES) {
  const t = deriveBrandTokens({ colour: input })
  if (!t) { console.log(`  ${name.padEnd(16)} PARSE FAILED`); fails++; continue }
  for (const theme of ['light', 'dark'] as const) {
    const page = theme === 'light' ? '#ffffff' : '#0b1020'
    const fill = hslToHex(t[theme].primary)
    const label = hslToHex(t[theme].primaryForeground)
    const vsPage = contrastRatio(fill, page)
    const vsFill = contrastRatio(label, fill)
    const ok = vsPage >= UI - 0.01 && vsFill >= AA - 0.01
    if (!ok) fails++
    console.log(
      `  ${name.padEnd(16)} ${theme.padEnd(6)} ${vsPage.toFixed(2).padStart(5)}         ` +
      `${vsFill.toFixed(2).padStart(5)}          ${ok ? 'ok' : '✗ FAIL'}`
    )
  }
}

// Not a colour at all → null, never a half-kit.
for (const junk of ['', 'not a colour', 'javascript:alert(1)', '#12345', '</style><script>']) {
  if (deriveBrandTokens({ colour: junk }) !== null) {
    console.log(`  ✗ FAIL  "${junk}" produced a kit`); fails++
  }
}

// A half-written kit must read as NO kit.
for (const bad of [null, {}, { input: { colour: '#fff' } }, { tokens: { light: { primary: '1 2% 3%' } } }]) {
  if (readBrandKit(bad) !== null) { console.log('  ✗ FAIL  half kit accepted'); fails++ }
}

// And nothing a studio types may reach the page as a declaration.
const kit = readBrandKit({
  input: { colour: '#C8A24A' },
  tokens: deriveBrandTokens({ colour: '#C8A24A' }),
  updatedAt: new Date().toISOString(),
})!
const css = brandStyle(kit)
if (/[<>{}]/.test(css.replace(/\{[^{}]*\}/g, '')) || css.includes('<')) {
  console.log('  ✗ FAIL  css escaped its own braces'); fails++
}
console.log(`\n  css: ${css.slice(0, 110)}…`)
console.log(`\n  ${fails === 0 ? '✓ every case legible in both themes' : `✗ ${fails} failure(s)`}\n`)
process.exit(fails === 0 ? 0 : 1)
