import globals from 'globals'
export default [
  {
    files: [
      'apps/desktop/platform/windows/*.{mjs,cjs,js}',
      'tests/desktop/windows/*.mjs'
    ],
    languageOptions: {
      ecmaVersion: 2024,
      globals: { ...globals.node, ...globals.browser }
    },
    rules: { 'no-unused-vars': 'error', 'no-undef': 'error' }
  }
]
