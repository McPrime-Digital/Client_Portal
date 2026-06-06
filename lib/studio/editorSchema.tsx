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

export const docSchema = BlockNoteSchema.create({
  styleSpecs: { ...defaultStyleSpecs, fontSize: FontSize, fontFamily: FontFamily },
})

export type DocSchemaEditor = typeof docSchema.BlockNoteEditor

// Font lists live in ./fonts (no BlockNote import) so the server layout can load
// the stylesheet without pulling client-only code. Re-export for convenience.
export { FONT_FAMILIES, FONT_SIZES, GOOGLE_FONTS_HREF } from './fonts'
