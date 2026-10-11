/**
 * WeChat conventions every layer must agree on: which chat ids are group chats, and how one outbound text is cut
 * into bubbles. The gateway sends by these rules and the Agent's send preview renders by them, so what the user
 * approves is exactly what goes out.
 */

/** Group chat ids: `xxx@chatroom`, and `xxx@im.chatroom` for WeCom groups (case-insensitive, outer spaces ignored). */
export function isGroupChatId(id: string): boolean {
  return typeof id === 'string' && /@(im\.)?chatroom$/i.test(id.trim())
}

/**
 * The bubble separator wherever it appears, not only alone on its own line.
 *
 * Models are told to put it on its own line and mostly do — but "mostly" is not good enough here: an inline
 * `…想吃什么？ ---wx-next--- 先垫垫…` used to survive the split and get pasted into WeChat verbatim, so the contact
 * received our internal marker. Matching it anywhere makes a stray marker impossible to leak, and the surrounding
 * whitespace is eaten so both halves stay clean.
 *
 * Leading dashes are allowed to vary (`--` … `-----`) because that is the one detail models get wrong while still
 * clearly meaning the separator.
 */
const BUBBLE_SEPARATOR = /[ \t]*-{2,}wx-next-{2,}[ \t]*/gi

/** Split outbound text on the `---wx-next---` marker into separate bubbles (trimmed, empties dropped). */
export function splitOutboundBubbles(text: string): string[] {
  return text
    .split(BUBBLE_SEPARATOR)
    .map((bubble) => bubble.trim())
    .filter(Boolean)
}
