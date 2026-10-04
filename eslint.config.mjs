// @ts-check
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import { plugin as tacticusRules } from './eslint-rules/no-internal-identifier-in-ui.mjs'
import { internalIdentifierAllowedFiles } from './eslint-rules/internal-identifier-allowed-files.mjs'

let storybookConfigs = []
try {
  const storybook = await import('eslint-plugin-storybook')
  storybookConfigs = storybook.default?.configs?.['flat/recommended'] || []
} catch {
  // eslint-plugin-storybook is optional.
}

const legacyImportPatterns = [
  {
    group: ['@/lib/*', '@/components/*', '@/hooks/*', '@/utils/*'],
    message:
      'Legacy import path detected. Use @/app/lib/, @/app/components/, etc. instead'
  }
]

const authBrowserImportPattern = {
  group: ['@/app/lib/auth/browser'],
  message:
    'Use dbClient() from @/app/lib/db/client instead of createBrowserClient()'
}

const routeBrowserClientPatterns = [
  ...legacyImportPatterns,
  authBrowserImportPattern,
  {
    group: ['@/app/lib/db/client'],
    message:
      'Route handlers must use server-side Supabase factories instead of dbClient().'
  }
]

// Supabase SDK constructors: lifted only for approved factory/exception files.
const supabaseConstructorPaths = [
  {
    name: '@supabase/ssr',
    importNames: ['createServerClient', 'createBrowserClient'],
    message:
      'Create Supabase SSR/browser clients only in approved factory or exception files.'
  },
  {
    name: '@supabase/supabase-js',
    importNames: ['createClient'],
    message:
      'Create Supabase SDK clients only in approved factory or exception files.'
  }
]

// Import db() / serviceDb() from @/app/lib/db, not the underlying auth/server factories.
const authServerFactoryRestriction = {
  name: '@/app/lib/auth/server',
  importNames: ['createClient', 'createServiceClient'],
  message:
    "Import { db, serviceDb } from '@/app/lib/db' instead of the raw factories."
}

const writeQueuePath = {
  name: '@/app/lib/db/write-queue',
  message: 'Import writeQueue from @/app/lib/db instead of internal db modules.'
}

const uiKitMigrationPaths = [
  '@/app/components/ui/Button',
  '@/app/components/ui/badge',
  '@/app/components/ui/card',
  '@/app/components/ui/Input',
  '@/app/components/ui/Label',
  '@/app/components/ui/Tabs',
  '@/app/components/ui/Switch',
  '@/app/components/ui/TabSelector',
  '@/app/components/ui/Tooltip',
  '@/app/components/ui/TooltipWrapper',
  '@/app/components/ui/StatusBadge',
  '@/app/components/ui/Avatar',
  '@/app/components/ui/SortableTable',
  '@/app/components/ui/BrandButton',
  '@/app/components/ui/Toast',
  '@/app/components/ui/select',
  '@/app/components/ui/textarea',
  '@/app/components/ui/skeleton',
  '@/app/components/ui/EmptyState',
  '@/app/components/ui/DataTable',
  '@/app/components/ui/Spinner'
].map((name) => ({
  name,
  message: name.endsWith('/SortableTable')
    ? 'SortableTable was retired. Import DataTable from @tacticus/ui-kit instead.'
    : 'This component lives in @tacticus/ui-kit. Import from @tacticus/ui-kit instead.'
}))

const serverBoundaryPaths = [
  {
    name: 'next/headers',
    message: 'Server imports are not allowed in client components'
  },
  {
    name: 'next/cookies',
    message: 'Server imports are not allowed in client components'
  }
]

