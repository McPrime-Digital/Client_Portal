import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'scratch/**',
      // Ad-hoc one-off scripts at repo root (see CLAUDE.md), not part of the app.
      'test-*.ts',
      'fix-schema.ts',
      'update_components.py',
    ],
  },
]

export default eslintConfig
