import globals from "globals";
import pluginJs from "@eslint/js";
import pluginJsdoc from "eslint-plugin-jsdoc";


export default [
  pluginJs.configs.recommended,
  pluginJsdoc.configs["flat/recommended"],
  {
    files: ["/service_worker.js"],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    plugins: {
      pluginJs,
      pluginJsdoc,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      "no-constant-binary-expression": "off",
      "semi": ["warn", "always"],
      "comma-dangle": ["warn", "always-multiline"],
      "object-curly-spacing": ["warn", "always"],
      "array-bracket-spacing": ["warn", "never"],
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
      "jsdoc/multiline-blocks": ["warn", { "noZeroLineText": false }],
      "jsdoc/require-returns": "off",
    },
  },
];