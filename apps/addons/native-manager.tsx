import React from 'react'
import { createRoot } from 'react-dom/client'
import { AddonManager } from './AddonManager'
import type { AddonCommands } from './commands'

declare global {
  interface Window {
    localAddons: AddonCommands
  }
}
const root = document.getElementById('addons')
if (!root || !window.localAddons)
  throw new Error('Native add-on bridge unavailable')
createRoot(root).render(
  <AddonManager
    commands={window.localAddons}
    bindingRevision="native-workspace"
  />
)
