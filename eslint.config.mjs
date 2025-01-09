import globals from 'globals'
import js from '@eslint/js'
import jsdoc from 'eslint-plugin-jsdoc'
import stylistic from '@stylistic/eslint-plugin'

export default [
  js.configs.recommended,
  jsdoc.configs['flat/recommended'],
  stylistic.configs.customize({
    braceStyle: '1tbs',
  }),
  {
    files: ['/service_worker.js'],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-destructuring': 'warn',
      'prefer-const': 'warn',
      'no-object-constructor': 'error',
      'prefer-object-spread': 'error',
      'no-array-constructor': 'error',
      'prefer-template': 'error',
      'no-eval': 'error',
      'no-loop-func': 'error',
      'prefer-rest-params': 'error',
      'default-param-last': 'warn',
      'no-new-func': 'error',
      'prefer-arrow-callback': 'error',
      'arrow-body-style': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-promise-executor-return': 'error',
      'grouped-accessor-pairs': ['error', 'getBeforeSet'],
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/multiline-blocks': ['warn', { noZeroLineText: false }],
      'jsdoc/no-undefined-types': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/check-tag-names': 'off',
    },
  },
]
