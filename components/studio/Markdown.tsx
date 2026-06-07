'use client'

import React from 'react'

// Lightweight, dependency-free Markdown renderer that returns React nodes (no
// dangerouslySetInnerHTML → no XSS). Handles the subset AI replies actually use:
// headings, bold/italic, inline code, code fences, bullet/numbered lists,
// blockquotes, links, and paragraphs with soft line breaks.

function inline(text: string, kp: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[2] != null) out.push(<strong key={`${kp}-${i}`}>{m[2]}</strong>)
    else if (m[3] != null) out.push(<em key={`${kp}-${i}`}>{m[3]}</em>)
    else if (m[4] != null) out.push(<strong key={`${kp}-${i}`}>{m[4]}</strong>)
    else if (m[5] != null) out.push(<em key={`${kp}-${i}`}>{m[5]}</em>)
    else if (m[6] != null) out.push(<code key={`${kp}-${i}`} className="tl-md-code">{m[6]}</code>)
    else if (m[7] != null) out.push(<a key={`${kp}-${i}`} href={m[8]} target="_blank" rel="noreferrer" className="tl-md-a">{m[7]}</a>)
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function para(lines: string[], kp: string): React.ReactNode[] {
  // soft line breaks inside a paragraph
  const out: React.ReactNode[] = []
  lines.forEach((ln, k) => {
    if (k > 0) out.push(<br key={`${kp}-br-${k}`} />)
    out.push(...inline(ln, `${kp}-${k}`))
  })
  return out
}

export default function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const lines = (text || '').replace(/\r/g, '').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0
  const special = /^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+\.\s|\s*>\s?)/

  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line.trim())) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++ }
      i++
      blocks.push(<pre key={key++} className="tl-md-pre"><code>{buf.join('\n')}</code></pre>)
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const lvl = Math.min(3, h[1].length)
      const Tag = (`h${lvl + 2}`) as keyof React.JSX.IntrinsicElements
      blocks.push(<Tag key={key++} className={`tl-md-h${lvl}`}>{inline(h[2], `h${key}`)}</Tag>)
      i++
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++ }
      blocks.push(<ul key={key++} className="tl-md-ul">{items.map((it, k) => <li key={k}>{inline(it, `li${key}-${k}`)}</li>)}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
      blocks.push(<ol key={key++} className="tl-md-ol">{items.map((it, k) => <li key={k}>{inline(it, `oli${key}-${k}`)}</li>)}</ol>)
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      blocks.push(<blockquote key={key++} className="tl-md-quote">{para(buf, `bq${key}`)}</blockquote>)
      continue
    }
    if (line.trim() === '') { i++; continue }
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !special.test(lines[i])) { buf.push(lines[i]); i++ }
    blocks.push(<p key={key++} className="tl-md-p">{para(buf, `p${key}`)}</p>)
  }

  return <div className={`tl-md ${className}`}>{blocks}</div>
}
