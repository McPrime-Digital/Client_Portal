// Real page pagination for the BlockNote (ProseMirror) editor.
//
// An editor is a single continuous text column; to make it *look* paginated
// (white sheets with gaps, text that jumps to the next page) we push any block
// that would straddle a page's bottom margin down to the top of the next page.
//
// Hard-won lesson: you cannot do this by writing styles into the editor DOM.
// ProseMirror owns its contenteditable and runs a MutationObserver over it — any
// external style/attribute write (even a CSS variable on the block wrapper) is
// treated as a foreign mutation and the node is redrawn, wiping the write and
// triggering an infinite re-pagination loop. The ONLY robust mechanism is a
// ProseMirror *node decoration*: PM applies it as part of its own render, so it
// never fights it. The decoration sets a `--tl-break` custom property on the
// block's outer DOM; a static stylesheet rule turns that into a top margin on the
// inner `.bn-block` (margin on the outer is ignored by BlockNote's layout).

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type PageGeom = {
  /** top-to-top distance between consecutive sheets (sheet height + gap) */
  pitch: number
  /** visible white sheet height */
  sheet: number
  /** top page margin (content inset from the top of each sheet) */
  marginTop: number
  /** bottom page margin (content must stop this far above the sheet bottom) */
  marginBottom: number
}

/**
 * Pure break solver. Given each top-level block's natural top and height
 * (in surface coordinates, first block at geom.marginTop), return the top-margin
 * to apply to each block so none straddles a page boundary. 0 means "leave it".
 */
export function computeBreaks(tops: number[], heights: number[], g: PageGeom): number[] {
  const breaks = new Array(tops.length).fill(0)
  const usable = g.sheet - g.marginTop - g.marginBottom
  if (usable <= 0 || g.pitch <= 0) return breaks
  let pushed = 0
  for (let i = 0; i < tops.length; i++) {
    const top = tops[i] + pushed
    const bottom = top + heights[i]
    const page = Math.max(0, Math.floor((top - g.marginTop) / g.pitch + 1e-4))
    const pageTop = page * g.pitch + g.marginTop
    const limit = pageTop + usable // content must not cross this on its page
    const atPageTop = top - pageTop < 2 // already flush to a page top
    // Push when the block crosses its page's usable bottom — unless it already
    // starts at a page top (a block taller than one page can't be helped; pushing
    // again would only insert a blank page).
    if (bottom > limit + 1 && !atPageTop) {
      const delta = Math.round((page + 1) * g.pitch + g.marginTop - top)
      if (delta > 0) {
        breaks[i] = delta
        pushed += delta
      }
    }
  }
  return breaks
}

export const paginationKey = new PluginKey('tl-pagination')
const BREAK_VAR = '--tl-break'

export type PaginationController = {
  /** false → no breaks (pageless mode) */
  enabled: () => boolean
  /** page geometry (layout px) */
  geom: () => PageGeom
  /** surface CSS zoom (1 = none) */
  zoom: () => number
}

const topOuters = (dom: HTMLElement): HTMLElement[] => {
  const group = dom.querySelector('.bn-block-group')
  return group
    ? Array.from(group.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('bn-block-outer'),
      )
    : []
}

/**
 * ProseMirror plugin that paginates the document with node decorations. Register
 * it on the BlockNote tiptap editor: `editor._tiptapEditor.registerPlugin(plugin)`.
 */
export function createPaginationPlugin(ctrl: PaginationController) {
  return new Plugin({
    key: paginationKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(paginationKey)
        if (meta !== undefined) return meta as DecorationSet
        // keep decorations aligned to the doc as it changes
        return (old as DecorationSet).map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state) as DecorationSet
      },
    },
    view(view) {
      let raf = 0
      let lastKey = ''

      const measure = () => {
        raf = 0
        const dom = view.dom as HTMLElement
        const outers = topOuters(dom)

        if (!ctrl.enabled() || outers.length === 0) {
          if (lastKey !== '') {
            lastKey = ''
            view.dispatch(view.state.tr.setMeta(paginationKey, DecorationSet.empty))
          }
          return
        }

        const g = ctrl.geom()
        const z = ctrl.zoom() || 1
        // Current break already applied to each block (read from the DOM the
        // decorations produced) so we can recover the natural, un-paginated flow.
        const cur = outers.map((o) => parseFloat(o.style.getPropertyValue(BREAK_VAR)) || 0)
        // Anchor to the FIRST block rather than the editor element: pin the first
        // block to the page's top margin and measure every other block relative to
        // it. This is independent of any editor/container top padding, so the very
        // first page break lands correctly (not just the ones below it).
        const r0 = outers[0].getBoundingClientRect().top
        let cum = 0
        const tops = outers.map((o, i) => {
          cum += cur[i]
          return (o.getBoundingClientRect().top - r0) / z - (cum - cur[0]) + g.marginTop
        })
        const heights = outers.map((o) => o.getBoundingClientRect().height / z)

        const breaks = computeBreaks(tops, heights, g)
        const key = breaks.join(',')
        if (key === lastKey) return // converged — avoid a dispatch loop
        lastKey = key

        // Map each top-level block (DOM order === doc order) to its PM position.
        const decos: Decoration[] = []
        const doc = view.state.doc
        const blockGroup = doc.firstChild
        if (blockGroup) {
          let i = 0
          blockGroup.forEach((child, childOffset) => {
            const px = breaks[i] || 0
            if (px > 0) {
              const from = 1 + childOffset // 1 = enter the root blockGroup
              decos.push(Decoration.node(from, from + child.nodeSize, { style: `${BREAK_VAR}:${px}px` }))
            }
            i++
          })
        }
        view.dispatch(view.state.tr.setMeta(paginationKey, DecorationSet.create(doc, decos)))
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
          if (raf) cancelAnimationFrame(raf)
          ro.disconnect()
        },
      }
    },
  })
}
