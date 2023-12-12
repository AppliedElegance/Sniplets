Ever wanted to save some text for later use, or throw some info over from one of your computers to another? This extension 'snips' text from pages you visit (or you can create them manually) and saves them in your browser's Sync storage. Use the pop-out button for easier organization of your snippets!

This extension aims to become fully backup compatible with the Clippings extension for Firefox. The 0.10 release is a major overhall from the previous release to be more secure, accessible and robust. 

Roadmap:

1.0 -> Add full counter support, implement shortcut keys

1.1 -> Support for multiple "spaces" to better organize snippets when doing different types of work.

1.2 -> Add external file sync option

Changelog:

0.10.1 -> Custom placeholder support & major bugfix for context menus
- Implemented support for custom placeholders, `$[name]`, `$[name{default}]` and `$[name{select1|selectn...}]` all work as expected with the additional ability to add the input type in brackets a la `$[name(date)]` for a date picker; default values can be added after  la `$[name(time){12:00}]`
- Fixed a bug where editing snippets would cause the context menu to disappear until the browser is reloaded
- Fixed the back button to only go back to the last folder rather than root

0.10.0 -> Basic placeholder support along with many display updates and bugfixes
- Implemented clippings compatible placeholder substitution (counters & custom placeholders are still WIP)
- Implemented rich text formatting options
- Added the full current path in the menu bar, clipped to the available space
- Moved permissions requests to the main window to provide a smoother experience
- Tightened up the interface
- Fixed backup and restore code on Edge (a big bug in v0.9.3)
- Many more QOL changes under the hood

0.9.3 -> Display fix due to a chrome update that changes how flex containers are expanded

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
