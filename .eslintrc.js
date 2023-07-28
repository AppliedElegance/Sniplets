module.exports = {
  "env": {
    "browser": true,
    "webextensions": true,
    "worker": true,
    "node": true,
    "es2021": true
  },
  "extends": "eslint:recommended",
  "rules": {
    "indent": [
      "error",
      2,
      {
        "ignoredNodes": ["ConditionalExpression"],
        "VariableDeclarator": "first",
      }
    ],
  },
  "globals": {
    "init": "readonly",
    "Space": "readonly",
    "Folder": "readonly",
    "Snippet": "readonly",
    "Settings": "readonly",
    "getStorageData": "readonly",
    "setStorageData": "readonly",
    "removeStorageData": "readonly",
    "buildContextMenus": "readonly",
    "saveToFile": "readonly",
  },
};
