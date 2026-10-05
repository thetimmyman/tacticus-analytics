import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { workspaceAuthorized } from '../../launcher/workspace-session.mjs'

const expired = () =>
  Object.assign(new Error('Unlock your local workspace to continue.'), {
    code: 'ESESSION'
  })

// This channel is inherited by Electron main. It has no renderer IPC or HTTP token-return route.
export function currentSessionChannel() {
  let window
  const pending = new Map()
  return {
    attach(child) {
      window = child
      child.on('message', (message) => {
        if (
          !message ||
          message.operation !== 'workspace-session' ||
          !pending.has(message.nonce)
        )
          return
        const accept = pending.get(message.nonce)
        pending.delete(message.nonce)
        accept(message.token)
      })
    },
    async token() {
      if (!window?.connected) throw expired()
      const nonce = randomUUID()
      const token = await new Promise((accept) => {
        const timeout = setTimeout(() => {
          pending.delete(nonce)
          accept(null)
        }, 5000)
        pending.set(nonce, (value) => {
          clearTimeout(timeout)
          accept(value)
        })
        window.send({ operation: 'workspace-session', nonce })
      })
      if (typeof token !== 'string' || token.length > 16384) throw expired()
      return token
    }
  }
}

export function workspaceGate({ services, brokerToken, currentToken, owner }) {
  const context = new AsyncLocalStorage()
  const assertCurrent = () => {
    const current = context.getStore()
    if (!current || !services.validOwnerSession(current.token, current.subject))
      throw expired()
  }
  return {
    assertCurrent,
    expiresAt() {
      assertCurrent()
      return (
        JSON.parse(
          Buffer.from(context.getStore().token.split('.')[1], 'base64url')
        ).exp * 1000
      )
    },
    async run(operation) {
      const subject = await owner()
      if (!subject) throw expired()
      const token = await currentToken()
      const nativeReq = {
        headers: {
          authorization: `Bearer ${token}`,
          'x-desktop-broker': brokerToken
        }
      }
      if (
        !(await workspaceAuthorized(
          services,
          nativeReq,
          {},
          subject,
          brokerToken
        ))
      )
        throw expired()
      return context.run({ token, subject }, async () => {
        assertCurrent()
        try {
          return await operation()
        } finally {
          assertCurrent()
        }
      })
    }
  }
}
