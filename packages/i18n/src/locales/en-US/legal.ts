import type { Messages } from '../zh-CN'

export const legal: Messages['legal'] = {
  terms: {
    title: 'AIWC Terms of Service',
    service: {
      heading: '1. The service',
      body: 'AIWC is a WeChat data management tool that runs on your own computer. All parsing, indexing and transcription happen locally; content is sent to an online model provider only if you configure one.',
    },
    data: {
      heading: '2. Data and privacy',
      body: 'We do not collect or upload your chat data. When you use a third-party model, requests go directly from your device to that provider and are subject to its privacy policy.',
    },
    scope: {
      heading: '3. Permitted use',
      body: 'You may use this software only with data from WeChat accounts you lawfully own. Do not use it to monitor others, for bulk marketing, or for any purpose that violates laws or regulations.',
    },
    outbound: {
      heading: '4. Auto reply and sending',
      body: 'Outbound actions such as auto replies and pushes are configured and confirmed by you, and you are responsible for the consequences of those messages. The software provides approvals and a circuit breaker, but does not guarantee the availability of third-party platforms.',
    },
    disclaimer: {
      heading: '5. Disclaimer',
      body: 'The developers are not liable for data loss or other damage caused by using this software. We recommend regularly backing up your WeChat data and this software’s configuration folder.',
    },
  },
  privacy: {
    title: 'AIWC Privacy Policy',
    localFirst: {
      heading: 'Local first',
      body: 'WeChat databases, decryption keys, image keys, memory files and clone profiles are all stored in the app data folder on this computer, and keys are encrypted by the system keychain.',
    },
    providers: {
      heading: 'What is sent to model providers',
      body: 'Only when you configure an online model (Agent model, online transcription, clone) are the referenced chat excerpts, voice files or extraction requests sent to the provider you chose. With a local model such as Ollama, data never leaves this computer.',
    },
    logs: {
      heading: 'Logs',
      body: 'Logs record only runtime status and errors, never chat content; logs are exported only when you do it yourself.',
    },
    control: {
      heading: 'Your control',
      body: 'You can delete clone profiles, clear memory files, and remove model providers and keys in Settings at any time. Uninstalling the software removes all local data.',
    },
  },
}
