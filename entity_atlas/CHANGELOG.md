# Changelog

## 1.0.6

- New **Naming scheme &amp; notes** panel between the filter bar and the
  table. Collapsible, with an Edit/Save/Cancel flow and a small safe
  Markdown renderer (headings, lists, `code`, fenced blocks, bold,
  italic, links, horizontal rules).
- `Ctrl`/`⌘`+`S` saves, `Esc` cancels while editing.
- Notes are persisted in the add-on's SQLite DB alongside the per-entity
  comments (`/data/entity_atlas.db`).
  
## 1.0.4/1.0.5

- Cap the visible width of the manufacturer / area / floor / device
  dropdowns on laptop-sized screens, so long device names no longer
  push the filter row past the right edge. The full names still appear
  when the dropdown is opened.

## 1.0.3

- Removed the entity dropdown filter — the search box already does that
  job more ergonomically.
- Made the top bar and filter strip responsive. On phones the layout
  stacks vertically, the domain chips scroll horizontally as a single
  row, and the selects drop into a tidy 2-column grid, so nothing ever
  sits off-screen.
  
## 1.0.2

- Edit the `entity_id` inline — only the part after the dot is editable,
  the domain prefix is locked (HA disallows cross-domain renames).
- Comments follow an entity across `entity_id` renames.
- New **device** filter dropdown (shows every device by name).
- New **entity** filter dropdown (pick a single entity from the list).
- Live-validates object_id input to HA's rules (lowercase a–z, 0–9, _).

## 1.0.0 — Initial release

- Dense, editable table of every Home Assistant entity
- Joins entity registry, device registry, area registry, floor registry,
  and live states into one view
- Inline editing for friendly name, area, and device name — writes back
  to Home Assistant via the WebSocket registry update APIs
- Free-form per-entity comments stored locally in SQLite
- Search, domain chips, area/floor/manufacturer filters, CSV export
- Ingress panel with no extra tokens required
