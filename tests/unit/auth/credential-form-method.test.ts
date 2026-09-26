import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import * as ts from 'typescript'

import { describe, expect, it } from 'vitest'

interface CredentialForm {
  file: string
  line: number
  method: string | null
}

const EXPECTED_CREDENTIAL_FORM_FILES = [
  'app/(auth)/auth/reset-password/ClientPage.tsx',
  'app/(auth)/auth/signup/SimplifiedSignupForm.tsx',
  'app/(dashboard)/guild-management/settings/GuildSettingsClient.tsx',
  'app/(dashboard)/profile/edit/EditProfileClient.tsx',
  'app/(dashboard)/profile/change-password/ChangePasswordClient.tsx',
  'app/(public)/onboarding/dashboard/OnboardingDashboardClient.tsx',
  'app/components/auth/LoginForm.tsx'
] as const

const sourceCache = new Map<string, ts.SourceFile>()

const CREDENTIAL_HINT =
  /password|passcode|api[\s_-]*key|access[\s_-]*key|client[\s_-]*secret|secret|token|one[\s_-]*time[\s_-]*(?:code|password)|\botp\b|webhook/i
const CREDENTIAL_ATTRIBUTE_NAMES = new Set([
  'type',
  'autocomplete',
  'name',
  'id',
  'placeholder',
  'aria-label',
  'value',
  'defaultvalue',
  'htmlfor'
])

function walkTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return walkTsxFiles(path)
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : []
  })
}

function getAttribute(
  attributes: ts.JsxAttributes,
  name: string
): ts.JsxAttribute | null {
  return (
    attributes.properties.find(
      (property): property is ts.JsxAttribute =>
        ts.isJsxAttribute(property) && property.name.getText() === name
    ) ?? null
  )
}

function openingContainsCredentialHint(
  opening: ts.JsxOpeningLikeElement,
  source: ts.SourceFile
): boolean {
  if (CREDENTIAL_HINT.test(opening.tagName.getText(source))) return true
  return opening.attributes.properties.some((property) => {
    if (ts.isJsxSpreadAttribute(property)) {
      return CREDENTIAL_HINT.test(property.expression.getText(source))
    }
    const attributeName = property.name.getText(source).toLowerCase()
    return (
      CREDENTIAL_ATTRIBUTE_NAMES.has(attributeName) &&
      CREDENTIAL_HINT.test(property.initializer?.getText(source) ?? '')
    )
  })
}

function labelContainsCredentialHint(
  element: ts.JsxElement,
  source: ts.SourceFile
): boolean {
  return (
    element.openingElement.tagName.getText(source).toLowerCase() === 'label' &&
    CREDENTIAL_HINT.test(element.getText(source))
  )
}

function getLiteralAttributeValue(
  attributes: ts.JsxAttributes,
  name: string
): string | null {
  const attribute = getAttribute(attributes, name)
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null
}

function getSourceFile(file: string): ts.SourceFile {
  const cached = sourceCache.get(file)
  if (cached) return cached
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  sourceCache.set(file, source)
  return source
}

function resolveLocalModule(
  repoRoot: string,
  importingFile: string,
  moduleName: string
): string | null {
  const unresolved = moduleName.startsWith('@/')
    ? resolve(repoRoot, moduleName.slice(2))
    : moduleName.startsWith('.')
      ? resolve(dirname(importingFile), moduleName)
      : null
  if (!unresolved) return null

  const candidates = [
    unresolved,
    `${unresolved}.tsx`,
    `${unresolved}.ts`,
    resolve(unresolved, 'index.tsx'),
    resolve(unresolved, 'index.ts')
  ]
  return (
    candidates.find(
      (candidate) =>
        sourceCache.has(candidate) ||
        (existsSync(candidate) && statSync(candidate).isFile())
    ) ?? null
  )
}

