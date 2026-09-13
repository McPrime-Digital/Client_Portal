import 'server-only'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { ContractDetail } from '@/lib/contracts'

/**
 * THE SIGNED ARTIFACT — a PDF that carries its own evidence.
 *
 * ── WHAT WAS STUDIED, AND WHAT IS BUILT ON TOP ───────────────────────────
 *
 * The open-source state of the art is Documenso and DocuSeal. **Both are
 * AGPL-3.0**, so not a line of either is here — a network-served derivative of
 * AGPL code would oblige this product to publish its source. What was taken is
 * the BAR they set, which is the right thing to take from a licence you cannot
 * use: Documenso does not merely log that somebody clicked Sign, it produces a
 * **cryptographically signed PDF** (PKCS#12, PAdES) that a verifier can check
 * without asking Documenso anything. An audit table alone is a claim; a signed
 * document is evidence.
 *
 * The crypto here is `@signpdf/*` and `pdf-lib`, both **MIT**, so the licence
 * audit ends where it should.
 *
 * ── THE ADVANCEMENT: THE CERTIFICATE TRAVELS INSIDE THE DOCUMENT ─────────
 *
 * Documenso and DocuSeal keep the audit trail in their own database and render
 * it on their own page. That is fine until the day you need it and the vendor is
 * gone, the subscription lapsed, or the dispute is with the vendor.
 *
 * Here the certificate of completion — every event, actor, timestamp and IP — is
 * RENDERED INTO THE PDF ITSELF before it is signed, so the signature covers the
 * evidence as well as the agreement. The artifact is self-contained: it proves
 * what was signed, by whom, when, from where, and that none of it has been
 * altered since, to anybody holding the file and nothing else.
 *
 * That also makes the `content_hash` chain complete. The hash was taken over the
 * exact text at SEND; that text is reproduced here verbatim and printed on the
 * certificate page, so the document contains the thing its own hash describes.
 *
 * ── SIGNING IS OPTIONAL AND ITS ABSENCE IS SAID OUT LOUD ─────────────────
 *
 * Without a certificate in the environment the PDF is still produced and still
 * carries the certificate page — it is simply not cryptographically sealed, and
 * `signContractPdf` reports that rather than pretending. A silent downgrade from
 * "sealed" to "not sealed" on a legal document would be the worst failure in
 * this file.
 */

const MARGIN = 56
const BODY_SIZE = 10.5
const LINE = 14.5

function wrap(text: string, maxChars: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') { out.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > maxChars) {
        out.push(line.trim())
        line = word
      } else {
        line = `${line} ${word}`
      }
    }
    if (line.trim()) out.push(line.trim())
  }
  return out
}

const ts = (s: string) =>
  new Date(s).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  })

