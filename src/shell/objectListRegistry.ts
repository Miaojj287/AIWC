/**
 * The ObjectList column (280px) shows a different list per rail function (DESIGN-SPEC §0.2).
 * The shell renders the frame (header, search, filter chips); each function registers its list body.
 */
import type { ComponentType } from 'react'
import type { RailFunction } from '@/workspace/tabsStore'

export interface ObjectListProps {
  /** search text from the shared header search box */
  query: string
  /** id of the object whose tab is currently active (for selection sync) */
  activeObjectId: string | null
}

export interface ObjectListRegistration {
  fn: RailFunction
  /** header title, e.g. 会话 / 自动回复 / AI 克隆 */
  title: string
  component: ComponentType<ObjectListProps>
  /** optional segmented filter (e.g. 全部 / 已开启 / 已暂停) rendered by the shell */
  segments?: Array<{ id: string; label: string }>
}

const registry = new Map<RailFunction, ObjectListRegistration>()

export function registerObjectList(reg: ObjectListRegistration): void {
  registry.set(reg.fn, reg)
}

export function getObjectList(fn: RailFunction): ObjectListRegistration | undefined {
  return registry.get(fn)
}