const appCoreMigrationPaths = [
  {
    name: '@/app/lib/utils/encryption',
    message: 'Encryption helpers live in @tacticus/app-core/encryption.'
  },
  {
    name: '@/app/lib/utils/api-key-validation',
    message:
      'API key validation helpers live in @tacticus/app-core/api-key-validation.'
  },
  {
    name: '@/app/lib/utils/queryRateLimiter',
    message:
      'queryRateLimiter was retired (round-2 LOC reduction); see git history.'
  },
  {
    name: '@/app/lib/utils/memoization',
    message: 'Memoization helpers live in @tacticus/app-core/memoization.'
  },
  {
    name: '@/app/lib/utils/season-timing',
    message:
      'Use the live server season-timing service or the /api/season/timing client endpoint.'
  },
  {
    name: '@/app/lib/utils/performanceMonitor',
    message:
      'Performance monitoring helpers live in @tacticus/app-core/performance-monitor.'
  },
  {
    name: '@/app/lib/utils/unified-cache',
    message: 'Unified cache lives in @tacticus/app-core/unified-cache.'
  },
  {
    name: '@/app/lib/utils/formatters',
    message: 'Formatters live in @tacticus/app-core/formatters.'
  },
  {
    name: '@/app/lib/utils/explore-privacy',
    message:
      'Explore privacy helpers live in @tacticus/app-core/explore-privacy.'
  },
  {
    name: '@/app/lib/utils/supabase-env',
    message:
      'Supabase environment helpers live in @tacticus/app-core/supabase-env.'
  },
  {
    name: '@/app/lib/constants/api-constants',
    message: 'API constants live in @tacticus/app-core/api-constants.'
  },
  {
    name: '@/app/lib/utils/image-optimization',
    message:
      'Image optimization helpers live in @tacticus/app-core/image-optimization.'
  },
  {
    name: '@/app/lib/utils/array-optimizations',
    message: 'Array helpers live in @tacticus/app-core/array-optimizations.'
  },
  {
    name: '@/app/lib/utils/date-utils',
    message:
      'date-utils was retired (round-2 LOC reduction); formatClientDate is inlined in @tacticus/ui-kit ClientDate. Other helpers: git history.'
  },
  {
    name: '@/app/lib/utils/rarity-utils',
    message: 'Rarity helpers live in @tacticus/app-core/rarity-utils.'
  },
  {
    name: '@/app/lib/utils/role-utils',
    message: 'Role helpers live in @tacticus/app-core/role-utils.'
  },
  {
    name: '@/app/lib/utils/logging-sanitizer',
    message: 'Logging sanitizers live in @tacticus/app-core/logging-sanitizer.'
  },
  {
    name: '@/app/lib/cache/cluster-cache',
    message: 'Cluster cache lives in @tacticus/app-core/cluster-cache.'
  },
  {
    name: '@/app/lib/cache/hero-mappings-cache',
    message:
      'Hero identity lives in the shared catalog: @/app/lib/catalogs (the standalone hero-mappings cache is retired).'
  },
  {
    name: '@/app/lib/services/app-cache',
    message: 'App cache lives in @tacticus/app-core/app-cache.'
  },
  {
    name: '@/app/lib/utils/request-dedup',
    message: 'Use request-deduplication helpers; file has been removed.'
  },
  {
    name: '@/app/lib/utils/performance-monitor',
    message: 'Use performanceMonitor; file has been removed.'
  },
  {
    name: '@/app/lib/utils/notification-utils',
    message: 'Legacy alert/confirm wrappers removed; use real UI components.'
  }
]

const alwaysApplyPaths = [
  ...uiKitMigrationPaths,
  ...appCoreMigrationPaths,
  writeQueuePath
]

const clientPaths = [
  ...alwaysApplyPaths,
  ...serverBoundaryPaths,
  ...supabaseConstructorPaths,
  authServerFactoryRestriction
]

const serverPaths = [
  ...alwaysApplyPaths,
  ...supabaseConstructorPaths,
  authServerFactoryRestriction
]

const factoryPaths = [...alwaysApplyPaths]

// May import the auth/server factories directly, but not raw @supabase/* constructors.
const supabaseFactoryExceptionPaths = [
  ...alwaysApplyPaths,
  ...supabaseConstructorPaths
]

