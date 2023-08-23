Ever wanted to save some text for later use, or throw some info over from one of your computers to another?
This extension 'snips' text from pages you visit (or you can create them manually) and saves them in your browser's Sync storage.
Use the pop-out button for easier organization of your snippets!

This extension aims to become fully backup compatible with the Clippings extension for Firefox.
The 0.9 release provides all basic features required to be a good snipper and preserves all restored data from any clippings backup.
Additionally, more settings and control over your how your snippets are displayed have been added and the save engine rewritten to be more robust.

Roadmap:

0.9.3 -> Add shortcut keys, more colour and more sortation options.

1.0 -> Add variable support for things like current dates & times, locales, etc..

1.1 -> Support for multiple "spaces" to better organize snippets when doing different types of work.

Changelog:

0.9.2 -> Many under the hood updates to improve efficiency and fix issues with iframes
- Implimented browser compression to add up to 8x more space for synced snippets
- Added permissions request when a page is using cross-origin iframes and the extension is blocked
- Updated copy/paste code to be simpler and more robust, supporting more sites' input editors
- Updated code to make use of newer v3 extension features
- Fixed an issue when running out of space in sync storage
- Fixed an issue where ampersands would not appear in the paste menu
- Fixed an issue where the extention would forget whether to sync or not

0.9.1 -> Removed unnecessary permissions from updated manifest
- all site permissions were required for iframes, but not necessary for most sites and adds a scary warning

0.9 -> Manifest v3 rewrite
- Updated manifest and all componets to the v3 model
- Rewrote the storage functionality to allow switching storage locations (click the sync button to turn on or off)
- Updated save logic to handle larger amounts of data
- Added view options:
  - Remember last folder (always open popup to last location)
  - Show source URLs (display source field under content)
- Added sort option:
  - Group folders at top (lock or unlock folder grouping)
- Added control option:
  - Save source URLs (save URL of page along with snipped selection)
- Added clear data option
- Added snippet menu (click folder/quote icon)
  - Colour selection (may be updated in future)
  - Sort buttons as alternative to dragging

0.8.3 -> Initial public release
- Basic snip (save selection as note) functionality
- Snippet folder management
- Backup/restore functionality supporting Clippings v6 backups
