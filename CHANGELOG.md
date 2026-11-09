# Changelog

## 0.6.7

- Reload schedules and settings together when sync tools replace the plugin data file, and refresh both calendar and sidebar without restarting.
- Check for pulled data when returning to the app or opening a calendar; on mobile, check every 15 seconds while the app is visible and a calendar or overview is open.
- Add a command to reload schedules from disk. Remote reads never write the data back or regenerate daily notes.
- Preserve the current schedules and settings if a pulled file is missing, incomplete, or invalid; avoid rebuilding unchanged views.
- Add tests for external changes, Android lifecycle triggers, partial pulls, remote deletions, queued edits, and cleanup.

## 0.6.6

- Guard the Obsidian 1.8.7 language API with the official requireApiVersion check, resolving the community review error while retaining the 1.7.2 minimum version.
- Use the host Moment locale on older versions without calling the newer API, including when that export is unavailable.
- Add regression coverage for Obsidian 1.7.2, 1.8.6, and the 1.8.7 language API boundary.

## 0.6.5

- Follow Obsidian’s language setting throughout the calendar, sidebar, event dialogs, Markdown editor, settings, commands, and notices.
- Display Chinese for Chinese language settings and English for English or unsupported languages, including localized months, weekdays, and category labels.
- Localize generated daily-note schedule blocks while retaining their stable markers, configured paths, surrounding text, and user-entered event content.
- Retain compatibility with Obsidian 1.7.2 using the host Moment locale when the newer language API is unavailable.

## 0.6.4

- Generate and cryptographically verify GitHub build provenance attestations for all three release files.
- Replace important CSS declarations with scoped selectors, preserving calendar, drag, notes, and mobile styles.
- Make settings searchable on Obsidian 1.13 and later, with native setting headings on older versions.
- Validate stored data before use and leave existing files intact if a schedule cannot be read.
- Handle rejected promises with unknown error types, use cross-window pointer checks, and remove an unused import.

## 0.6.3

- Prepare public distribution as **Simple Days** with plugin ID `simple-days` and author ChenXiaoW.
- Add English and Chinese documentation, migration instructions, license, version compatibility metadata, and automated build/release checks.
- Set the minimum Obsidian version to 1.7.2 to match the awaited workspace leaf API.
- Keep the v0.6.2 schedule features and legacy daily-note markers and view identifiers.

## 0.6.2 (local prototype)

- Allow checking Markdown tasks in event details and save the change independently of event completion.
- Synchronize task changes to daily notes; restore failed changes and detect concurrent edits.

## 0.6.1 (local prototype)

- Add Markdown notes editing, previews, expanded editing, internal links, and formatted daily-note output.

## 0.6.0 (local prototype)

- Add multi-day timed and all-day events and desktop drag and drop across dates.
- Preserve event times and spans when moving, and update all affected daily notes.