function findLocalComponentDeclaration(
  source: ts.SourceFile,
  componentName: string
): ts.Node | null {
  for (const statement of source.statements) {
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text === componentName
    ) {
      return statement
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) =>
          ts.isIdentifier(candidate.name) &&
          candidate.name.text === componentName
      )
      if (declaration) return declaration
    }
  }
  return null
}

function resolveImportedComponent(
  repoRoot: string,
  importingFile: string,
  source: ts.SourceFile,
  tagName: string
): string | null {
  const localName = tagName.split('.')[0]
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    const clause = statement.importClause
    const bindsComponent =
      clause.name?.text === localName ||
      (clause.namedBindings !== undefined &&
        (ts.isNamespaceImport(clause.namedBindings)
          ? clause.namedBindings.name.text === localName
          : clause.namedBindings.elements.some(
              (element) => element.name.text === localName
            )))
    if (!bindsComponent || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }
    return resolveLocalModule(
      repoRoot,
      importingFile,
      statement.moduleSpecifier.text
    )
  }
  return null
}

function sourceContainsCredentialControl(
  repoRoot: string,
  file: string,
  visitedFiles: Set<string>,
  visitedComponents = new Set<string>()
): boolean {
  if (visitedFiles.has(file)) return false
  visitedFiles.add(file)
  const source = getSourceFile(file)

  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const reexportedFile = resolveLocalModule(
        repoRoot,
        file,
        statement.moduleSpecifier.text
      )
      if (
        reexportedFile &&
        sourceContainsCredentialControl(
          repoRoot,
          reexportedFile,
          visitedFiles,
          visitedComponents
        )
      ) {
        return true
      }
    }
  }

  return nodeContainsCredentialControl(
    repoRoot,
    file,
    source,
    source,
    visitedFiles,
    visitedComponents
  )
}

