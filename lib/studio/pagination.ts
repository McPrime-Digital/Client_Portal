import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

// Live pagination for the BlockNote editor: measures top-level block heights and
// inserts non-destructive "page break" spacer widgets so content flows onto the
// next page sheet (bottom margin on the page it leaves, top margin on the next),
// aligned to the page sheets drawn behind the editor. Pure decorations — no doc
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
        // CSS zoom / transforms scale getBoundingClientRect — normalise back to
        // layout pixels so the math matches the (unscaled) page geometry.
        const domRect = view.dom.getBoundingClientRect()
        const scale = view.dom.offsetWidth > 0 ? domRect.width / view.dom.offsetWidth : 1
        const norm = (px: number) => (scale > 0.01 ? px / scale : px)

        let y = topM
        let page = 0
        const specs: { pos: number; h: number }[] = []

        root.forEach((_node, offset) => {
          const pos = 1 + offset // doc position of this top-level block
          const raw = view.nodeDOM(pos)
          const el =
            raw instanceof HTMLElement
              ? ((raw.closest?.('.bn-block-outer') as HTMLElement) ?? raw)
              : null
          if (!el) return
          const cs = getComputedStyle(el)
          const h = norm(el.getBoundingClientRect().height) + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
          const pageBottom = page * pageH + (pageH - gap - botM)
          // break before this block if it overflows the page, isn't the first
          // block, and fits on a page by itself (oversized blocks just overflow)
          if (y + h > pageBottom + 0.5 && h <= pageContentH && y > topM + 0.5) {
            const nextTop = (page + 1) * pageH + topM
            specs.push({ pos, h: Math.round(nextTop - y) })
            y = nextTop
            page += 1
          }
          y += h
        })

        const sig = specs.map((s) => `${s.pos}:${s.h}`).join('|')
        if (sig === lastSig) return
        lastSig = sig
        const decos = specs.map((s) =>
          Decoration.widget(
            s.pos,
            () => {
              const elx = document.createElement('div')
              elx.className = 'tl-page-spacer'
              elx.style.height = `${s.h}px`
              elx.style.width = '100%'
              elx.style.display = 'block'
              elx.style.pointerEvents = 'none'
              elx.contentEditable = 'false'
              elx.setAttribute('aria-hidden', 'true')
              return elx
            },
            { side: -1, key: `pb-${s.pos}-${s.h}` },
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
