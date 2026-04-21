# Entity Atlas

A dense, editable spreadsheet view of every entity in Home Assistant.

## Columns

| Column | Editable | Saved to |
| --- | --- | --- |
| `entity_id` | — | — |
| friendly name | ✓ | HA entity registry (`name`) |
| state | — | — |
| domain | — | — |
| room (area) | ✓ | HA entity registry (`area_id`) |
| floor | — (follows area) | — |
| device | ✓ | HA device registry (`name_by_user`) |
| brand / model / hw / sw | — | — |
| **comment** | ✓ | **Local DB** (`/data/entity_atlas.db`) |
| device_class, unit, integration, unique_id, labels, … | — | — |

Hidden columns are available via the **Columns** button.

## Editing

Double-click any editable cell. `Enter` saves, `Esc` cancels. Edits to
friendly names, areas, and device names round-trip into the Home
Assistant registries immediately — they show up in the HA UI the next
time you open a device or entity page.

Comments are stored locally by the add-on because HA has no native
per-entity notes field. They survive add-on restarts and updates.

## Keyboard

- `/` — focus the search box
- `Enter` — save an in-progress edit
- `Esc` — cancel an edit

## Filtering

Combine the free-text search with the domain chips, area / floor /
manufacturer dropdowns, and the "unassigned only" toggle to quickly
answer questions like:

- "Which sensors have no area yet?"
- "Every Shelly device and what room it's in"
- "All `binary_sensor` entities on the ground floor"

## Export

The **Export CSV** button downloads the currently-filtered view with
the currently-visible columns. Good for audits or dropping into a
spreadsheet.
