/** Public, synthetic application identity. Never use captured device data. */
export const PUBLIC_LOKI_INSTALL_ID = '74616374-6963-4573-8061-6e616c797469'
export const PUBLIC_LOKI_DEVICE_ID =
  '7461637469637573616e616c797469637300000001'

export const PUBLIC_LOKI_DEVICE_METADATA = {
  installId: PUBLIC_LOKI_INSTALL_ID,
  deviceId: PUBLIC_LOKI_DEVICE_ID,
  countryCode: 'ZZ',
  locale: 'en-US',
  manufacturer: 'Tacticus Analytics',
  model: 'TacticusAnalytics',
  os: 'Web',
  platform: 'Windows',
  store: 'WebStore'
} as const
