module.exports = {
    "env": {
        "browser": true,
        "webextensions": true,
        "worker": true,
        "es2024": true
    },
    "extends": "eslint:recommended",
    "overrides": [
        {
            "env": {
                "node": true
            },
            "files": [
                ".eslintrc.{js,cjs}"
            ],
            "parserOptions": {
                "sourceType": "script"
            }
        }
    ],
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    "globals": {
        "getStorageData": false,
        "setStorageData": false,
        "removeStorageData": false,
        "injectScript": false,
        "getFullSelection": false,
        "pasteSnippet": false,
        "requestFrames": false,
        "TreeItem": false,
        "Folder": false,
        "Snippet": false,
        "DataBucket": false,
        "Space": false,
        "Settings": false,
        "saveToFile": false,
        "buildContextMenus": false,
        "i18n": false,
    }
}
