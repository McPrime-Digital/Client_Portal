import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

// Live pagination for the BlockNote editor: measures top-level block heights and
// inserts non-destructive "page break" spacer widgets so content flows onto the
// next page (with a bottom margin on the page it left and a top margin on the next),
// aligning with the page sheets drawn behind the editor. Pure decorations — no doc
// mutation, so it never touches undo, collaboration, or the saved Yjs state.

export const paginationKey = new PluginKey('tl-pagination')

export type PageGeom = { pageH: number; topM: number; botM: number; gap: number }

export function paginationPlugin(getEnabled: () => boolean, geom: PageGeom) {
  return new Plugin({
    key: paginationKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(paginationKey)
        if (meta) return meta as DecorationSet
        return old.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)
      },
    },
    view(view: EditorView) {
      let raf = 0
      let lastSig = ''

      const measure = () => {
        raf = 0
        const root = view.state.doc.firstChild // the root blockGroup
        if (!getEnabled() || !root) {
          if (lastSig !== '') {
            lastSig = ''
            view.dispatch(view.state.tr.setMeta(paginationKey, DecorationSet.empty))
          }
          return
        }
        const { pageH, topM, botM, gap } = geom
        const pageContentH = pageH - topM - botM
        let y = topM
        let page = 0
        const specs: { pos: number; h: number }[] = []

        root.forEach((_node, offset) => {
          const pos = 1 + offset // doc position of this top-level block
          const dom = view.nodeDOM(pos)
          if (!(dom instanceof HTMLElement)) return
          const rect = dom.getBoundingClientRect()
          const cs = getComputedStyle(dom)
          const h = rect.height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
          const pageBottom = page * pageH + (pageH - gap - botM)
          // break before this block if it would overflow the current page (and it
          // isn't the very first block, and it fits on a page on its own)
          if (y + h > pageBottom && h <= pageContentH && y > topM + 1) {
            const nextTop = (page + 1) * pageH + topM
            specs.push({ pos, h: nextTop - y })
            y = nextTop
            page += 1
          }
          y += h
        })

        const sig = specs.map((s) => `${s.pos}:${Math.round(s.h)}`).join('|')
        if (sig === lastSig) return
        lastSig = sig
        const decos = specs.map((s) =>
          Decoration.widget(
            s.pos,
            () => {
              const el = document.createElement('div')
              el.className = 'tl-page-spacer'
              el.style.height = `${s.h}px`
              el.style.width = '100%'
              el.style.pointerEvents = 'none'
              el.setAttribute('aria-hidden', 'true')
              return el
            },
            { side: -1, key: `pb-${s.pos}-${Math.round(s.h)}` },
          ),
        )
        view.dispatch(view.state.tr.setMeta(paginationKey, DecorationSet.create(view.state.doc, decos)))
      }

      const schedule = () => {
        if (!raf) raf = requestAnimationFrame(measure)
      }
      const ro = new ResizeObserver(schedule)
      ro.observe(view.dom)
      schedule()

      return {
        update: schedule,
        destroy() {
          ro.disconnect()
          if (raf) cancelAnimationFrame(raf)
        },
      }
    },
  })
}
