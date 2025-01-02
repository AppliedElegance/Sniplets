# Sniplets Changelog

> [!NOTE]
> This extension was known as Snippets up to v0.10.3

## v0.11.0

> [!NOTE]
> Special thanks again to [Naomi Wu](https://github.com/MachineryEnchantress) for sponsoring this release
</>
> Side panel support and many related features, as well as an automatic dark mode theme

- Converted code to native modules now it's supported for web workers
- Cleaned up icons
- Added Side Panel and related options
- Added more colours
- Added dark mode
- Added support for more editors
- Added support for frames when not using the context menu
- Added option to collapse editors fully
- Added support for the new Clippings v7 `$[CLIPPING(Name)]` tag
- Added success messages
- Enhanced error handling

## v0.10.4 (2024-05-13)

> Fixed sync error when clearing all data

- Moved synced data recovery from back to front-end since store-deployed extensions handle clearing data in parallel, resulting in a race condition not seen in a test environment
- Changed name from Snippets to Sniplets for easier searching on the Chrome Web Store and to avoid confusing it with [the Chrome DevTools Snippets feature](https://developer.chrome.com/docs/devtools/javascript/snippets/)

## v0.10.3 (2024-05-10)

> [!NOTE]
> Special thanks to [Naomi Wu](https://github.com/MachineryEnchantress) for sponsoring this release
</>
> Enhanced Clippings import & preliminary keyboard shortcut support (0.10.2 skipped due to upload error)

- Added compression toggle in case of issues on certain platforms (try toggling off if paste commands don't work)
- Added preliminary support for including html tags when snipping
- Added CKEditor support for pasting
- Added Alt+Shift+C keyboard shortcut for snipping (may not work in embedded pages)
- Added Alt+Shift+X keyboard shortcut for opening the Snippets manager
- Added view option to disable the maximum editor size when not editing
- Added an about page
- Enhanced sync behaviour when working in multiple windows/workstations
- Enhanced confirmation and alert windows
- Rearranged and clarified items in the Settings menu
- Moved all text to i18n file for future translation efforts
- Cleaned up some background errors and made them more visible in case of known limitations
- Fixed an issue with importing label colors from clippings
- Fixed an issue where settings were not imported from a full backup
- Fixed an issue where clearing all data needed to be done twice before it was visible
- Fixed an issue moving deeply nested items around

## v0.10.1 (2023-12-12)

> Custom placeholder support & major bugfix for context menus

- Implemented support for custom placeholders, `$[name]`, `$[name{default}]` and `$[name{select1|selectN...}]` all work as expected with the additional ability to add the input type in brackets a la `$[name(date)]` for a date picker; default values can be added after  la `$[name(time){12:00}]`
- Fixed a bug where editing snippets would cause the context menu to disappear until the browser is reloaded
- Fixed the back button to only go back to the last folder rather than root

## v0.10.0 (2023-12-06)

> Basic placeholder support along with many display updates and bugfixes

- Implemented clippings compatible placeholder substitution (counters & custom placeholders are still WIP)
- Implemented rich text formatting options
- Added the full current path in the menu bar, clipped to the available space
- Moved permissions requests to the main window to provide a smoother experience
- Tightened up the interface
- Fixed backup and restore code on Edge (a big bug in v0.9.3)
- Many more QOL changes under the hood

## v0.9.3 (2023-09-04)

> Display fix due to a chrome update that changes how flex containers are expanded

## v0.9.2 (2023-08-23)

> Many under the hood updates to improve efficiency and fix issues with iframes

- Implemented browser compression to add up to 8x more space for synced snippets
- Added permissions request when a page is using cross-origin iframes and the extension is blocked
- Updated copy/paste code to be simpler and more robust, supporting more sites' input editors
- Updated code to make use of newer v3 extension features
- Fixed an issue when running out of space in sync storage
- Fixed an issue where ampersands would not appear in the paste menu
- Fixed an issue where the extension would forget whether to sync or not

## v0.9.1 (2023-07-28)

> Removed unnecessary permissions from updated manifest

- all site permissions were required for iframes, but not necessary for most sites and adds a scary warning

## v0.9

> Manifest v3 rewrite

- Updated manifest and all components to the v3 model
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

## v0.8.3

> Initial public release

- Basic snip (save selection as note) functionality
- Snippet folder management
- Backup/restore functionality supporting Clippings v6 backups
