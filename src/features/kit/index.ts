/**
 * Kit gallery feature — registers the `kit` workspace Tab (visual verification of src/kit against the Figma board).
 * Call `register()` once from the app bootstrap alongside the other features.
 */
import { registerTab } from '@/workspace/tabRegistry'
import { KitTab } from './KitTab'

export function register(): void {
  registerTab({ kind: 'kit', icon: 'palette', component: KitTab })
}

export { KitTab }
