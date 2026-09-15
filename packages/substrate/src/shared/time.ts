/** Clock shared by the mirror and the sync engine. All public timestamps are millisecond epochs. */
export const nowMs = (): number => Date.now()
