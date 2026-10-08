import { createHash } from 'node:crypto'
import { updateConfiguration } from '../launcher/updates.mjs'

export function debianMetadata(bytes, inventory) {
  const configuration = updateConfiguration(JSON.parse(bytes.toString('utf8')))
  const version = configuration.version
  const colon = version.indexOf(':')
  const upstream = colon < 0 ? version : version.slice(colon + 1)
  const hyphen = upstream.lastIndexOf('-')
  if (
    !/^[0-9][0-9A-Za-z.+:~-]{0,63}$/.test(version) ||
    (colon >= 0 && !/^[0-9]+$/.test(version.slice(0, colon))) ||
    !/^[0-9]/.test(upstream) ||
    (hyphen >= 0 && !/^[0-9A-Za-z.+~]+$/.test(upstream.slice(hyphen + 1))) ||
    (configuration.manifestURL && configuration.packageFormat !== 'deb')
  )
    throw new Error('Debian package metadata does not match the update channel')
  const entries = inventory.files.filter((file) => file.path === 'updates.json')
  if (
    entries.length !== 1 ||
    entries[0].bytes !== bytes.length ||
    entries[0].sha256 !== createHash('sha256').update(bytes).digest('hex')
  )
    throw new Error('Update configuration does not match the package inventory')
  const updates = Buffer.from(
    JSON.stringify({ ...configuration, packageFormat: 'deb' }, null, 2) + '\n'
  )
  const files = inventory.files.map((file) =>
    file.path === 'updates.json'
      ? {
          ...file,
          bytes: updates.length,
          sha256: createHash('sha256').update(updates).digest('hex')
        }
      : file
  )
  return {
    version: configuration.version,
    updates,
    inventory: {
      ...inventory,
      files,
      totalBytes: files.reduce((total, file) => total + file.bytes, 0)
    }
  }
}
