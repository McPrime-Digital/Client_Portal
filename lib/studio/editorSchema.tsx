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

// Family value is the CSS font-family stack; '' = document default.
export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Calibri', value: 'Calibri, "Segoe UI", sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Roboto', value: 'Roboto, system-ui, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
]

export const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '24', '30', '36', '48', '60', '72', '96']
