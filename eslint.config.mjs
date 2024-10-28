import globals from "globals";
import pluginJs from "@eslint/js";


export default [
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.worker,
      },
    },
  },
  pluginJs.configs.recommended,
  {
    rules: {
      "no-constant-binary-expression": "off",
      "semi": ["warn", "always"],
      "comma-dangle": ["warn", "always-multiline"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "no-var": "error",
      "prefer-const": "warn",
      "no-object-constructor": "error",
      "prefer-object-spread": "error",
      "no-array-constructor": "error",
      "prefer-template": "error",
      "no-eval": "error",
      "no-loop-func": "error",
      "prefer-rest-params": "error",
      "default-param-last": "error",
      "no-new-func": "error",
      "prefer-arrow-callback": "error",
      "arrow-body-style": "error",
      "prefer-promise-reject-errors": "error",
      "no-promise-executor-return": "error",
    },
  },
];