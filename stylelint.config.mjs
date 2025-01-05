/** @type {import('stylelint').Config} */
export default {
  extends: [
    'stylelint-config-standard',
    'stylelint-config-clean-order/error',
  ],
  rules: {
    'no-descending-specificity': null,
    'color-no-hex': true,
    'alpha-value-notation': 'number',
    'hue-degree-notation': 'number',
  },
}
