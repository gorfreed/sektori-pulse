const path = require('node:path')

async function main() {
  const [exePath, iconPath] = process.argv.slice(2)
  if (!exePath || !iconPath) throw new Error('Executable and icon paths are required.')
  const { rcedit } = await import('rcedit')
  await rcedit(path.resolve(exePath), {
    icon: path.resolve(iconPath),
    'file-version': '0.1.0',
    'product-version': '0.1.0',
    'version-string': {
      ProductName: 'Sektori Pulse',
      FileDescription: 'Sektori Pulse',
      InternalName: 'Sektori Pulse',
      OriginalFilename: 'Sektori Pulse.exe',
    },
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
