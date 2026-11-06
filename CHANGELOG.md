# Changelog

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
