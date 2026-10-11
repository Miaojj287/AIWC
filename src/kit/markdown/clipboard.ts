/** Copies through the async Clipboard API; rejects when there is none, so a caller never reports a copy that did not happen. */
export async function writeClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard) throw new Error('Clipboard API unavailable')
  await clipboard.writeText(text)
}
