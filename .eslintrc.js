module.exports = {
    "env": {
        "browser": true,
        "webextensions": true,
        "worker": true,
        "es2024": true,
    },
    "extends": "eslint:recommended",
    "overrides": [
        {
            "env": {
                "node": true,
            },
            "files": [
                ".eslintrc.{js,cjs}",
            ],
            "parserOptions": {
                "sourceType": "script",
            },
        },
    ],
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module",
    },
    "rules": {
        "semi": [1, "always"],
        "comma-dangle": [1, "always-multiline"],
        "prefer-const": "error",
        "no-var": "error",
        "no-object-constructor": "error",
        "prefer-object-spread": "error",
        "no-array-constructor": "error",
        "array-callback-return": "error",
        "prefer-destructuring": ["error", {"object": true, "array": false}],
        "prefer-template": "error",
        "no-eval": "error",
        "no-loop-func": "error",
        "prefer-rest-params": "error",
        "default-param-last": "error",
        "no-new-func": "error",
        //"no-param-reassign": "error",
        "prefer-arrow-callback": "error",
        "arrow-body-style": "error",
        "require-await": "error",
        "prefer-promise-reject-errors": "error",
        "no-promise-executor-return": "error",
    },
    "globals": {
        "colors": false,
        "getColor": false,
        "i18n": false,
        "uiLocale": false,
        "i18nNum": false,
        "i18nOrd": false,
        "getCurrentTab": false,
        "openWindow": false,
        "openPanel": false,
        "openForEditing": false,
        "getStorageData": false,
        "setStorageData": false,
        "removeStorageData": false,
        "getCurrentSpace": false,
        "setFollowup": false,
        "fetchFollowup": false,
        "handleFollowup": false,
        "setClipboard": false,
        "isScriptingBlocked": false,
        "injectScript": false,
        "sendCommand": false,
        "injectSnipper": false,
        "getSnip": false,
        "snipSelection": false,
        "insertSnip": false,
        "pasteSnip": false,
        "getRichText": false,
        "TreeItem": false,
        "Folder": false,
        "Sniplet": false,
        "DataBucket": false,
        "Space": false,
        "Settings": false,
        "buildContextMenus": false,
        "buildNode": false,
        "buildSvg": false,
        "setSvgSprite": false,
        "setSvgFill": false,
        "buildPopoverMenu": false,
        "buildMenuItem": false,
        "buildMenuControl": false,
        "buildMenuSeparator": false,
        "buildSubMenu": false,
        "buildActionIcon": false,
        "buildItemWidget": false,
        "buildTreeWidget": false,
        "showModal": false,
        "showAbout": false,
        "showAlert": false,
        "confirmAction": false,
        "confirmSelection": false,
        "mergeCustomFields": false,
        "requestOrigins": false,
    },
};