const packageBaseRules = {
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/no-empty-object-type': 'off',
  'prefer-const': 'off',
  'react-hooks/exhaustive-deps': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/incompatible-library': 'off',
  'react-hooks/immutability': 'off',
  'react/no-array-index-key': 'off',
  'no-restricted-syntax': 'off'
}

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    plugins: {
      ...nextCoreWebVitals[0].plugins,
      ...nextCoreWebVitals[1].plugins
    },
    rules: {
      'import/no-relative-parent-imports': 'off',
      '@next/next/no-img-element': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...legacyImportPatterns,
            authBrowserImportPattern,
            {
              group: [
                '@/app/components/ui/radix-*',
                '@/app/components/ui/loading*'
              ],
              message:
                'Use @tacticus/ui-kit equivalents instead of app/ui for migrated components.'
            }
          ],
          paths: clientPaths
        }
      ],
      'react-hooks/exhaustive-deps': 'warn',
      // React Compiler diagnostics are advisory until the app opts into the compiler.
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react/no-array-index-key': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='toLocaleString']:not(ConditionalExpression CallExpression)",
          message:
            "Hydration risk: toLocaleString() without hasMounted check causes SSR/CSR mismatch. Use: hasMounted ? date.toLocaleString() : 'fallback'"
        },
        {
          selector:
            "CallExpression[callee.property.name='toLocaleTimeString']:not(ConditionalExpression CallExpression)",
          message:
            "Hydration risk: toLocaleTimeString() without hasMounted check causes SSR/CSR mismatch. Use: hasMounted ? date.toLocaleTimeString() : 'fallback'"
        },
        {
          selector:
            "CallExpression[callee.property.name='toLocaleDateString']:not(ConditionalExpression CallExpression)",
          message:
            "Hydration risk: toLocaleDateString() without hasMounted check causes SSR/CSR mismatch. Use: hasMounted ? date.toLocaleDateString() : 'fallback'"
        },
        // `.rpc('fn' as any|never, ...)` hides schema drift.
        {
          selector:
            "CallExpression[callee.property.name='rpc'] > TSAsExpression > TSAnyKeyword",
          message:
            "`.rpc('fn' as any)` hides Supabase schema drift. Regenerate database.generated.ts instead."
        },
        {
          selector:
            "CallExpression[callee.property.name='rpc'] > TSAsExpression > TSNeverKeyword",
          message:
            "`.rpc('fn' as never)` hides Supabase schema drift. Regenerate database.generated.ts instead."
        },
        {
          selector:
            "MemberExpression[property.name='rpc'][object.type='TSAsExpression']",
          message:
            '`(supabase as any).rpc(...)` hides Supabase schema drift. Regenerate database.generated.ts instead.'
        },
        // `.from('table' as never)`: same hazard as RPC casts.
        {
          selector:
            "CallExpression[callee.property.name='from'] > TSAsExpression > TSNeverKeyword",
          message:
            "`.from('table' as never)` hides Supabase schema drift. Regenerate database.generated.ts instead."
        }
        // guild_code JSX children are covered by tacticus/no-internal-identifier-in-ui.
      ]
    }
  },
  {
    files: ['app/**/route.ts', 'app/**/route.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: routeBrowserClientPatterns,
          paths: [
            ...serverPaths,
            // Route handlers use db() / serviceDb(); type-only SDK imports stay allowed.
            {
              name: '@supabase/supabase-js',
              importNames: ['createClient'],
              message:
                "Use serviceDb() or db() from '@/app/lib/db' instead of createClient from @supabase/supabase-js."
            }
          ]
        }
      ]
    }
  },
  {
    files: ['app/layout.tsx', 'app/**/layout.tsx', 'app/lib/security/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...legacyImportPatterns, authBrowserImportPattern],
          paths: serverPaths
        }
      ]
    }
  },
  {
    files: ['app/lib/db/client.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: legacyImportPatterns,
          paths: clientPaths
        }
      ]
    }
  },
  {
    files: ['app/lib/auth/server.ts', 'app/lib/auth/browser.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: legacyImportPatterns,
          paths: factoryPaths
        }
      ]
    }
  },
  {
    // Operational entrypoints and scripts may create ad hoc clients.
    files: ['proxy.ts', 'apps/desktop/proof/native-journey.mts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...legacyImportPatterns, authBrowserImportPattern],
          paths: factoryPaths
        }
      ]
    }
  },
  {
    files: [
      'app/(auth)/auth/callback/route.ts',
      'app/api/guild-tokens/route.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: routeBrowserClientPatterns,
          paths: factoryPaths
        }
      ]
    }
  },
  // The only approved importer of the raw auth/server factories; new exceptions get their own block.
  {
    files: ['app/lib/db/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: legacyImportPatterns,
          paths: supabaseFactoryExceptionPaths
        }
      ]
    }
  },
  {
    files: [
      'app/components/boss-performance/BossPerformanceContainer.tsx',
      'app/(dashboard)/guild-management/settings/WebhookSettings.tsx'
    ],
    rules: {
      'react-hooks/exhaustive-deps': [
        'warn',
        {
          enableDangerousAutofixThisMayCauseInfiniteLoops: false
        }
      ]
    }
  },
  {
    // Plain .ts cannot contain JSX, so locale methods carry no hydration risk.
    files: ['**/*.ts'],
    ignores: ['**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='rpc'] > TSAsExpression > TSAnyKeyword",
          message:
            "`.rpc('fn' as any)` hides Supabase schema drift. Regenerate database.generated.ts instead."
        },
        {
          selector:
            "CallExpression[callee.property.name='rpc'] > TSAsExpression > TSNeverKeyword",
          message:
            "`.rpc('fn' as never)` hides Supabase schema drift. Regenerate database.generated.ts instead."
        },
        {
          selector:
            "MemberExpression[property.name='rpc'][object.type='TSAsExpression']",
          message:
            '`(supabase as any).rpc(...)` hides Supabase schema drift. Regenerate database.generated.ts instead.'
        },
        {
          selector:
            "CallExpression[callee.property.name='from'] > TSAsExpression > TSNeverKeyword",
          message:
            "`.from('table' as never)` hides Supabase schema drift. Regenerate database.generated.ts instead."
        }
      ]
    }
  },
  {
    // Server-rendered React in API routes (OG images) has no hydration.
    files: ['app/api/**/*.tsx'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['packages/ui-kit/**/*.ts', 'packages/ui-kit/**/*.tsx'],
    rules: {
      ...packageBaseRules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tacticus/app-core', '@tacticus/app-core/*'],
              message: 'packages/ui-kit must not depend on app-core'
            },
            {
              group: ['@/app/*'],
              message:
                'packages/ui-kit must remain app-agnostic; domain components stay under app/components/ui'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    ignores: ['packages/ui-kit/**'],
    rules: {
      ...packageBaseRules,
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  // Internal identifiers must not reach user-facing copy. Last block on purpose
  // so the package overrides above cannot switch it off.
  {
    files: [
      'app/**/*.ts',
      'app/**/*.tsx',
      'packages/**/*.ts',
      'packages/**/*.tsx',
      'apps/**/*.ts',
      'apps/**/*.tsx'
    ],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/__tests__/**',
      '**/__mocks__/**',
      '**/*.stories.ts',
      '**/*.stories.tsx',
      '**/e2e/**',
      '**/fixtures/**'
    ],
    plugins: { tacticus: tacticusRules },
    rules: {
      'tacticus/no-internal-identifier-in-ui': [
        'error',
        { allowedFiles: internalIdentifierAllowedFiles }
      ],
      'tacticus/no-blanket-identifier-disable': 'error'
    }
  },
  // Legacy UI trees: exempt per rule, not globally, so the identifier guardrail still runs.
  {
    files: [
      'app/components/ui/**/*.{ts,tsx}',
      'app/components/playerstats/**/*.{ts,tsx}',
      'app/components/error/**/*.{ts,tsx}',
      'app/components/visualizations/**/*.{ts,tsx}',
      'app/components/votlw/**/*.{ts,tsx}',
      'app/components/discord/**/*.{ts,tsx}',
      'app/components/validation/**/*.{ts,tsx}',
      'app/hooks/**/*.{ts,tsx}'
    ],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-restricted-syntax': 'off',
      'react/no-array-index-key': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  },
  {
    ignores: [
      '.claude/**',
      '.local-backups/**',
      '.tmp/**',
      'worktrees/**',
      '**/worktrees/**',
      '.worktrees/**',
      '**/.worktrees/**',
      '.next/**',
      '**/.next/**',
      'coverage/**',
      '**/coverage/**',
      'node_modules/**',
      '**/node_modules/**',
      'out/**',
      'build/**',
      'playwright-report/**',
      '**/playwright-report/**',
      'storybook-static/**',
      'test-results/**',
      '**/test-results/**',
      'config/test-results/**',
      '*.config.js',
      '*.config.ts',
      'scripts/**',
      'docs/**',
      'tests/coverage/**',
      'reference/**',
      'supabase/**',
      'tests/**',
      'types/**',
      'packages/**/node_modules/**',
      // No app code here: a flat-config global ignore hides it from every rule,
      // including the identifier guardrail. Use a rule-scoped exemption.
      'next-env.d.ts'
    ]
  },
  ...storybookConfigs
]

export default eslintConfig
