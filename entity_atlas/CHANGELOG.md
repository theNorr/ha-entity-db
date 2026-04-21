# Changelog

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
