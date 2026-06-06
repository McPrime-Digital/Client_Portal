import { BlockNoteSchema, defaultStyleSpecs } from '@blocknote/core'
import { createReactStyleSpec } from '@blocknote/react'

// Custom inline styles so the editor has Google-Docs-style font family + size,
// applied per text run via editor.addStyles({ fontFamily }) / ({ fontSize }).
const FontSize = createReactStyleSpec(
  { type: 'fontSize', propSchema: 'string' },
  { render: (props) => <span ref={props.contentRef} style={{ fontSize: props.value }} /> },
)
const FontFamily = createReactStyleSpec(
  { type: 'fontFamily', propSchema: 'string' },
  { render: (props) => <span ref={props.contentRef} style={{ fontFamily: props.value }} /> },
)
// Text color (any CSS color)
const Color = createReactStyleSpec(
  { type: 'color', propSchema: 'string' },
  { render: (props) => <span ref={props.contentRef} style={{ color: props.value }} /> },
)
// Highlight / background (any CSS color)
const Highlight = createReactStyleSpec(
  { type: 'highlight', propSchema: 'string' },
  {
    render: (props) => (
      <span
        ref={props.contentRef}
        style={{ backgroundColor: props.value, borderRadius: '2px', padding: '0 1px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}
      />
    ),
  },
)
// Gradient text (value is a CSS gradient)
const Gradient = createReactStyleSpec(
  { type: 'gradient', propSchema: 'string' },
  {
    render: (props) => (
      <span
        ref={props.contentRef}
        style={{ backgroundImage: props.value, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
      />
    ),
  },
)
const Sub = createReactStyleSpec(
  { type: 'sub', propSchema: 'boolean' },
  { render: (props) => <sub ref={props.contentRef} /> },
)
const Sup = createReactStyleSpec(
  { type: 'sup', propSchema: 'boolean' },
  { render: (props) => <sup ref={props.contentRef} /> },
)

export const docSchema = BlockNoteSchema.create({
  styleSpecs: {
    ...defaultStyleSpecs,
    fontSize: FontSize,
    fontFamily: FontFamily,
    color: Color,
    highlight: Highlight,
    gradient: Gradient,
    sub: Sub,
    sup: Sup,
  },
})

export type DocSchemaEditor = typeof docSchema.BlockNoteEditor

// Font lists live in ./fonts (no BlockNote import) so the server layout can load
// the stylesheet without pulling client-only code. Re-export for convenience.
export { FONT_FAMILIES, FONT_SIZES, GOOGLE_FONTS_HREF } from './fonts'
