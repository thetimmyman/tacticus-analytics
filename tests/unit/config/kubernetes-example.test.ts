import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse, parseAllDocuments } from 'yaml'

const root = process.cwd()
const exampleDirectory = path.join(root, 'examples', 'kubernetes')
const readExample = (name: string) =>
  readFileSync(path.join(exampleDirectory, name), 'utf8')
const readYaml = (name: string) =>
  parse(readExample(name)) as Record<string, any>

function yamlFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => path.join(directory, name))
}

describe('Kubernetes example', () => {
  it('includes existing resources without applying the Secret template', () => {
    const kustomization = readYaml('kustomization.yaml')
    const resources = kustomization.resources as string[]
    expect(resources).not.toContain('secret.example.yaml')
    for (const resource of resources) {
      expect(statSync(path.join(exampleDirectory, resource)).isFile()).toBe(
        true
      )
    }
  })

  it('does not set namespaces in resources or kustomization', () => {
    expect(readYaml('kustomization.yaml').namespace).toBeUndefined()
    for (const file of yamlFiles(exampleDirectory)) {
      const documents = parseAllDocuments(readFileSync(file, 'utf8'))
      for (const document of documents) {
        const value = document.toJSON() as Record<string, any> | null
        expect(value?.metadata?.namespace, path.basename(file)).toBeUndefined()
      }
    }
  })

  it('uses only documentation IPv4 addresses and hosts the app may use', () => {
    const identity = JSON.parse(
      readFileSync(path.join(root, '.app-identity.json'), 'utf8')
    ) as { siteHosts: string[]; apiHosts: string[] }
    const identityHosts = new Set([...identity.siteHosts, ...identity.apiHosts])
    const contents = readdirSync(exampleDirectory).map((name) => ({
      name,
      content: readExample(name)
    }))
    const allowedIpv4 = (address: string) =>
      address === '0.0.0.0' ||
      address === '127.0.0.1' ||
      /^192\.0\.2\./u.test(address) ||
      /^198\.51\.100\./u.test(address) ||
      /^203\.0\.113\./u.test(address)
    for (const { name, content } of contents) {
      for (const address of content.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu)) {
        expect(allowedIpv4(address[0]), `${name}: ${address[0]}`).toBe(true)
      }
      for (const match of content.matchAll(/https?:\/\/([^\s/'"`]+)/gu)) {
        const host = new URL(match[0]).hostname.toLowerCase()
        expect(
          identityHosts.has(host) || host === 'localhost',
          `${name}: ${host}`
        ).toBe(true)
      }
    }
  })

  it('passes the identity check the container runs before next start', () => {
    const verifier = path.join(root, 'scripts/dev/verify-app-identity.mjs')
    const run = (overrides: Record<string, string>) => {
      try {
        execFileSync(process.execPath, [verifier], {
          cwd: root,
          env: {
            PATH: process.env.PATH ?? '',
            NODE_ENV: 'production',
            APP_IDENTITY_RUNTIME: '1',
            TACTICUS_APP_ID: 'tacticus-analytics',
            ...(readYaml('configmap.yaml').data as Record<string, string>),
            ...overrides
          },
          stdio: 'pipe'
        })
        return 0
      } catch (error) {
        return (error as { status?: number }).status ?? 1
      }
    }
    expect(run({})).toBe(0)
    expect(run({ NEXT_PUBLIC_SITE_URL: 'https://app.example.com' })).not.toBe(0)
  })

  it('builds with the identity hosts the Dockerfile verifier accepts', () => {
    const readme = readExample('README.md')
    const buildArgs = Object.fromEntries(
      [...readme.matchAll(/--build-arg\s+([A-Z_]+)=(\S+)/gu)].map((m) => [
        m[1],
        m[2]
      ])
    )
    expect(Object.keys(buildArgs)).toEqual(
      expect.arrayContaining([
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SITE_URL'
      ])
    )
    const configMap = readYaml('configmap.yaml').data as Record<string, string>
    expect(buildArgs.NEXT_PUBLIC_SUPABASE_URL).toBe(
      configMap.NEXT_PUBLIC_SUPABASE_URL
    )
    expect(buildArgs.NEXT_PUBLIC_SITE_URL).toBe(configMap.NEXT_PUBLIC_SITE_URL)
  })

  it('maps probes to existing routes and uses the Docker exposed port', () => {
    const deployment = readYaml('deployment.yaml')
    const container = deployment.spec.template.spec.containers[0]
    const dockerfile = readFileSync(
      path.join(root, 'docker/Dockerfile.prod'),
      'utf8'
    )
    const exposedPort = /^EXPOSE\s+(\d+)\s*$/mu.exec(dockerfile)?.[1]
    expect(exposedPort).toBeDefined()
    expect(container.ports[0].containerPort).toBe(Number(exposedPort))
    for (const probeName of [
      'startupProbe',
      'livenessProbe',
      'readinessProbe'
    ]) {
      const probePath = container[probeName].httpGet.path as string
      const routePath = path.join(
        root,
        'app',
        ...probePath.replace(/^\//u, '').split('/'),
        'route.ts'
      )
      expect(statSync(routePath).isFile(), `${probeName}: ${probePath}`).toBe(
        true
      )
    }
  })

  it('runs as the numeric Docker image user with non-root enforcement', () => {
    const deployment = readYaml('deployment.yaml')
    const dockerfile = readFileSync(
      path.join(root, 'docker/Dockerfile.prod'),
      'utf8'
    )
    const uid = /adduser\s+--system\s+--uid\s+(\d+)\s+nextjs/u.exec(
      dockerfile
    )?.[1]
    expect(uid).toBeDefined()
    expect(deployment.spec.template.spec.securityContext.runAsNonRoot).toBe(
      true
    )
    expect(deployment.spec.template.spec.securityContext.runAsUser).toBe(
      Number(uid)
    )
  })

  it('documents every ConfigMap and Secret template key in the environment example', () => {
    const configMap = readYaml('configmap.yaml')
    const secretTemplate = readYaml('secret.example.yaml')
    const environmentExample = readFileSync(
      path.join(root, '.env.example'),
      'utf8'
    )
    const environmentKeys = new Set(
      environmentExample
        .split(/\r?\n/u)
        .map((line) => /^\s*([A-Z][A-Z0-9_]*)=/u.exec(line)?.[1])
        .filter((key): key is string => key !== undefined)
    )
    for (const key of [
      ...Object.keys(configMap.data),
      ...Object.keys(secretTemplate.stringData)
    ]) {
      expect(environmentKeys.has(key), key).toBe(true)
    }
  })

  it('supplies every variable the image smoke test starts the container with', () => {
    const workflow = readFileSync(
      path.join(root, '.github/workflows/build-clean-image.yml'),
      'utf8'
    )
    const dockerRun = /docker run -d([\s\S]*?)"\$IMAGE:\$TAG"/u.exec(
      workflow
    )?.[1]
    expect(dockerRun).toBeDefined()
    const smokeKeys = [
      ...(dockerRun ?? '').matchAll(/-e\s+([A-Z][A-Z0-9_]*)/gu)
    ].map((match) => match[1])
    expect(smokeKeys.length).toBeGreaterThan(0)
    const provided = new Set([
      ...Object.keys(readYaml('configmap.yaml').data),
      ...Object.keys(readYaml('secret.example.yaml').stringData)
    ])
    for (const key of smokeKeys) {
      expect(provided.has(key as string), key).toBe(true)
    }
  })

  it('connects the Service selector and named target port to the Deployment', () => {
    const deployment = readYaml('deployment.yaml')
    const service = readYaml('service.yaml')
    expect(service.spec.selector).toEqual(
      deployment.spec.template.metadata.labels
    )
    const containerPorts = deployment.spec.template.spec.containers.flatMap(
      (container: { ports: Array<{ name: string; containerPort: number }> }) =>
        container.ports
    )
    const target = containerPorts.find(
      (port: { name: string }) => port.name === service.spec.ports[0].targetPort
    )
    expect(target).toBeDefined()
    expect(service.spec.ports[0].port).toBe(80)
  })

  it('reads its environment from the ConfigMap and the Secret the example names', () => {
    const deployment = readYaml('deployment.yaml')
    const envFrom = deployment.spec.template.spec.containers[0]
      .envFrom as Array<{
      configMapRef?: { name: string }
      secretRef?: { name: string }
    }>
    expect(envFrom.map((source) => source.configMapRef?.name)).toContain(
      readYaml('configmap.yaml').metadata.name
    )
    expect(envFrom.map((source) => source.secretRef?.name)).toContain(
      readYaml('secret.example.yaml').metadata.name
    )
  })

  it('uses a placeholder image hosted on an example domain', () => {
    const deployment = readYaml('deployment.yaml')
    const image = deployment.spec.template.spec.containers[0].image as string
    const [registry, repositoryAndTag] = image.split('/', 2)
    expect(registry).toMatch(/(^|\.)example\.(com|invalid)$/u)
    expect(repositoryAndTag).toContain('REPLACE_WITH_IMMUTABLE_TAG')
  })
})
