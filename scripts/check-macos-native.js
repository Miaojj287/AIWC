const fs = require('fs')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const macosDir = path.join(rootDir, 'resources', 'macos')
const imageNativeBaseDir = path.join(rootDir, 'resources', 'wedecrypt')

const requiredArtifacts = [
  { name: 'wechat_memory_scan_helper', type: 'file', status: 'open-built' },
  { name: 'libWCDBOpen.dylib', type: 'file', status: 'open-built' },
  { name: 'entitlements.mac.plist', type: 'file', status: 'static' },
  { name: 'image_scan_entitlements.plist', type: 'file', status: 'static' }
]

const forbiddenClosedArtifacts = [
  'libwx_key.dylib',
  'xkey_helper',
  'image_scan_helper',
  'libdobby.dylib',
  'libWCDB.dylib',
  'libwcdb_api.dylib'
]

function statSafe(targetPath) {
  try {
    return fs.statSync(targetPath)
  } catch {
    return null
  }
}

function main() {
  console.log(`[macos-native-check] target dir: ${macosDir}`)

  if (!fs.existsSync(macosDir)) {
    console.error('[macos-native-check] resources/macos does not exist')
    process.exit(1)
  }

  const missing = []
  const present = []

  for (const artifact of requiredArtifacts) {
    const targetPath = path.join(macosDir, artifact.name)
    const stat = statSafe(targetPath)

    if (!stat || (artifact.type === 'file' && !stat.isFile())) {
      missing.push(artifact)
      continue
    }

    present.push({
      name: artifact.name,
      size: stat.size,
      status: artifact.status
    })
  }

  if (present.length > 0) {
    console.log('[macos-native-check] present:')
    for (const item of present) {
      console.log(`  - ${item.name} (${item.size} bytes) [${item.status}]`)
    }
  }

  if (missing.length > 0) {
    console.error('[macos-native-check] missing:')
    for (const item of missing) {
      console.error(`  - ${item.name} [${item.status}]`)
    }
    process.exit(2)
  }

  const forbiddenPresent = forbiddenClosedArtifacts.filter(name =>
    statSafe(path.join(macosDir, name))?.isFile()
  )
  if (forbiddenPresent.length) {
    console.error('[macos-native-check] forbidden closed artifacts present:')
    for (const name of forbiddenPresent) console.error(`  - ${name}`)
    process.exit(3)
  }
  console.log('[macos-native-check] no closed compatibility artifacts present')

  const imageNativeArch = process.env.AIWC_IMAGE_NATIVE_ARCH || process.arch
  const imageNativeAddon = path.join(
    imageNativeBaseDir,
    `aiwc-image-native-macos-${imageNativeArch}.node`
  )

  const imageNativeStat = statSafe(imageNativeAddon)
  if (!imageNativeStat || !imageNativeStat.isFile()) {
    console.log(`[macos-native-check] image native addon not present; TypeScript fallback will be used`)
  } else {
    console.log(`[macos-native-check] image native addon present: ${imageNativeAddon} (${imageNativeStat.size} bytes) [source-built]`)
  }

  console.log('[macos-native-check] all required macOS native artifacts are present')
}

main()
