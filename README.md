# Entity Atlas — a Home Assistant add-on

A dense, intuitive database view of every entity in your Home Assistant,
joined with its device, area, floor, integration, and live state. Edit
friendly names, assign rooms/floors, rename devices, and keep your own
per-entity comments — all changes reflect back into Home Assistant
wherever HA supports it.

## Install

1. In Home Assistant, open **Settings → Add-ons → Add-on Store**.
2. Click the three-dot menu (top-right) → **Repositories**.
3. Add the URL of the repo that contains this folder.
4. Find **Entity Atlas** in the store, install it, and start it.
5. Click **Open Web UI** — it runs inside Home Assistant via Ingress,
   so no extra ports, passwords, or tokens are required.

## What it does

- Reads the **entity registry**, **device registry**, **area registry**,
  **floor registry**, and live **states** from HA over the Supervisor
  WebSocket proxy.
- Joins everything into one searchable, sortable, filterable table with
  columns for:
  - entity_id, friendly name, state, domain, device class
  - device (with manufacturer / model / hw & sw version / via_device)
  - area, floor, integration/platform, config entry
  - disabled, hidden, labels, unique_id
  - **Comment** (free-form, stored locally in the add-on)
- Writes back to Home Assistant whenever possible:
  - rename an entity's friendly name → `config/entity_registry/update`
  - move an entity to another area → `config/entity_registry/update`
  - rename a device (`name_by_user`) → `config/device_registry/update`
  - move a device to another area → `config/device_registry/update`
- Stores comments in a small SQLite DB at
  `/data/entity_atlas.db` (persists across add-on restarts and updates).
- Export everything to CSV or JSON with one click.

## Architecture

```
Home Assistant  ─── WebSocket ───┐
                                 │
   (Supervisor token, injected   │
    into the add-on container)   │
                                 ▼
                   ┌────────────────────────────┐
                   │   aiohttp app (Python)     │
                   │   - WS client to HA        │
                   │   - SQLite for comments    │
                   │   - Serves static UI       │
                   └────────────────────────────┘
                                 ▲
                   Ingress (172.30.32.2 only)
                                 │
                   Browser running the Atlas UI
```

The add-on uses the `SUPERVISOR_TOKEN` that Home Assistant injects into
every add-on container — no long-lived access tokens to configure.

