import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  currentWorkspaceToken,
  nativeSessionRequest
} from '../launcher/workspace-session.mjs'
test('whole and contiguous split owner-session cookies yield a token lookup, while malformed and missing cookies refuse', () => {
  const token = 'synthetic.payload.signature',
    value =
      'base64-' +
      Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')
  assert.equal(
    currentWorkspaceToken([{ name: 'tacticus-auth-token', value }]),
    token
  )
  assert.equal(
    currentWorkspaceToken([
      { name: 'tacticus-auth-token.1', value: value.slice(20) },
      { name: 'tacticus-auth-token.0', value: value.slice(0, 20) }
    ]),
    token
  )
  for (const cookies of [
    [],
    [{ name: 'tacticus-auth-token.1', value }],
    [{ name: 'tacticus-auth-token', value: 'malformed' }],
    [{ name: 'unrelated', value }],
    [
      {
        name: 'tacticus-auth-token',
        value: JSON.stringify({ access_token: 'not-a-token' })
      }
    ]
  ])
    assert.throws(
      () => currentWorkspaceToken(cookies),
      (error) => error.code === 'ESESSION'
    )
})
test('session authorization requires the separate native capability as well as the owner token', () => {
  const capability = randomBytes(32).toString('hex')
  assert.equal(
    nativeSessionRequest(
      {
        headers: {
          authorization: 'Bearer synthetic.payload.signature',
          'x-desktop-broker': capability
        }
      },
      capability
    ),
    true
  )
  for (const headers of [
    { authorization: 'Bearer synthetic.payload.signature' },
    { 'x-desktop-broker': capability },
    {
      authorization: 'Bearer synthetic.payload.signature',
      'x-desktop-broker': 'forged'
    }
  ])
    assert.equal(nativeSessionRequest({ headers }, capability), false)
})
