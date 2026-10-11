import type { Messages } from '../../zh-CN'

export const setup: Messages['settings']['setup'] = {
  title: 'Connect a model',
  description: 'The Agent, auto reply and clones run on a model. Pick a provider, or use Ollama on this computer.',
  vendorsLabel: 'Model providers',
  connected: 'Connected {label} · {n, plural, one {# model} other {# models}}',
  connectedHint: 'Connect another provider, or finish.',
  testing: 'Testing the connection…',
  testOk: 'Connection OK · {ms} ms',
  testFailed: 'Connection failed: {message}',
  retest: 'Test again',
  finish: 'Finish',
  skip: 'Skip for now',
  skipNote:
    'You can browse chat history without a model; the Agent, auto reply and clones wait until one is connected in Settings › AI.',
  back: 'Back',
  local: 'Local',
  connectedBadge: 'Connected',
}
