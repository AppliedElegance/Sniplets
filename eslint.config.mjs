import globals from "globals";
import pluginJs from "@eslint/js";


export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "script",
    },
  },
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
      "no-var": "error",
      "prefer-const": "warn",
      // "no-object-constructor": "error",
      // "prefer-object-spread": "error",
      // "no-array-constructor": "error",
      // "array-callback-return": "error",
      // "prefer-destructuring": ["error", {"object": true, "array": false}],
      // "prefer-template": "error",
      // "no-eval": "error",
      // "no-loop-func": "error",
      // "prefer-rest-params": "error",
      // "default-param-last": "error",
      // "no-new-func": "error",
      // "no-param-reassign": "warn",
      // "prefer-arrow-callback": "error",
      // "arrow-body-style": "error",
      // "require-await": "error",
      // "prefer-promise-reject-errors": "error",
      // "no-promise-executor-return": "error",
    },
  },
];