function nodeContainsCredentialControl(
  repoRoot: string,
  file: string,
  source: ts.SourceFile,
  root: ts.Node,
  visitedFiles: Set<string>,
  visitedComponents: Set<string>
): boolean {
  let containsCredential = false

  const visit = (node: ts.Node): void => {
    if (containsCredential) return
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      if (
        openingContainsCredentialHint(opening, source) ||
        (ts.isJsxElement(node) && labelContainsCredentialHint(node, source))
      ) {
        containsCredential = true
        return
      }

      const tagName = opening.tagName.getText(source)
      if (/^[A-Z]/.test(tagName)) {
        const importedFile = resolveImportedComponent(
          repoRoot,
          file,
          source,
          tagName
        )
        if (
          importedFile &&
          sourceContainsCredentialControl(
            repoRoot,
            importedFile,
            new Set(visitedFiles),
            visitedComponents
          )
        ) {
          containsCredential = true
          return
        }

        const componentKey = `${file}#${tagName}`
        const localDeclaration = importedFile
          ? null
          : findLocalComponentDeclaration(source, tagName)
        if (localDeclaration && !visitedComponents.has(componentKey)) {
          const nextVisitedComponents = new Set(visitedComponents)
          nextVisitedComponents.add(componentKey)
          if (
            nodeContainsCredentialControl(
              repoRoot,
              file,
              source,
              localDeclaration,
              visitedFiles,
              nextVisitedComponents
            )
          ) {
            containsCredential = true
            return
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(root)
  return containsCredential
}

function formContainsCredentialControl(
  repoRoot: string,
  file: string,
  source: ts.SourceFile,
  form: ts.JsxElement
): boolean {
  return nodeContainsCredentialControl(
    repoRoot,
    file,
    source,
    form,
    new Set([file]),
    new Set()
  )
}

function findCredentialFormsInSource(
  repoRoot: string,
  file: string,
  source: ts.SourceFile
): CredentialForm[] {
  const forms: CredentialForm[] = []

  function visit(node: ts.Node): void {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(source) === 'form'
    ) {
      if (formContainsCredentialControl(repoRoot, file, source, node)) {
        const position = source.getLineAndCharacterOfPosition(
          node.openingElement.getStart(source)
        )
        forms.push({
          file: relative(repoRoot, file),
          line: position.line + 1,
          method: getLiteralAttributeValue(
            node.openingElement.attributes,
            'method'
          )
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return forms
}

function findCredentialForms(repoRoot: string): CredentialForm[] {
  const appRoot = resolve(repoRoot, 'app')
  const forms: CredentialForm[] = []

  for (const file of walkTsxFiles(appRoot)) {
    const source = getSourceFile(file)
    forms.push(...findCredentialFormsInSource(repoRoot, file, source))
  }

  return forms
}

describe('credential form native-submission safety', () => {
  it('uses POST for every form containing a password or secret control', () => {
    const forms = findCredentialForms(process.cwd())

    expect(forms.map((form) => form.file).sort()).toEqual(
      [...EXPECTED_CREDENTIAL_FORM_FILES].sort()
    )
    expect(
      forms
        .filter((form) => form.method?.toLowerCase() !== 'post')
        .map((form) => `${form.file}:${form.line}`)
    ).toEqual([])
  })

  it.each([
    {
      name: 'text-typed API key',
      source:
        'export function Form() { return <form><input type="text" placeholder="Paste API key" /></form> }'
    },
    {
      name: 'named secret control',
      source:
        'export function Form() { return <form><input name="client_secret" type="text" /></form> }'
    },
    {
      name: 'generic token control',
      source:
        'export function Form() { return <form><input name="token" type="text" /></form> }'
    },
    {
      name: 'access token control',
      source:
        'export function Form() { return <form><input name="access_token" type="text" /></form> }'
    },
    {
      name: 'camel-cased refresh token control',
      source:
        'export function Form() { return <form><input name="refreshToken" type="text" /></form> }'
    },
    {
      name: 'one-time-code autocomplete control',
      source:
        'export function Form() { return <form><input autoComplete="one-time-code" inputMode="numeric" /></form> }'
    },
    {
      name: 'OTP control',
      source:
        'export function Form() { return <form><input name="otp" inputMode="numeric" /></form> }'
    },
    {
      name: 'same-file child component',
      source: `
        function ConnectionFields() { return <input value={playerApiKey} /> }
        export function Form() { return <form><ConnectionFields /></form> }
      `
    }
  ])('detects a $name without relying on type=password', ({ source }) => {
    const repoRoot = process.cwd()
    const file = resolve(repoRoot, 'app/__credential-audit-fixture__.tsx')
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    sourceCache.set(file, parsed)
    try {
      expect(findCredentialFormsInSource(repoRoot, file, parsed)).toEqual([
        expect.objectContaining({ method: null })
      ])
    } finally {
      sourceCache.delete(file)
    }
  })

  it('follows a locally imported child through a re-export barrel', () => {
    const repoRoot = process.cwd()
    const hostFile = resolve(repoRoot, 'app/__credential-host__.tsx')
    const barrelFile = resolve(repoRoot, 'app/__credential-barrel__.ts')
    const childFile = resolve(repoRoot, 'app/__credential-child__.tsx')
    const host = ts.createSourceFile(
      hostFile,
      `import { ConnectionFields } from './__credential-barrel__'; export function Form() { return <form><ConnectionFields /></form> }`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    const barrel = ts.createSourceFile(
      barrelFile,
      `export { ConnectionFields } from './__credential-child__'`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    const child = ts.createSourceFile(
      childFile,
      `export function ConnectionFields() { return <input type="text" placeholder="Client secret" /> }`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    sourceCache.set(hostFile, host)
    sourceCache.set(barrelFile, barrel)
    sourceCache.set(childFile, child)
    try {
      expect(findCredentialFormsInSource(repoRoot, hostFile, host)).toEqual([
        expect.objectContaining({ method: null })
      ])
    } finally {
      sourceCache.delete(hostFile)
      sourceCache.delete(barrelFile)
      sourceCache.delete(childFile)
    }
  })
})
