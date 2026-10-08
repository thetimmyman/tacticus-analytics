import { readFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'

export function peImports(bytes) {
  const need = (offset, size) => {
    if (offset < 0 || offset + size > bytes.length)
      throw new Error('Truncated PE input')
  }
  need(0, 64)
  if (bytes.readUInt16LE(0) !== 0x5a4d) return []
  const pe = bytes.readUInt32LE(0x3c)
  need(pe, 24)
  if (bytes.readUInt32LE(pe) !== 0x4550) throw new Error('Invalid PE signature')
  const count = bytes.readUInt16LE(pe + 6),
    optionalSize = bytes.readUInt16LE(pe + 20),
    optional = pe + 24
  if (count > 100) throw new Error('PE section limit')
  need(optional, optionalSize)
  const magic = bytes.readUInt16LE(optional)
  const directory = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1
  if (directory < 0 || optionalSize < directory + 16)
    throw new Error('Unsupported PE format')
  const sections = optional + optionalSize
  need(sections, count * 40)
  const offsetOf = (rva) => {
    for (let i = 0; i < count; i++) {
      const section = sections + i * 40,
        address = bytes.readUInt32LE(section + 12),
        rawSize = bytes.readUInt32LE(section + 16)
      if (rva >= address && rva - address < rawSize) {
        const offset = bytes.readUInt32LE(section + 20) + rva - address
        need(offset, 1)
        return offset
      }
    }
    throw new Error('PE RVA outside file sections')
  }
  const rva = bytes.readUInt32LE(optional + directory + 8)
  if (!rva) return []
  const descriptors = offsetOf(rva),
    imports = []
  for (let index = 0; index < 768; index++) {
    const offset = descriptors + index * 20
    need(offset, 20)
    const name = bytes.readUInt32LE(offset + 12)
    if (!name) return imports
    const start = offsetOf(name),
      end = bytes.indexOf(0, start)
    if (end < start || end - start > 256) throw new Error('PE DLL name limit')
    const dll = bytes.subarray(start, end).toString('ascii').toLowerCase()
    if (!/^[a-z0-9_.-]+\.(dll|drv)$/.test(dll))
      throw new Error('Unsafe PE DLL name')
    imports.push(dll)
  }
  throw new Error('PE import limit')
}

// These are OS components on the documented Windows 11/Server target, not developer redistributables.
const osDlls = new Set([
  'kernel32.dll',
  'kernelbase.dll',
  'ntdll.dll',
  'advapi32.dll',
  'user32.dll',
  'gdi32.dll',
  'ws2_32.dll',
  'wldap32.dll',
  'secur32.dll',
  'shell32.dll',
  'shlwapi.dll',
  'ole32.dll',
  'oleacc.dll',
  'msimg32.dll',
  'oleaut32.dll',
  'crypt32.dll',
  'bcrypt.dll',
  // Windows CNG Cryptographic Primitives Library (Microsoft security policy 140sp1336).
  'bcryptprimitives.dll',
  'ncrypt.dll',
  'version.dll',
  'winmm.dll',
  'dbghelp.dll',
  'psapi.dll',
  'iphlpapi.dll',
  'userenv.dll',
  'powrprof.dll',
  'mswsock.dll',
  'rpcrt4.dll',
  'comdlg32.dll',
  'comctl32.dll',
  'dwmapi.dll',
  'dwrite.dll',
  'dxgi.dll',
  'd3d11.dll',
  'd3d12.dll',
  'd3d9.dll',
  'dcomp.dll',
  'd3dcompiler_47.dll',
  'hid.dll',
  'setupapi.dll',
  'cfgmgr32.dll',
  'wintrust.dll',
  'winhttp.dll',
  'wininet.dll',
  'urlmon.dll',
  'dnsapi.dll',
  'netapi32.dll',
  'wtsapi32.dll',
  'propsys.dll',
  'uxtheme.dll',
  'avrt.dll',
  'imm32.dll',
  'mf.dll',
  'mfplat.dll',
  'mfreadwrite.dll',
  'mfuuid.dll',
  'msvcrt.dll',
  'ucrtbase.dll',
  'normaliz.dll',
  'msasn1.dll',
  'authz.dll',
  'winsta.dll',
  'wlanapi.dll',
  'usp10.dll',
  'ddraw.dll',
  'dsound.dll',
  'pdh.dll',
  'sensapi.dll',
  'netutils.dll',
  'wkscli.dll',
  'srvcli.dll',
  'winspool.drv'
])
export async function auditDependencies(root, files) {
  const names = new Map(
    files.map((file) => [file.path.toLowerCase(), file.path])
  )
  const checked = [],
    missing = []
  // Runtime entry points and the PostgreSQL libraries/extensions are the required execution closure.
  const queue = files
    .filter((file) =>
      /^(postgres\/bin\/.*\.exe|bin\/node\.exe|electron\/electron\.exe|auth\/auth\.exe|postgrest\/postgrest\.exe|TacticusDesktop\.exe|application\/.*\.node)$/i.test(
        file.path
      )
    )
    .map((file) => file.path)
  const visited = new Set()
  while (queue.length) {
    const path = queue.pop()
    if (visited.has(path.toLowerCase())) continue
    visited.add(path.toLowerCase())
    for (const dll of peImports(await readFile(join(root, path)))) {
      const local = names.get(
        `${dirname(path) === '.' ? '' : dirname(path).replaceAll('\\', '/') + '/'}${dll}`.toLowerCase()
      )
      const pgBin = path.startsWith('postgres/')
        ? names.get(`postgres/bin/${dll}`)
        : undefined
      const nodeBin = path.startsWith('application/')
        ? names.get(`bin/${dll}`)
        : undefined
      if (local || pgBin || nodeBin) queue.push(local ?? pgBin ?? nodeBin)
      else if (!osDlls.has(dll) && !/^(api-ms-win-|ext-ms-win-)/.test(dll))
        missing.push({ component: path, dll })
    }
    checked.push(basename(path))
  }
  if (missing.length)
    throw new Error(
      `Unbundled native dependency: ${JSON.stringify([...new Set(missing.map((item) => item.dll))].slice(0, 64))}`
    )
  return {
    checkedFiles: checked.length,
    unresolvedThirdPartyDlls: 0,
    target: 'Windows 11 x64 / hosted Windows Server',
    developerRuntimeRequired: false
  }
}
