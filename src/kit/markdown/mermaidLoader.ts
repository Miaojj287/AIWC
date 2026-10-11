/**
 * Mermaid behind a lazy import (it is large: it loads only when a reply or file holds a ```mermaid block). Rendering
 * is `securityLevel: 'strict'` (labels sanitised, no click handlers or scripts), themed from the current design
 * tokens, and the SVG is swept once more before it reaches the page: no scripts, no event attributes, no links
 * that leave the document. Separate from the component so tests can stand in for it.
 */
import type { Mermaid } from 'mermaid'

let loading: Promise<Mermaid> | undefined
let sequence = 0

function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => m.default)
  return loading
}

/** A token's resolved colour (custom properties may be written in any CSS colour syntax mermaid cannot read). */
function tokenColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const probe = document.createElement('span')
  probe.style.color = `var(${name}, ${fallback})`
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).color || fallback
  probe.remove()
  return value
}

/** The theme as mermaid's `base` theme variables, from the tokens in force now. */
export function mermaidThemeVariables(): Record<string, string> {
  const fg = tokenColor('--fg', '#000000')
  const fg2 = tokenColor('--fg-2', '#333333')
  const fg3 = tokenColor('--fg-3', '#666666')
  const panel = tokenColor('--bg-panel', '#f5f5f5')
  const raised = tokenColor('--bg-raised', '#eeeeee')
  const content = tokenColor('--bg-content', '#ffffff')
  const accent = tokenColor('--accent', '#4e82ef')
  const font =
    typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--font-sans')
  return {
    background: content,
    mainBkg: panel,
    primaryColor: panel,
    primaryTextColor: fg,
    primaryBorderColor: fg3,
    secondaryColor: raised,
    secondaryTextColor: fg,
    secondaryBorderColor: fg3,
    tertiaryColor: content,
    tertiaryTextColor: fg,
    tertiaryBorderColor: fg3,
    lineColor: fg3,
    textColor: fg2,
    titleColor: fg,
    nodeTextColor: fg,
    edgeLabelBackground: content,
    clusterBkg: content,
    clusterBorder: fg3,
    noteBkgColor: raised,
    noteTextColor: fg,
    noteBorderColor: fg3,
    actorBkg: panel,
    actorBorder: fg3,
    actorTextColor: fg,
    signalColor: fg2,
    signalTextColor: fg2,
    labelBoxBkgColor: panel,
    labelTextColor: fg,
    activationBkgColor: raised,
    sequenceNumberColor: content,
    pie1: accent,
    fontFamily: font.trim() || 'system-ui, sans-serif',
    fontSize: '13px',
  }
}

/** Strips what a diagram never needs from mermaid's SVG: scripts, `on*` handlers, links out of the document. */
export function sanitizeSvg(svg: string): string {
  if (typeof DOMParser === 'undefined') return svg
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new Error('invalid svg')
  doc.querySelectorAll('script').forEach((node) => node.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const external = (name === 'href' || name === 'xlink:href') && !attr.value.trim().startsWith('#')
      if (name.startsWith('on') || external) el.removeAttribute(attr.name)
    }
  })
  return new XMLSerializer().serializeToString(doc.documentElement)
}

/** The diagram as SVG text; throws when the source is not a diagram mermaid can draw. */
export async function renderMermaid(code: string): Promise<string> {
  const mermaid = await loadMermaid()
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: mermaidThemeVariables(),
  })
  const id = `kit-mermaid-${++sequence}`
  try {
    await mermaid.parse(code)
    const { svg } = await mermaid.render(id, code)
    return sanitizeSvg(svg)
  } finally {
    // a failed render leaves its scratch element in the body
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
  }
}
