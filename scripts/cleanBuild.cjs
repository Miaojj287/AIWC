const { rmSync } = require('node:fs')
const { resolve } = require('node:path')
for (const name of ['dist', 'dist-electron', 'dist-web']) rmSync(resolve(__dirname, '..', name), { recursive: true, force: true })
