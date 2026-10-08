// The selected destination stays only in the trusted supervisor, never the renderer.
export function personalExport({ native, gate, view }) {
  let destination
  return async () => {
    gate.assertCurrent()
    try {
      if (!destination) {
        const selected = await native(['choose-export'])
        if (typeof selected?.destination !== 'string')
          throw new Error('Native export destination unavailable')
        destination = selected.destination
      }
      gate.assertCurrent()
      const result = await native(
        ['export-personal', destination, String(gate.expiresAt())],
        JSON.stringify(view())
      )
      gate.assertCurrent()
      destination = undefined
      return result
    } catch (error) {
      if (error.code !== 'ESESSION') destination = undefined
      throw error
    }
  }
}
