import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePackage = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
const coreRoot = resolve(pluginRoot, '..', 'Flow2Spec', 'packages', 'core')
const sandbox = mkdtempSync(join(tmpdir(), 'flow2spec-dsh-pack-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

try {
  const coreTarball = pack(coreRoot)
  const pluginTarball = pack(pluginRoot)
  writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ private: true, type: 'module' }), 'utf8')
  execFileSync(npm, [
    'install',
    '--ignore-scripts',
    '--registry=https://registry.npmjs.org/',
    coreTarball,
    pluginTarball,
  ], { cwd: sandbox, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' })
  const entry = join(
    sandbox,
    'node_modules',
    '@double-coding',
    'flow2spec-deepseek-harness',
    'dist',
    'index.js',
  )
  const plugin = await import(pathToFileURL(entry).href)
  if (plugin.name !== 'flow2spec' || typeof plugin.apply !== 'function') {
    throw new Error('packed plugin entry does not expose the Cordis contract')
  }
  const packageRoot = join(dirname(entry), '..')
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (pkg.version !== sourcePackage.version) throw new Error(`unexpected packed version: ${pkg.version}`)
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') {
    throw new Error('packed plugin does not declare the Harness bundle patch')
  }
  if (pkg.dsh?.client?.platform !== 'web') {
    throw new Error('packed plugin does not declare the Harness client bundle')
  }
  if (!existsSync(join(packageRoot, 'cordis.patch.yml'))) {
    throw new Error('packed plugin does not include cordis.patch.yml')
  }
  if (!existsSync(join(packageRoot, 'dist', 'client.js'))) {
    throw new Error('packed plugin does not include dist/client.js')
  }
  console.log('test-package-install: ok')
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

function pack(cwd) {
  const output = execFileSync(npm, [
    'pack',
    '--json',
    '--pack-destination',
    sandbox,
  ], { cwd, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' })
  const result = JSON.parse(output)
  return join(sandbox, result[0].filename)
}
