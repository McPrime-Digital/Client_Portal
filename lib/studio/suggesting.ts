import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { ySyncPluginKey } from 'y-prosemirror'

// Suggesting / track-changes mode (Google-Docs style). When enabled:
//  • newly typed/pasted text is marked as an insertion (green),
//  • Backspace/Delete marks the target as a deletion (red strike) instead of
//    removing it (unless it's your own fresh insertion, which is really removed).
// Remote/collab + initial-load transactions (y-sync) are skipped so existing and
// peers' content is never mis-marked as your insertion.

export const suggestKey = new PluginKey('tl-suggesting')

export function suggestingPlugin(getEnabled: () => boolean) {
  return new Plugin({
    key: suggestKey,
    appendTransaction(trs, _old, newState) {
      if (!getEnabled()) return null
      const ins = newState.schema.marks.insertion
      const del = newState.schema.marks.deletion
      if (!ins) return null
      let tr: ReturnType<typeof newState.tr.addMark> | null = null
      // Mark every newly-inserted text range as an insertion. We compute the
      // inserted range in FINAL document coordinates by mapping each step's
      // output range through the remaining steps + later transactions.
      trs.forEach((t, ti) => {
        // skip our own marking txns and y-sync (remote edits + the initial load),
        // which would otherwise mark the whole existing document as inserted.
        if (!t.docChanged || t.getMeta(suggestKey) || t.getMeta(ySyncPluginKey)) return
        t.steps.forEach((step, si) => {
          step.getMap().forEach((_os: number, _oe: number, ns: number, ne: number) => {
            if (ne <= ns) return
            let from = ns
            let to = ne
            for (let j = si + 1; j < t.steps.length; j++) { const m = t.steps[j].getMap(); from = m.map(from, -1); to = m.map(to, 1) }
            for (let k = ti + 1; k < trs.length; k++) { from = trs[k].mapping.map(from, -1); to = trs[k].mapping.map(to, 1) }
            if (from >= to || to > newState.doc.content.size) return
            if (!tr) tr = newState.tr
            // don't re-mark text that's already a deletion (e.g. a re-typed char)
            tr.addMark(from, to, ins.create())
            if (del) tr.removeMark(from, to, del)
          })
        })
      })
      if (tr) { (tr as any).setMeta(suggestKey, true); return tr }
      return null
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
