# Instruments

What Epiphany can do besides, each installed or removed in Settings > Instruments. One folder each, its name the
instrument's (the Instruments row says it as it is). Nothing outside the folder names it.

- `page.js`: runs in the window once the library and settings are loaded, the app's scripts in reach (`items`, `F`,
  `s`, `api`, `$`...). Wrapped in a block (`{ ... }`) so its names stay its own: every script here shares one scope.
  It builds what it shows itself: a Settings page is a link appended to `#settings aside` and a `<div id="name">` in
  `#settings`, hidden while it is off.
- `page.css`: its styles, if any.

On or off: `s[name]` in settings.json, off until installed. Removed, an instrument shows nothing and does nothing; its
code is still loaded (it ships with the app).

What the window says, as events on `window`:
- `instrument`: one was installed or removed; `detail` is its name.
- `library`: the pictures, or what the filters let through, changed.

The app's own side (a `main.js`, for an instrument that needs Node or a window of its own) comes with the first
instrument that needs it.