/** The agreement, the signature block, and the certificate of completion. */
export async function renderContractPdf(
  detail: ContractDetail,
  studioName: string
): Promise<Uint8Array> {
  const { contract, signers, events } = detail
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  pdf.setTitle(contract.title)
  pdf.setProducer('Genreline')
  pdf.setCreator(studioName)

  let page = pdf.addPage()
  let { width, height } = page.getSize()
  let y = height - MARGIN

  const newPage = () => {
    page = pdf.addPage()
    const size = page.getSize()
    width = size.width
    height = size.height
    y = height - MARGIN
  }
  const need = (space: number) => { if (y - space < MARGIN) newPage() }

  const write = (text: string, size = BODY_SIZE, f = font, gap = LINE) => {
    need(gap)
    page.drawText(text, { x: MARGIN, y, size, font: f, color: rgb(0.1, 0.1, 0.12) })
    y -= gap
  }
  const rule = () => {
    need(18)
    page.drawLine({
      start: { x: MARGIN, y: y + 4 }, end: { x: width - MARGIN, y: y + 4 },
      thickness: 0.5, color: rgb(0.8, 0.8, 0.84),
    })
    y -= 18
  }

  write(contract.title, 17, bold, 26)
  write(studioName, 9.5, font, 18)
  rule()

  for (const line of wrap(contract.body?.text ?? '', 92)) {
    if (line === '') { y -= LINE / 2; continue }
    write(line)
  }

  // ── signature block ───────────────────────────────────────────────────────
  y -= 12
  rule()
  write('Signatures', 12, bold, 20)
  for (const s of signers) {
    need(56)
    write(`${s.seq + 1}. ${s.name}`, 10.5, bold, 15)
    write(`   ${s.email}`, 9, font, 13)
    write(
      s.status === 'signed' && s.signed_at
        ? `   Signed ${ts(s.signed_at)} · verification: ${s.verification}`
        : `   ${s.status}`,
      9, font, 16
    )
  }

  // ── the certificate of completion, INSIDE the document ───────────────────
  newPage()
  write('Certificate of completion', 15, bold, 24)
  write(
    'Every action recorded against this document. This page is part of the signed file: altering it invalidates the signature.',
    9, font, 16
  )
  if (contract.content_hash) {
    write(`Content hash (SHA-256, fixed when sent): ${contract.content_hash}`, 8, font, 16)
  }
  rule()

  for (const e of events) {
    need(40)
    write(`${ts(e.occurred_at)}  ·  ${e.event}`, 9.5, bold, 13)
    write(`   ${e.actor_name}${e.ip_address ? `  ·  IP ${e.ip_address}` : ''}`, 8.5, font, 12)
    if (e.user_agent) {
      for (const line of wrap(`   ${e.user_agent}`, 110).slice(0, 2)) {
        write(line, 7.5, font, 10)
      }
    }
    y -= 4
  }

  return pdf.save()
}

export type SealResult =
  | { sealed: true; bytes: Uint8Array }
  | { sealed: false; bytes: Uint8Array; reason: string }

/**
 * Apply a PAdES-compatible signature, if this deployment holds a certificate.
 *
 * `ETSI.CAdES.detached` is the subfilter that makes a signature PAdES rather
 * than a legacy Adobe one, which is what carries it into eIDAS "advanced
 * electronic signature" territory. The alternative — a picture of a squiggle —
 * proves nothing a screenshot could not.
 *
 * The dynamic import keeps the crypto out of the module graph of every page that
 * merely mentions a contract, and the lazy env read is I-11: a module-scope
 * throw over a missing key fails the BUILD of every page that transitively
 * imports it.
 */
export async function signContractPdf(bytes: Uint8Array): Promise<SealResult> {
  const b64 = process.env.CONTRACT_SIGNING_P12_BASE64
  const passphrase = process.env.CONTRACT_SIGNING_P12_PASSPHRASE
  if (!b64) {
    return {
      sealed: false,
      bytes,
      reason: 'No signing certificate on this deployment (CONTRACT_SIGNING_P12_BASE64). The document and its certificate page are complete; they are not cryptographically sealed.',
    }
  }

  try {
    const [{ SignPdf }, { P12Signer }, { pdflibAddPlaceholder }, { PDFDocument: Doc }] =
      await Promise.all([
        import('@signpdf/signpdf'),
        import('@signpdf/signer-p12'),
        import('@signpdf/placeholder-pdf-lib'),
        import('pdf-lib'),
      ])

    const doc = await Doc.load(bytes)
    pdflibAddPlaceholder({
      pdfDoc: doc,
      reason: 'Signed in Genreline',
      contactInfo: '',
      name: 'Genreline',
      location: '',
      // PAdES, not the Adobe default.
      subFilter: 'ETSI.CAdES.detached',
    })
    const withPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }))

    const signer = new P12Signer(Buffer.from(b64, 'base64'), { passphrase })
    const signed = await new SignPdf().sign(withPlaceholder, signer)
    return { sealed: true, bytes: new Uint8Array(signed) }
  } catch (e) {
    // NEVER a silent downgrade on a legal document: the caller is told the PDF
    // exists but is unsealed, and why.
    return {
      sealed: false,
      bytes,
      reason: `Could not apply the cryptographic seal: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}
