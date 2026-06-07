import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

// Suggesting / track-changes mode (Google-Docs style). When enabled:
//  • typed text is auto-marked as an insertion (kept in stored marks),
//  • Backspace/Delete marks the target as a deletion instead of removing it
//    (unless it's your own insertion, which is genuinely removed).
// It only intercepts the delete keys + stored marks — never rewrites arbitrary
// transactions — so it can't corrupt the doc or break collaboration.

export const suggestKey = new PluginKey('tl-suggesting')

export function suggestingPlugin(getEnabled: () => boolean) {
  return new Plugin({
    key: suggestKey,
    appendTransaction(trs, _old, newState) {
      if (!getEnabled()) return null
      const ins = newState.schema.marks.insertion
      if (!ins) return null
      if (trs.every((t) => !t.docChanged && !t.selectionSet)) return null
      const marks = newState.storedMarks || newState.selection.$head.marks()
      if (marks.some((m) => m.type === ins)) return null
      return newState.tr.setStoredMarks([...marks, ins.create()]).setMeta(suggestKey, true)
    },
    props: {
      handleKeyDown(view, event) {
        if (!getEnabled()) return false
        if (event.key !== 'Backspace' && event.key !== 'Delete') return false
        const dmark = view.state.schema.marks.deletion
        const imark = view.state.schema.marks.insertion
        if (!dmark) return false
        const sel = view.state.selection
        let from: number
        let to: number
        if (!sel.empty) { from = sel.from; to = sel.to }
        else if (event.key === 'Backspace') { from = sel.from - 1; to = sel.from }
        else { from = sel.from; to = sel.from + 1 }
        if (from < 0 || to > view.state.doc.content.size || from >= to) return false

        // deleting your own freshly-inserted suggestion → really remove it
        let isInsertion = false
        view.state.doc.nodesBetween(from, to, (n) => {
          if (n.isText && imark && n.marks.some((m) => m.type === imark)) isInsertion = true
        })
        const tr = view.state.tr.setMeta(suggestKey, true)
        if (isInsertion) {
          tr.delete(from, to)
          view.dispatch(tr)
          return true
        }
        tr.addMark(from, to, dmark.create())
        const caret = event.key === 'Backspace' ? from : to
        tr.setSelection(TextSelection.create(tr.doc, caret))
        view.dispatch(tr)
        return true
      },
    },
  })
}
