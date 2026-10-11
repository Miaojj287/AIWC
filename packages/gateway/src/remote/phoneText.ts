/**
 * Text shaping between the Agent and the owner's phone: inbound text is neutralised before it becomes a user
 * message (it cannot forge or close a prompt tag), outbound answers lose what a WeChat bubble cannot show.
 */

/** Longest phone message taken as one Agent input. */
export const MAX_REMOTE_INPUT_CHARS = 4000
/** Longest Agent answer sent back; the rest stays on the computer. */
export const MAX_PHONE_REPLY_CHARS = 3000

/** `<` / `>` become full-width look-alikes: the owner's text reads the same but cannot open or close a prompt tag. */
export const neutraliseTags = (text: string): string => text.replace(/</g, '＜').replace(/>/g, '＞')

export function remoteInputText(text: string): string {
  return Array.from(neutraliseTags(text.trim())).slice(0, MAX_REMOTE_INPUT_CHARS).join('')
}

/**
 * Markdown answer → plain WeChat text. Citation chips (`[05-12 10:30](wx://…)`) keep their label, other links
 * become `label (url)`, emphasis / heading / code markers go, and runs of blank lines collapse.
 */
export function toPhoneText(markdown: string): { text: string; truncated: boolean } {
  let text = markdown
    .replace(/\[([^\]\n]*)\]\(wx:\/\/[^)\s]*\)/g, '$1')
    .replace(/!\[([^\]\n]*)\]\([^)\s]*\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`{3}[^\n]*\n?/g, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const chars = Array.from(text)
  const truncated = chars.length > MAX_PHONE_REPLY_CHARS
  if (truncated) text = chars.slice(0, MAX_PHONE_REPLY_CHARS).join('').trimEnd()
  return { text, truncated }
}
