import { join } from 'node:path'

export function bundledServices(root, state, lifetime = 3600) {
  return {
    state,
    runtimeGuard: join(root, 'bin/runtime-guard'),
    userSessionLifetimeSeconds: lifetime,
    libraryPath: join(root, 'postgres/lib'),
    schemaDirectory: join(root, 'apps/desktop/local-schema'),
    binaries: {
      initdb: join(root, 'postgres/bin/initdb'),
      postgres: join(root, 'postgres/bin/postgres'),
      psql: join(root, 'postgres/bin/psql'),
      auth: join(root, 'auth/auth'),
      authCwd: join(root, 'auth'),
      postgrest: join(root, 'postgrest/postgrest')
    }
  }
}
