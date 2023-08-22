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
        "getStorageData": true,
        "setStorageData": true,
        "removeStorageData": true,
        "injectScript": true,
        "getFullSelection": true,
        "pasteSnippet": true,
        "requestFrames": true,
        "TreeItem": true,
        "Folder": true,
        "Snippet": true,
        "DataBucket": true,
        "Space": true,
        "Settings": true,
        "saveToFile": true,
        "buildContextMenus": true
    }
}
