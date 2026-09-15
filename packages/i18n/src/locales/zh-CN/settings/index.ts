/**
 * settings — the 设置 Tab (src/features/settings). One file per page so pages can be edited in
 * parallel; `legal` (协议 / 隐私) is its own top-level namespace.
 */
import { nav } from './nav'
import { general } from './general'
import { account } from './account'
import { ai } from './ai'
import { memory } from './memory'
import { pets } from './pets'
import { about } from './about'

export const settings = { nav, general, account, ai, memory, pets, about }
