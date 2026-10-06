import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { platform, arch, release } from 'node:os'

const toolNames = [
  'qemu-system-x86_64',
  'virsh',
  'VBoxManage',
  'adb',
  'emulator',
  'xcrun',
  'xcodebuild',
  'powershell',
  'pwsh',
  'unshare',
  'bwrap'
]
function platformName() {
  const names = { linux: 'linux', darwin: 'macos', win32: 'windows' }
  return names[platform()] ?? platform()
}
export async function inventoryLocal() {
  const tools = {}
  for (const tool of toolNames) {
    tools[tool] = false
    for (const directory of (process.env.PATH ?? '').split(
      process.platform === 'win32' ? ';' : ':'
    )) {
      if (!directory) continue
      try {
        await access(
          join(directory, process.platform === 'win32' ? `${tool}.exe` : tool),
          constants.X_OK
        )
        tools[tool] = true
        break
      } catch {}
    }
  }
  let kvm = false
  try {
    await access('/dev/kvm', constants.R_OK | constants.W_OK)
    kvm = true
  } catch {}
  return {
    schemaVersion: 'platform-inventory/v1',
    observedAt: new Date().toISOString(),
    os: platformName(),
    arch: arch(),
    osVersion: release(),
    tools,
    accessibleKvm: kvm,
    rights: {
      windowsImage: 'unconfirmed',
      appleHost: 'unconfirmed',
      signing: 'unconfirmed',
      budget: 'unconfirmed'
    },
    deviceProof:
      'No attached-device or remote-host qualification is inferred from installed tools.'
  }
}
