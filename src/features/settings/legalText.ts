/**
 * 用户服务协议 / 隐私政策 shown in the 版本与支持 dialogs. Product copy, not demo data: the text lives in
 * the `legal` catalog namespace (CLAUDE.md §11); these tables hold its keys, resolved with t() at render.
 */
import type { MessageKey } from '@/i18n'

export interface LegalDoc {
  title: MessageKey
  updated: string
  sections: Array<{ heading: MessageKey; body: MessageKey }>
}

export const TERMS: LegalDoc = {
  title: 'legal.terms.title',
  updated: '2026-04-01',
  sections: [
    { heading: 'legal.terms.service.heading', body: 'legal.terms.service.body' },
    { heading: 'legal.terms.data.heading', body: 'legal.terms.data.body' },
    { heading: 'legal.terms.scope.heading', body: 'legal.terms.scope.body' },
    { heading: 'legal.terms.outbound.heading', body: 'legal.terms.outbound.body' },
    { heading: 'legal.terms.disclaimer.heading', body: 'legal.terms.disclaimer.body' },
  ],
}

export const PRIVACY: LegalDoc = {
  title: 'legal.privacy.title',
  updated: '2026-04-01',
  sections: [
    { heading: 'legal.privacy.localFirst.heading', body: 'legal.privacy.localFirst.body' },
    { heading: 'legal.privacy.providers.heading', body: 'legal.privacy.providers.body' },
    { heading: 'legal.privacy.logs.heading', body: 'legal.privacy.logs.body' },
    { heading: 'legal.privacy.control.heading', body: 'legal.privacy.control.body' },
  ],
}
