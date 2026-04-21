"""
Entity Atlas — Home Assistant add-on backend.

Connects to Home Assistant Core's WebSocket API via the Supervisor proxy
(`ws://supervisor/core/websocket`) using the SUPERVISOR_TOKEN that the
Supervisor injects into every add-on container. Exposes a small JSON API
for the bundled web UI and serves the static assets on port 8099 (ingress).

Entities, devices, areas and floors are read live from HA. Comments are
kept in a local SQLite DB because HA has no native concept of per-entity
notes; everything else (friendly name, area assignment, device rename,
floor-via-area) writes back to HA through the registry update commands.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web
import re
import websockets

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

LOG = logging.getLogger("entity_atlas")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    stream=sys.stdout,
)

# Injected by the Supervisor into every add-on container.
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN")

# The Supervisor proxies HA Core for us at this host.
HA_WS_URL = "ws://supervisor/core/websocket"

# Where the UI lives and where we listen for ingress.
STATIC_DIR = Path("/app/static")
LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 8099

# SQLite path — /data is persistent across add-on updates.
DB_PATH = Path("/data/entity_atlas.db")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_OBJECT_ID_RE = re.compile(r"^[a-z0-9_]+$")


def _is_valid_object_id(s: str) -> bool:
    """HA entity object_ids must be lowercase letters, digits, underscores."""
    return bool(_OBJECT_ID_RE.fullmatch(s)) and not s.startswith("_") and not s.endswith("_")


# ---------------------------------------------------------------------------
# SQLite (comments only — everything else is HA-authoritative)
# ---------------------------------------------------------------------------


def db_connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS comments (
            entity_id TEXT PRIMARY KEY,
            comment   TEXT NOT NULL DEFAULT '',
            updated   TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            key     TEXT PRIMARY KEY,
            value   TEXT NOT NULL DEFAULT '',
            updated TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.commit()
    return conn


def db_get_note(key: str) -> str:
    with db_connect() as c:
        row = c.execute("SELECT value FROM notes WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else ""


def db_set_note(key: str, value: str) -> None:
    with db_connect() as c:
        c.execute(
            """
            INSERT INTO notes(key, value, updated)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE
                SET value = excluded.value,
                    updated = excluded.updated
            """,
            (key, value),
        )
        c.commit()


def db_get_comments() -> dict[str, str]:
    with db_connect() as c:
        rows = c.execute("SELECT entity_id, comment FROM comments").fetchall()
    return {r["entity_id"]: r["comment"] for r in rows}


def db_set_comment(entity_id: str, comment: str) -> None:
    with db_connect() as c:
        c.execute(
            """
            INSERT INTO comments(entity_id, comment, updated)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(entity_id) DO UPDATE
                SET comment = excluded.comment,
                    updated = excluded.updated
            """,
            (entity_id, comment),
        )
        c.commit()


def db_rename_comment(old_entity_id: str, new_entity_id: str) -> None:
    """Move a comment row when HA renames an entity_id, so the note
    stays attached. If the destination already has a comment, leave it
    alone (last-write-wins is scarier than leaving the rename as-is)."""
    if old_entity_id == new_entity_id:
        return
    with db_connect() as c:
        existing_new = c.execute(
            "SELECT 1 FROM comments WHERE entity_id = ?", (new_entity_id,)
        ).fetchone()
        if existing_new is not None:
            LOG.warning(
                "Not migrating comment for %s → %s: destination already has a comment",
                old_entity_id, new_entity_id,
            )
            return
        c.execute(
            "UPDATE comments SET entity_id = ? WHERE entity_id = ?",
            (new_entity_id, old_entity_id),
        )
        c.commit()


# ---------------------------------------------------------------------------
# Home Assistant WebSocket client
# ---------------------------------------------------------------------------


class HAClient:
    """A tiny, reconnecting Home Assistant WebSocket client.

    All public methods are coroutines and serialize through a single
    outgoing lock so that message-id accounting stays sane.
    """

    def __init__(self, url: str, token: str) -> None:
        self._url = url
        self._token = token
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._msg_id = 0
        self._lock = asyncio.Lock()

    async def _ensure(self) -> websockets.WebSocketClientProtocol:
        if self._ws is not None and not self._ws.closed:
            return self._ws

        LOG.info("Connecting to Home Assistant at %s", self._url)
        ws = await websockets.connect(self._url, max_size=64 * 1024 * 1024)

        # auth handshake
        hello = json.loads(await ws.recv())
        if hello.get("type") != "auth_required":
            raise RuntimeError(f"Unexpected first frame: {hello}")

        await ws.send(json.dumps({"type": "auth", "access_token": self._token}))
        result = json.loads(await ws.recv())
        if result.get("type") != "auth_ok":
            raise RuntimeError(f"HA auth failed: {result}")

        LOG.info("Authenticated with Home Assistant (version=%s)", result.get("ha_version"))
        self._ws = ws
        self._msg_id = 0
        return ws

    async def call(self, msg_type: str, **payload: Any) -> Any:
        """Send one command and await its result."""
        async with self._lock:
            ws = await self._ensure()
            self._msg_id += 1
            msg_id = self._msg_id
            frame = {"id": msg_id, "type": msg_type, **payload}
            await ws.send(json.dumps(frame))

            # Responses are not guaranteed in order, but because we hold
            # the lock for one call at a time, the next "result" frame
            # with our id is ours.
            while True:
                raw = await ws.recv()
                reply = json.loads(raw)
                if reply.get("id") != msg_id:
                    # Out-of-band message (event subscription we didn't make, etc.) — ignore.
                    continue
                if reply.get("type") != "result":
                    continue
                if not reply.get("success"):
                    err = reply.get("error", {})
                    raise RuntimeError(
                        f"HA error on {msg_type}: {err.get('code')}: {err.get('message')}"
                    )
                return reply.get("result")

    # Convenience wrappers -------------------------------------------------

    async def list_entities(self) -> list[dict]:
        return await self.call("config/entity_registry/list")

    async def list_devices(self) -> list[dict]:
        return await self.call("config/device_registry/list")

    async def list_areas(self) -> list[dict]:
        return await self.call("config/area_registry/list")

    async def list_floors(self) -> list[dict]:
        try:
            return await self.call("config/floor_registry/list")
        except RuntimeError as exc:
            # Older HA versions do not have floors.
            LOG.warning("floor_registry/list failed: %s", exc)
            return []

    async def get_states(self) -> list[dict]:
        return await self.call("get_states")

    async def update_entity(self, entity_id: str, **fields: Any) -> dict:
        """Update entity registry fields. Accepts name, area_id, hidden_by, etc."""
        return await self.call(
            "config/entity_registry/update",
            entity_id=entity_id,
            **fields,
        )

    async def update_device(self, device_id: str, **fields: Any) -> dict:
        return await self.call(
            "config/device_registry/update",
            device_id=device_id,
            **fields,
        )


# ---------------------------------------------------------------------------
# Joining + serialization
# ---------------------------------------------------------------------------


def build_rows(
    entities: list[dict],
    devices: list[dict],
    areas: list[dict],
    floors: list[dict],
    states: list[dict],
    comments: dict[str, str],
) -> list[dict]:
    """Join all registries into a flat list of rows for the UI."""

    dev_by_id = {d["id"]: d for d in devices}
    area_by_id = {a["area_id"]: a for a in areas}
    floor_by_id = {f["floor_id"]: f for f in floors}
    state_by_id = {s["entity_id"]: s for s in states}

    rows: list[dict] = []
    for e in entities:
        entity_id = e["entity_id"]
        device = dev_by_id.get(e.get("device_id")) if e.get("device_id") else None

        # Effective area: entity override wins; otherwise fall back to device's area.
        area_id = e.get("area_id") or (device.get("area_id") if device else None)
        area = area_by_id.get(area_id) if area_id else None
        floor = floor_by_id.get(area.get("floor_id")) if area and area.get("floor_id") else None

        state = state_by_id.get(entity_id) or {}
        attrs = state.get("attributes", {}) or {}

        # Friendly name precedence: entity.name (user override) → state attribute → original name.
        friendly = (
            e.get("name")
            or attrs.get("friendly_name")
            or e.get("original_name")
            or entity_id
        )

        domain, object_id = entity_id.split(".", 1) if "." in entity_id else (entity_id, "")

        rows.append(
            {
                "entity_id": entity_id,
                "object_id": object_id,
                "friendly_name": friendly,
                "state": state.get("state"),
                "unit": attrs.get("unit_of_measurement"),
                "domain": domain,
                "device_class": attrs.get("device_class") or e.get("device_class"),

                # Device
                "device_id": e.get("device_id"),
                "device_name": (device.get("name_by_user") or device.get("name")) if device else None,
                "manufacturer": device.get("manufacturer") if device else None,
                "model": device.get("model") if device else None,
                "hw_version": device.get("hw_version") if device else None,
                "sw_version": device.get("sw_version") if device else None,
                "via_device_id": device.get("via_device_id") if device else None,

                # Area & floor
                "area_id": area_id,
                "area_name": area.get("name") if area else None,
                "floor_id": floor.get("floor_id") if floor else None,
                "floor_name": floor.get("name") if floor else None,

                # Registry bits
                "platform": e.get("platform"),
                "config_entry_id": e.get("config_entry_id"),
                "unique_id": e.get("unique_id"),
                "disabled_by": e.get("disabled_by"),
                "hidden_by": e.get("hidden_by"),
                "entity_category": e.get("entity_category"),
                "labels": e.get("labels") or [],
                "icon": e.get("icon") or attrs.get("icon"),

                # Local-only
                "comment": comments.get(entity_id, ""),
            }
        )

    # Stable ordering: by domain then entity_id.
    rows.sort(key=lambda r: (r["domain"], r["entity_id"]))
    return rows


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------


def make_app(ha: HAClient) -> web.Application:
    app = web.Application(client_max_size=4 * 1024 * 1024)

    # --- API ---------------------------------------------------------------

    async def api_data(_req: web.Request) -> web.Response:
        """Full dump: entities + devices + areas + floors + states + comments."""
        try:
            entities, devices, areas, floors, states = await asyncio.gather(
                ha.list_entities(),
                ha.list_devices(),
                ha.list_areas(),
                ha.list_floors(),
                ha.get_states(),
            )
        except Exception as exc:
            LOG.exception("Failed to load HA data")
            return web.json_response({"error": str(exc)}, status=502)

        comments = db_get_comments()
        rows = build_rows(entities, devices, areas, floors, states, comments)

        return web.json_response(
            {
                "rows": rows,
                "areas": areas,
                "floors": floors,
                "counts": {
                    "entities": len(entities),
                    "devices": len(devices),
                    "areas": len(areas),
                    "floors": len(floors),
                },
            }
        )

    async def api_update_entity(req: web.Request) -> web.Response:
        """Update entity-registry fields (name, area_id, entity_id) and/or local comment."""
        try:
            body = await req.json()
        except Exception:
            return web.json_response({"error": "invalid JSON"}, status=400)

        entity_id = body.get("entity_id")
        if not entity_id or not isinstance(entity_id, str):
            return web.json_response({"error": "entity_id required"}, status=400)

        # Local-only field
        if "comment" in body:
            db_set_comment(entity_id, body["comment"] or "")

        # Fields that get forwarded to HA. We only forward keys the user
        # actually sent, to avoid clobbering things like `name` with null.
        ha_fields: dict[str, Any] = {}
        if "friendly_name" in body:
            # HA stores the user-override in `name`; null clears it and
            # falls back to the integration's original_name.
            val = body["friendly_name"]
            ha_fields["name"] = val if val else None
        if "area_id" in body:
            ha_fields["area_id"] = body["area_id"] or None
        if "icon" in body:
            ha_fields["icon"] = body["icon"] or None
        if "hidden" in body:
            ha_fields["hidden_by"] = "user" if body["hidden"] else None
        if "disabled" in body:
            ha_fields["disabled_by"] = "user" if body["disabled"] else None
        if "labels" in body and isinstance(body["labels"], list):
            ha_fields["labels"] = body["labels"]

        # Rename entity_id: the UI sends just the object_id (part after
        # the dot); we keep the original domain to avoid cross-domain
        # renames (which HA disallows anyway and would be a foot-gun).
        new_entity_id: str | None = None
        if "object_id" in body:
            new_object_id = (body["object_id"] or "").strip()
            if not new_object_id:
                return web.json_response(
                    {"error": "object_id cannot be empty"}, status=400
                )
            # HA accepts only lowercase ascii + digits + underscores.
            if not _is_valid_object_id(new_object_id):
                return web.json_response(
                    {"error": "object_id must be lowercase a–z, 0–9 and underscores only"},
                    status=400,
                )
            domain = entity_id.split(".", 1)[0]
            candidate = f"{domain}.{new_object_id}"
            if candidate != entity_id:
                ha_fields["new_entity_id"] = candidate
                new_entity_id = candidate

        updated = None
        if ha_fields:
            try:
                updated = await ha.update_entity(entity_id, **ha_fields)
            except Exception as exc:
                LOG.exception("HA update_entity failed")
                return web.json_response({"error": str(exc)}, status=502)

            # If the rename succeeded, migrate the local comment too so
            # it stays attached to the entity under its new id.
            if new_entity_id:
                db_rename_comment(entity_id, new_entity_id)

        return web.json_response({"ok": True, "entity": updated})

    async def api_update_device(req: web.Request) -> web.Response:
        """Update device-registry fields (name_by_user, area_id)."""
        try:
            body = await req.json()
        except Exception:
            return web.json_response({"error": "invalid JSON"}, status=400)

        device_id = body.get("device_id")
        if not device_id:
            return web.json_response({"error": "device_id required"}, status=400)

        ha_fields: dict[str, Any] = {}
        if "device_name" in body:
            ha_fields["name_by_user"] = body["device_name"] or None
        if "area_id" in body:
            ha_fields["area_id"] = body["area_id"] or None

        if not ha_fields:
            return web.json_response({"ok": True})

        try:
            updated = await ha.update_device(device_id, **ha_fields)
        except Exception as exc:
            LOG.exception("HA update_device failed")
            return web.json_response({"error": str(exc)}, status=502)

        return web.json_response({"ok": True, "device": updated})

    app.router.add_get("/api/data", api_data)
    app.router.add_post("/api/entity", api_update_entity)
    app.router.add_post("/api/device", api_update_device)

    # --- Free-form notes (description of naming scheme etc.) -------------

    async def api_get_notes(_req: web.Request) -> web.Response:
        return web.json_response({"readme": db_get_note("readme")})

    async def api_set_notes(req: web.Request) -> web.Response:
        try:
            body = await req.json()
        except Exception:
            return web.json_response({"error": "invalid JSON"}, status=400)
        if "readme" not in body or not isinstance(body["readme"], str):
            return web.json_response({"error": "readme (string) required"}, status=400)
        # Sanity cap — nobody should paste a novel in here.
        if len(body["readme"]) > 64_000:
            return web.json_response({"error": "note too long (64kB max)"}, status=400)
        db_set_note("readme", body["readme"])
        return web.json_response({"ok": True})

    app.router.add_get("/api/notes", api_get_notes)
    app.router.add_post("/api/notes", api_set_notes)

    # --- Static UI ---------------------------------------------------------

    async def index(_req: web.Request) -> web.Response:
        return web.FileResponse(STATIC_DIR / "index.html")

    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC_DIR, show_index=False)

    return app


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> None:
    if not SUPERVISOR_TOKEN:
        LOG.error(
            "SUPERVISOR_TOKEN not set — this add-on must be run inside "
            "Home Assistant Supervisor."
        )
        sys.exit(1)

    ha = HAClient(HA_WS_URL, SUPERVISOR_TOKEN)
    # Probe the connection up front so config errors surface immediately.
    try:
        await ha.call("get_config")
        LOG.info("Home Assistant connection OK")
    except Exception:
        LOG.exception("Initial connection to Home Assistant failed; continuing anyway")

    app = make_app(ha)

    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, LISTEN_HOST, LISTEN_PORT)
    await site.start()

    LOG.info("Entity Atlas listening on %s:%s (ingress)", LISTEN_HOST, LISTEN_PORT)
    # Block forever.
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
