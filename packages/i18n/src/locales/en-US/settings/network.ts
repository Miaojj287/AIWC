import type { Messages } from '../../zh-CN'

export const network: Messages['settings']['network'] = {
  section: 'Network',
  help: 'Only affects requests to model providers. Ollama, localhost and other local addresses always connect directly.',
  mode: {
    title: 'Proxy',
    system: 'System',
    manual: 'Manual',
    off: 'None',
  },
  url: {
    title: 'Proxy address',
    placeholder: 'http://127.0.0.1:7890',
    errors: {
      empty: 'Enter a proxy address',
      invalid: 'Not a valid address, e.g. http://127.0.0.1:7890',
      scheme: 'Only http, https and socks5 are supported',
      credentials: 'Put the user name and password under Proxy sign-in',
      port: 'The port must be between 1 and 65535',
    },
  },
  auth: {
    title: 'Proxy sign-in',
    description: 'Optional; the password stays in this computer’s keychain',
    username: 'User name',
    password: 'Password',
    passwordSaved: 'Saved; leave empty to keep it',
    clearPassword: 'Clear password',
    passwordCleared: 'Proxy password cleared',
  },
  bypass: {
    title: 'Bypass the proxy for',
    help: 'One per line, or separated by commas. Accepts example.com, *.example.com, .example.com, host:port, 10.0.0.0/8 and <local> (host names without a dot).',
    placeholder: '*.example.com\n10.0.0.0/8',
  },
  saved: 'Network settings saved',
  test: {
    button: 'Test proxy',
    okProxy: 'Reached through {proxy} · {ms} ms',
    okDirect: 'Reached directly · {ms} ms',
    failed: 'Connection failed',
    errors: {
      proxy_invalid: 'The proxy address is invalid',
      timeout: 'The connection timed out',
      network: "Couldn't reach the provider",
    },
  },
}
