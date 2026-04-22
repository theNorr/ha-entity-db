/* =========================================================================
   Entity Atlas — client
   Talks to the addon's backend at the same origin (ingress-relative paths).
   ========================================================================= */

// Ingress-safe: always use relative URLs.
const API = {
  data:   'api/data',
  entity: 'api/entity',
  device: 'api/device',
  notes:  'api/notes',
};

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
//
//   key       : field on the row
//   label     : header text
//   kind      : 'text' | 'pill' | 'state' | 'mono' | 'comment' | 'list' | 'area' | 'friendly' | 'entity_id' | 'time' | 'actions'
//   editable  : how the cell saves — null | 'friendly' | 'area' | 'device_name' | 'comment' | 'object_id'
//   default   : visible by default
//   width     : initial CSS width hint
//
// "editable: 'friendly'"    means edits POST /api/entity with friendly_name.
// "editable: 'area'"        means edits POST /api/entity with area_id (dropdown).
// "editable: 'device_name'" means edits POST /api/device with device_name.
// "editable: 'comment'"     stays local (the backend stores it in SQLite).
// "editable: 'object_id'"   renames the entity_id in HA (domain stays fixed).

const COLS = [
  { key: 'entity_id',     label: 'entity_id',     kind: 'entity_id', editable: 'object_id',    default: true,  width: '260px' },
  { key: 'friendly_name', label: 'friendly name', kind: 'friendly',  editable: 'friendly',     default: true,  width: '220px' },
  { key: 'state',         label: 'state',         kind: 'state',     editable: null,           default: true,  width: '110px' },
  { key: 'last_changed',  label: 'last changed',  kind: 'time',      editable: null,           default: true,  width: '150px' },
  { key: 'domain',        label: 'domain',        kind: 'pill',      editable: null,           default: true,  width: '110px' },
  { key: 'area_name',     label: 'room (area)',   kind: 'area',      editable: 'area',         default: true,  width: '160px' },
  { key: 'floor_name',    label: 'floor',         kind: 'text',      editable: null,           default: true,  width: '120px' },
  { key: 'device_name',   label: 'device',        kind: 'text',      editable: 'device_name',  default: true,  width: '200px' },
  { key: 'manufacturer',  label: 'brand',         kind: 'text',      editable: null,           default: true,  width: '140px' },
  { key: 'model',         label: 'model',         kind: 'text',      editable: null,           default: true,  width: '160px' },
  { key: 'comment',       label: 'comment',       kind: 'comment',   editable: 'comment',      default: true,  width: '280px' },
  { key: 'actions',       label: '',              kind: 'actions',   editable: null,           default: true,  width: '140px' },
  { key: 'last_updated',  label: 'last updated',  kind: 'time',      editable: null,           default: false, width: '150px' },
  { key: 'device_class',  label: 'device class',  kind: 'text',      editable: null,           default: false, width: '120px' },
  { key: 'unit',          label: 'unit',          kind: 'mono',      editable: null,           default: false, width: '70px'  },
  { key: 'platform',      label: 'integration',   kind: 'mono',      editable: null,           default: false, width: '120px' },
  { key: 'hw_version',    label: 'hw',            kind: 'mono',      editable: null,           default: false, width: '90px'  },
  { key: 'sw_version',    label: 'sw',            kind: 'mono',      editable: null,           default: false, width: '90px'  },
  { key: 'device_id',     label: 'device_id',     kind: 'mono',      editable: null,           default: false, width: '200px' },
  { key: 'unique_id',     label: 'unique_id',     kind: 'mono',      editable: null,           default: false, width: '240px' },
  { key: 'labels',        label: 'labels',        kind: 'list',      editable: null,           default: false, width: '160px' },
  { key: 'entity_category', label: 'category',    kind: 'text',      editable: null,           default: false, width: '110px' },
  { key: 'disabled_by',   label: 'disabled',      kind: 'text',      editable: null,           default: false, width: '100px' },
  { key: 'hidden_by',     label: 'hidden',        kind: 'text',      editable: null,           default: false, width: '100px' },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  rows: [],                       // all rows from server
  areas: [],
  floors: [],
  filtered: [],                   // after search + filter
  sortKey: 'entity_id',
  sortDir: 1,                     // 1 | -1
  query: '',
  domain: '',
  area: '',
  floor: '',
  manufacturer: '',
  device: '',                     // device_id filter
  missingOnly: false,
  showHidden: false,              // include hidden_by != null
  showDisabled: false,            // include disabled_by != null
  visibleCols: new Set(COLS.filter(c => c.default).map(c => c.key)),
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
  wireStaticUI();
  wireNotes();
  loadNotes();
  await loadData();
  // Keep the "X min ago" strings fresh without redrawing the whole grid.
  setInterval(tickRelativeTimes, 30_000);
});

/**
 * Walks every .time cell in the grid and refreshes its text from the
 * ISO timestamp stored on its title attribute's twin (we stash the
 * original value on a data attribute to avoid re-parsing localized
 * strings).
 */
function tickRelativeTimes() {
  const spans = document.querySelectorAll('.grid .time[data-ts]');
  for (const s of spans) {
    const dt = new Date(Number(s.dataset.ts));
    if (!isNaN(dt.getTime())) s.textContent = relativeTime(dt);
  }
}

function wireStaticUI() {
  document.getElementById('btn-refresh').addEventListener('click', loadData);
  document.getElementById('btn-export').addEventListener('click', exportCsv);
  document.getElementById('btn-columns').addEventListener('click', toggleColumnsPopover);

  document.getElementById('q').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    applyFilters(); renderBody();
  });
  document.getElementById('f-area').addEventListener('change', (e) => {
    state.area = e.target.value; applyFilters(); renderBody();
  });
  document.getElementById('f-floor').addEventListener('change', (e) => {
    state.floor = e.target.value; applyFilters(); renderBody();
  });
  document.getElementById('f-mfr').addEventListener('change', (e) => {
    state.manufacturer = e.target.value; applyFilters(); renderBody();
  });
  document.getElementById('f-device').addEventListener('change', (e) => {
    state.device = e.target.value; applyFilters(); renderBody();
  });
  document.getElementById('f-missing').addEventListener('change', (e) => {
    state.missingOnly = e.target.checked; applyFilters(); renderBody();
  });
  document.getElementById('f-show-hidden').addEventListener('change', (e) => {
    state.showHidden = e.target.checked; applyFilters(); renderBody();
  });
  document.getElementById('f-show-disabled').addEventListener('change', (e) => {
    state.showDisabled = e.target.checked; applyFilters(); renderBody();
  });

  // '/' to focus search, Esc to clear
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
      e.preventDefault();
      document.getElementById('q').focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadData() {
  setStatus('Loading entities…');
  try {
    const r = await fetch(API.data);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    state.rows   = data.rows || [];
    state.areas  = data.areas || [];
    state.floors = data.floors || [];

    // Stats
    document.getElementById('c-entities').textContent = data.counts.entities;
    document.getElementById('c-devices').textContent  = data.counts.devices;
    document.getElementById('c-areas').textContent    = data.counts.areas;
    document.getElementById('c-floors').textContent   = data.counts.floors;

    buildDomainChips();
    buildSelects();
    renderHead();
    applyFilters();
    renderBody();
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('Failed to load data — is Home Assistant reachable?');
    toast('Load failed: ' + err.message, true);
  }
}

function setStatus(s) {
  const el = document.getElementById('grid-status');
  el.textContent = s;
  el.classList.toggle('hide', !s);
}

// ---------------------------------------------------------------------------
// Filters / selects / chips
// ---------------------------------------------------------------------------

function buildDomainChips() {
  const counts = new Map();
  for (const r of state.rows) counts.set(r.domain, (counts.get(r.domain) || 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const box = document.getElementById('domain-chips');
  box.innerHTML = '';
  const allChip = chip('all', '', state.domain === '');
  allChip.addEventListener('click', () => { state.domain = ''; refreshChips(); applyFilters(); renderBody(); });
  box.appendChild(allChip);

  for (const [d, n] of entries) {
    const c = chip(`${d} · ${n}`, d, state.domain === d);
    c.addEventListener('click', () => {
      state.domain = state.domain === d ? '' : d;
      refreshChips(); applyFilters(); renderBody();
    });
    box.appendChild(c);
  }
}
function refreshChips() {
  [...document.querySelectorAll('#domain-chips .chip')].forEach(c => {
    c.classList.toggle('active',
      (c.dataset.value || '') === state.domain);
  });
}
function chip(label, value, active) {
  const el = document.createElement('span');
  el.className = 'chip' + (active ? ' active' : '');
  el.textContent = label;
  el.dataset.value = value;
  return el;
}

function buildSelects() {
  const areaSel = document.getElementById('f-area');
  areaSel.innerHTML = '<option value="">all</option>' +
    state.areas
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(a => `<option value="${a.area_id}">${esc(a.name)}</option>`)
      .join('');

  const floorSel = document.getElementById('f-floor');
  floorSel.innerHTML = '<option value="">all</option>' +
    state.floors
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(f => `<option value="${f.floor_id}">${esc(f.name)}</option>`)
      .join('');

  const mfrs = [...new Set(state.rows.map(r => r.manufacturer).filter(Boolean))].sort();
  document.getElementById('f-mfr').innerHTML =
    '<option value="">all</option>' + mfrs.map(m => `<option>${esc(m)}</option>`).join('');

  // Device dropdown: unique device_id → best-known name, sorted by name.
  const deviceById = new Map();
  for (const r of state.rows) {
    if (!r.device_id) continue;
    if (!deviceById.has(r.device_id)) {
      deviceById.set(r.device_id, r.device_name || r.device_id);
    }
  }
  const devices = [...deviceById.entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  document.getElementById('f-device').innerHTML =
    '<option value="">all</option>' +
    devices.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
}

function applyFilters() {
  const q = state.query;
  const rows = state.rows.filter(r => {
    if (state.domain && r.domain !== state.domain) return false;
    if (state.area && r.area_id !== state.area) return false;
    if (state.floor && r.floor_id !== state.floor) return false;
    if (state.manufacturer && r.manufacturer !== state.manufacturer) return false;
    if (state.device && r.device_id !== state.device) return false;
    if (state.missingOnly && r.area_id) return false;
    // Hide hidden/disabled entities unless the user explicitly asks.
    if (!state.showHidden   && r.hidden_by)   return false;
    if (!state.showDisabled && r.disabled_by) return false;
    if (!q) return true;
    return (
      (r.entity_id     && r.entity_id.toLowerCase().includes(q)) ||
      (r.friendly_name && r.friendly_name.toLowerCase().includes(q)) ||
      (r.device_name   && r.device_name.toLowerCase().includes(q)) ||
      (r.manufacturer  && r.manufacturer.toLowerCase().includes(q)) ||
      (r.model         && r.model.toLowerCase().includes(q)) ||
      (r.area_name     && r.area_name.toLowerCase().includes(q)) ||
      (r.comment       && r.comment.toLowerCase().includes(q)) ||
      (r.unique_id     && r.unique_id.toLowerCase().includes(q))
    );
  });

  const k = state.sortKey, dir = state.sortDir;
  const isTimeKey = (k === 'last_changed' || k === 'last_updated');
  rows.sort((a, b) => {
    let av = a[k], bv = b[k];
    if (isTimeKey) {
      av = av ? new Date(av).getTime() : null;
      bv = bv ? new Date(bv).getTime() : null;
    }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (isTimeKey) return (av - bv) * dir;
    return (String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0) * dir;
  });

  state.filtered = rows;
}

// ---------------------------------------------------------------------------
// Grid rendering
// ---------------------------------------------------------------------------

function renderHead() {
  const tr = document.createElement('tr');
  for (const col of COLS) {
    if (!state.visibleCols.has(col.key)) continue;
    const th = document.createElement('th');
    th.textContent = col.label;
    th.style.minWidth = col.width;
    th.dataset.key = col.key;
    if (col.kind === 'actions') {
      th.classList.add('th--noSort');
      tr.appendChild(th);
      continue;
    }
    if (state.sortKey === col.key) {
      th.classList.add(state.sortDir === 1 ? 'sort-asc' : 'sort-desc');
    }
    th.addEventListener('click', () => {
      if (state.sortKey === col.key) state.sortDir *= -1;
      else { state.sortKey = col.key; state.sortDir = 1; }
      applyFilters(); renderHead(); renderBody();
    });
    tr.appendChild(th);
  }
  const head = document.getElementById('grid-head');
  head.innerHTML = '';
  head.appendChild(tr);
}

function renderBody() {
  const body = document.getElementById('grid-body');
  body.innerHTML = '';
  if (!state.filtered.length) {
    setStatus('No entities match.');
    return;
  }
  setStatus('');

  // Simple render of up to ~2000 rows — HA installs with >5000 entities
  // are rare; if we ever need to, this is where virtualization would go.
  const frag = document.createDocumentFragment();
  const cap = Math.min(state.filtered.length, 3000);
  for (let i = 0; i < cap; i++) {
    frag.appendChild(buildRow(state.filtered[i]));
  }
  body.appendChild(frag);

  if (state.filtered.length > cap) {
    const info = document.createElement('tr');
    info.innerHTML = `<td colspan="${state.visibleCols.size}" style="text-align:center;color:var(--text-faint);padding:10px">
      showing first ${cap} of ${state.filtered.length} — narrow your filter to see the rest
    </td>`;
    body.appendChild(info);
  }
}

function buildRow(row) {
  const tr = document.createElement('tr');
  tr.dataset.entityId = row.entity_id;
  if (row.hidden_by)   tr.classList.add('row-hidden');
  if (row.disabled_by) tr.classList.add('row-disabled');

  for (const col of COLS) {
    if (!state.visibleCols.has(col.key)) continue;
    tr.appendChild(buildCell(row, col));
  }
  return tr;
}

function buildCell(row, col) {
  const td = document.createElement('td');
  td.dataset.key = col.key;
  td.style.minWidth = col.width;

  const v = row[col.key];

  switch (col.kind) {
    case 'pill': {
      if (v) {
        const span = document.createElement('span');
        span.className = 'pill';
        span.dataset.domain = v;
        span.textContent = v;
        td.appendChild(span);
      }
      break;
    }
    case 'state': {
      const s = document.createElement('span');
      s.className = 'state ' + (v || '').toString().replace(/\W/g, '-').toLowerCase();
      s.textContent = formatState(row);
      td.appendChild(s);
      break;
    }
    case 'list': {
      td.textContent = Array.isArray(v) && v.length ? v.join(', ') : '';
      if (!v || !v.length) td.classList.add('dim');
      break;
    }
    case 'comment': {
      td.textContent = v || '';
      if (!v) { td.innerHTML = '<span class="dim">—</span>'; }
      break;
    }
    case 'entity_id': {
      // Render as "<domain>.<object_id>" with the domain visually locked
      // (editing only rewrites the part after the dot).
      const wrap = document.createElement('span');
      wrap.className = 'eid';
      const pre = document.createElement('span');
      pre.className = 'eid__domain';
      pre.textContent = row.domain + '.';
      const obj = document.createElement('span');
      obj.className = 'eid__object';
      obj.textContent = row.object_id || '';
      wrap.appendChild(pre);
      wrap.appendChild(obj);
      td.appendChild(wrap);
      break;
    }
    case 'time': {
      if (!v) { td.innerHTML = '<span class="dim">—</span>'; break; }
      const dt = new Date(v);
      if (isNaN(dt.getTime())) { td.textContent = v; break; }
      const rel = relativeTime(dt);
      const span = document.createElement('span');
      span.className = 'time';
      span.textContent = rel;
      span.title = dt.toLocaleString();  // full date on hover
      span.dataset.ts = String(dt.getTime());
      td.appendChild(span);
      break;
    }
    case 'actions': {
      td.classList.add('actions-cell');
      // Row status indicators come first, then the three action buttons.
      if (row.hidden_by) {
        const b = document.createElement('span');
        b.className = 'badge badge--hidden';
        b.textContent = 'hidden';
        b.title = `hidden_by: ${row.hidden_by}`;
        td.appendChild(b);
      }
      if (row.disabled_by) {
        const b = document.createElement('span');
        b.className = 'badge badge--disabled';
        b.textContent = 'disabled';
        b.title = `disabled_by: ${row.disabled_by}`;
        td.appendChild(b);
      }

      // Hide toggle (user-level only; can't un-hide integration-hidden)
      const hideBtn = actionBtn(
        row.hidden_by ? '↺' : '⌀',
        row.hidden_by ? 'Un-hide' : 'Hide from UI',
        async () => {
          try {
            await saveEntity(row.entity_id, { hidden: !row.hidden_by });
            row.hidden_by = row.hidden_by ? null : 'user';
            applyFilters(); renderBody();
            toast(row.hidden_by ? 'Hidden.' : 'Un-hidden.');
          } catch (err) { toast('Hide failed: ' + err.message, true); }
        },
        (row.hidden_by && row.hidden_by !== 'user'),  // disabled if integration-hidden
      );
      td.appendChild(hideBtn);

      // Disable toggle
      const disBtn = actionBtn(
        row.disabled_by ? '↺' : '⏻',
        row.disabled_by ? 'Re-enable' : 'Disable',
        async () => {
          try {
            await saveEntity(row.entity_id, { disabled: !row.disabled_by });
            row.disabled_by = row.disabled_by ? null : 'user';
            applyFilters(); renderBody();
            toast(row.disabled_by ? 'Disabled.' : 'Enabled.');
          } catch (err) { toast('Disable failed: ' + err.message, true); }
        },
        (row.disabled_by && row.disabled_by !== 'user'),
      );
      td.appendChild(disBtn);

      // Delete entity — requires confirmation. A second click within 3s commits.
      const delBtn = actionBtn('🗑', 'Delete entity', () => confirmDelete(delBtn, row));
      delBtn.classList.add('act--danger');
      td.appendChild(delBtn);

      // Delete whole device — only if this row has a device AND that
      // device has at least one config entry we can detach from.
      if (row.device_id && (row.device_config_entries || []).length) {
        const delDev = actionBtn(
          '⌦',
          `Delete device "${row.device_name || row.device_id}" (removes all its entities)`,
          () => confirmDeleteDevice(delDev, row),
        );
        delDev.classList.add('act--danger');
        td.appendChild(delDev);
      }

      break;
    }
    default: {
      td.textContent = v ?? '';
      if (v == null || v === '') td.innerHTML = '<span class="dim">—</span>';
    }
  }

  if (col.editable) {
    td.classList.add('editable');
    td.title = editHint(col.editable);
    td.addEventListener('dblclick', () => enterEdit(td, row, col));
  }
  return td;
}

function editHint(kind) {
  switch (kind) {
    case 'friendly':    return 'Double-click to rename (updates Home Assistant)';
    case 'area':        return 'Double-click to reassign area (updates Home Assistant)';
    case 'device_name': return 'Double-click to rename device (updates Home Assistant)';
    case 'comment':     return 'Double-click to add a note (stored in the add-on)';
    case 'object_id':   return 'Double-click to rename the entity_id (updates Home Assistant — domain stays the same)';
    default:            return 'Double-click to edit';
  }
}

function formatState(r) {
  if (r.state == null) return '—';
  return r.unit ? `${r.state} ${r.unit}` : r.state;
}

// ---------------------------------------------------------------------------
// Inline editing
// ---------------------------------------------------------------------------

function enterEdit(td, row, col) {
  if (td.querySelector('input, select')) return;
  const tr = td.closest('tr');
  tr.classList.add('editing');

  // Area uses a dropdown; entity_id uses a locked-prefix input;
  // everything else is a plain text input.
  if (col.editable === 'area') {
    const sel = document.createElement('select');
    sel.className = 'edit';
    sel.innerHTML =
      '<option value="">— none —</option>' +
      state.areas
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(a => `<option value="${a.area_id}" ${a.area_id === row.area_id ? 'selected' : ''}>${esc(a.name)}</option>`)
        .join('');
    td.textContent = '';
    td.appendChild(sel);
    sel.focus();

    const commit = () => finishEdit(td, tr, row, col, sel.value);
    const cancel = () => { tr.classList.remove('editing'); renderBody(); };
    sel.addEventListener('blur', commit, { once: true });
    sel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sel.blur();
      if (e.key === 'Escape') { sel.removeEventListener('blur', commit); cancel(); }
    });
    return;
  }

  if (col.editable === 'object_id') {
    // Render a locked domain prefix with an editable object_id input
    // right after it. HA won't let you change the domain portion.
    td.textContent = '';
    const wrap = document.createElement('span');
    wrap.className = 'eid eid--editing';
    const pre = document.createElement('span');
    pre.className = 'eid__domain';
    pre.textContent = row.domain + '.';
    const input = document.createElement('input');
    input.className = 'edit eid__input';
    input.type = 'text';
    input.value = row.object_id || '';
    input.spellcheck = false;
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    // Keep typing clean: force lowercase and replace illegal chars
    // live, so the user sees exactly what HA will accept.
    input.addEventListener('input', () => {
      const cleaned = input.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (cleaned !== input.value) input.value = cleaned;
    });
    wrap.appendChild(pre);
    wrap.appendChild(input);
    td.appendChild(wrap);
    input.focus();
    input.select();

    const commit = () => finishEdit(td, tr, row, col, input.value);
    const cancel = () => { tr.classList.remove('editing'); renderBody(); };
    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
    });
    return;
  }

  const input = document.createElement('input');
  input.className = 'edit';
  input.type = 'text';
  input.value = (col.key === 'comment'
    ? (row.comment || '')
    : (col.key === 'friendly_name'
        ? (row.friendly_name || '')
        : (col.key === 'device_name' ? (row.device_name || '') : (row[col.key] || ''))));
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();

  const commit = () => finishEdit(td, tr, row, col, input.value);
  const cancel = () => { tr.classList.remove('editing'); renderBody(); };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
  });
}

async function finishEdit(td, tr, row, col, newValue) {
  tr.classList.remove('editing');

  try {
    switch (col.editable) {
      case 'friendly': {
        if (newValue === row.friendly_name) { renderBody(); return; }
        await saveEntity(row.entity_id, { friendly_name: newValue });
        row.friendly_name = newValue || row.entity_id;
        break;
      }
      case 'area': {
        if (newValue === (row.area_id || '')) { renderBody(); return; }
        await saveEntity(row.entity_id, { area_id: newValue });
        const a = state.areas.find(x => x.area_id === newValue);
        row.area_id   = newValue || null;
        row.area_name = a ? a.name : null;
        const f = a && a.floor_id ? state.floors.find(x => x.floor_id === a.floor_id) : null;
        row.floor_id   = f ? f.floor_id : null;
        row.floor_name = f ? f.name     : null;
        break;
      }
      case 'device_name': {
        if (!row.device_id) { toast('This entity has no device.', true); renderBody(); return; }
        if (newValue === row.device_name) { renderBody(); return; }
        await saveDevice(row.device_id, { device_name: newValue });
        // Propagate to every row sharing this device_id.
        for (const r of state.rows) if (r.device_id === row.device_id) r.device_name = newValue;
        break;
      }
      case 'comment': {
        if (newValue === row.comment) { renderBody(); return; }
        await saveEntity(row.entity_id, { comment: newValue });
        row.comment = newValue;
        break;
      }
      case 'object_id': {
        const trimmed = (newValue || '').trim();
        if (trimmed === row.object_id) { renderBody(); return; }
        if (!trimmed) { toast('entity_id cannot be empty.', true); renderBody(); return; }
        if (!/^[a-z0-9_]+$/.test(trimmed) || trimmed.startsWith('_') || trimmed.endsWith('_')) {
          toast('entity_id must be lowercase a–z, 0–9, underscores (no leading/trailing _).', true);
          renderBody();
          return;
        }
        const newEntityId = row.domain + '.' + trimmed;
        if (state.rows.some(r => r !== row && r.entity_id === newEntityId)) {
          toast(`"${newEntityId}" already exists.`, true);
          renderBody();
          return;
        }
        await saveEntity(row.entity_id, { object_id: trimmed });
        // Rewrite the local row; keep sort/filter identity stable.
        row.object_id = trimmed;
        row.entity_id = newEntityId;
        break;
      }
    }
    applyFilters();
    renderBody();
    // Flash the just-edited cell.
    const newTr = document.querySelector(`tr[data-entity-id="${CSS.escape(row.entity_id)}"]`);
    if (newTr) {
      const cell = [...newTr.children].find(c => c.dataset.key === col.key);
      if (cell) { cell.classList.add('saved'); setTimeout(() => cell.classList.remove('saved'), 900); }
    }
  } catch (err) {
    console.error(err);
    toast(`Save failed: ${err.message}`, true);
    renderBody();
  }
}

async function saveEntity(entity_id, patch) {
  const r = await fetch(API.entity, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_id, ...patch }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
}
async function saveDevice(device_id, patch) {
  const r = await fetch(API.device, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id, ...patch }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
}

// ---------------------------------------------------------------------------
// Row actions: hide / disable / delete
// ---------------------------------------------------------------------------

function actionBtn(glyph, label, onClick, disabled = false) {
  const b = document.createElement('button');
  b.className = 'act';
  b.type = 'button';
  b.textContent = glyph;
  b.title = label;
  b.setAttribute('aria-label', label);
  if (disabled) {
    b.disabled = true;
    b.title = label + ' (locked by integration)';
  } else {
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  }
  return b;
}

/**
 * Two-step delete: first click arms the button, a second click within
 * 3s actually removes. This keeps deletes recoverable (click anywhere
 * else to cancel) without needing a modal dialog.
 */
function confirmDelete(btn, row) {
  if (btn.dataset.armed) {
    // Armed already → commit.
    clearTimeout(Number(btn.dataset.armedTimer));
    btn.removeAttribute('data-armed');
    btn.removeAttribute('data-armed-timer');
    btn.classList.remove('act--armed');
    doDeleteEntity(row);
    return;
  }
  btn.dataset.armed = '1';
  btn.classList.add('act--armed');
  btn.textContent = '✓';
  btn.title = 'Click again to confirm delete';
  const t = setTimeout(() => {
    btn.removeAttribute('data-armed');
    btn.removeAttribute('data-armed-timer');
    btn.classList.remove('act--armed');
    btn.textContent = '🗑';
    btn.title = 'Delete entity';
  }, 3000);
  btn.dataset.armedTimer = String(t);
}

function confirmDeleteDevice(btn, row) {
  if (btn.dataset.armed) {
    clearTimeout(Number(btn.dataset.armedTimer));
    btn.removeAttribute('data-armed');
    btn.removeAttribute('data-armed-timer');
    btn.classList.remove('act--armed');
    doDeleteDevice(row.device_id, row.device_config_entries || []);
    return;
  }
  btn.dataset.armed = '1';
  btn.classList.add('act--armed');
  btn.textContent = '✓';
  btn.title = `Click again to delete device "${row.device_name || row.device_id}" and all its entities`;
  const t = setTimeout(() => {
    btn.removeAttribute('data-armed');
    btn.removeAttribute('data-armed-timer');
    btn.classList.remove('act--armed');
    btn.textContent = '⌦';
    btn.title = `Delete device "${row.device_name || row.device_id}"`;
  }, 3000);
  btn.dataset.armedTimer = String(t);
}

async function doDeleteEntity(row) {
  try {
    const r = await fetch(`api/entity/${encodeURIComponent(row.entity_id)}`, {
      method: 'DELETE',
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);

    // Drop locally and re-render.
    state.rows = state.rows.filter(r2 => r2 !== row);
    applyFilters();
    renderBody();
    toast(`${row.entity_id} deleted.`);
  } catch (err) {
    // HA's usual reason: the integration still provides this entity.
    toast(`Delete failed: ${err.message}`, true);
  }
}

async function doDeleteDevice(device_id, config_entries) {
  try {
    const r = await fetch(`api/device/${encodeURIComponent(device_id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_entries }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
    // Remove every entity belonging to this device from the local view —
    // HA removes them server-side when the device goes away.
    state.rows = state.rows.filter(r2 => r2.device_id !== device_id);
    applyFilters();
    renderBody();
    toast('Device deleted.');
  } catch (err) {
    toast(`Delete device failed: ${err.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Relative time formatter
// ---------------------------------------------------------------------------

function relativeTime(dt) {
  const diff = Date.now() - dt.getTime();
  const abs = Math.abs(diff);
  const s = Math.round(abs / 1000);
  if (s < 45)        return diff >= 0 ? 'just now' : 'soon';
  const m = Math.round(s / 60);
  if (m < 60)        return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24)        return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14)        return `${d} d ago`;
  const w = Math.round(d / 7);
  if (w < 8)         return `${w} w ago`;
  // Longer than 8 weeks: show a date in a compact, locale-aware form.
  return dt.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Column picker
// ---------------------------------------------------------------------------

function toggleColumnsPopover() {
  const pop = document.getElementById('pop-columns');
  const list = document.getElementById('pop-cols-list');
  if (!pop.hidden) { pop.hidden = true; return; }

  list.innerHTML = '';
  for (const col of COLS) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.visibleCols.has(col.key);
    cb.addEventListener('change', () => {
      if (cb.checked) state.visibleCols.add(col.key);
      else            state.visibleCols.delete(col.key);
      renderHead(); renderBody();
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(col.label));
    list.appendChild(lbl);
  }
  pop.hidden = false;

  // close on outside click
  setTimeout(() => {
    const handler = (e) => {
      if (!pop.contains(e.target) && e.target.id !== 'btn-columns') {
        pop.hidden = true;
        document.removeEventListener('mousedown', handler);
      }
    };
    document.addEventListener('mousedown', handler);
  }, 0);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportCsv() {
  const visible = COLS.filter(c => state.visibleCols.has(c.key));
  const head = visible.map(c => csvEscape(c.label)).join(',');
  const body = state.filtered.map(r =>
    visible.map(c => csvEscape(Array.isArray(r[c.key]) ? r[c.key].join('|') : r[c.key])).join(',')
  );
  const csv = [head, ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `entity-atlas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${state.filtered.length} rows.`);
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------------------------------------------------------------------------
// Toast + small helpers
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('err', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------------------
// Notes panel (free-form readme for naming scheme etc.)
// ---------------------------------------------------------------------------

const notes = {
  current: '',          // last saved value
  draft: '',            // unsaved edits
  editing: false,
};

function wireNotes() {
  document.getElementById('notes-edit').addEventListener('click', startEditNotes);
  document.getElementById('notes-cancel').addEventListener('click', cancelEditNotes);
  document.getElementById('notes-save').addEventListener('click', saveNotes);

  // Auto-open the panel the first time there's content, so the user
  // actually sees what they wrote. After that their open/closed choice
  // is up to the <details> element itself.
  const details = document.getElementById('notes');
  details.addEventListener('toggle', () => {
    // When collapsing while editing, keep edit state but render the
    // summary hint for what's unsaved.
    if (!details.open && notes.editing) {
      toast('Note editor hidden — click the panel to keep editing.');
    }
  });

  // Ctrl/Cmd+S while the textarea is focused → save
  document.getElementById('notes-edit-area').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveNotes();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditNotes();
    }
  });
}

async function loadNotes() {
  try {
    const r = await fetch(API.notes);
    const data = await r.json();
    notes.current = (data && typeof data.readme === 'string') ? data.readme : '';
    renderNotes();
    // If there's content, expand the panel so it's visible on first visit.
    if (notes.current.trim()) {
      document.getElementById('notes').open = true;
    }
  } catch (err) {
    console.error('notes load failed', err);
    document.getElementById('notes-meta').textContent = 'failed to load';
  }
}

function renderNotes() {
  const view = document.getElementById('notes-view');
  const meta = document.getElementById('notes-meta');
  const hint = document.getElementById('notes-hint');

  if (!notes.current.trim()) {
    view.innerHTML = '<p class="notes__empty">Describe your naming convention, prefix glossary, how you tag rooms, anything future-you will be glad to find here. Click <strong>Edit</strong> to start.</p>';
    meta.textContent = 'empty';
    hint.textContent = '— click to expand';
  } else {
    view.innerHTML = renderMarkdown(notes.current);
    const lines = notes.current.split('\n').length;
    const chars = notes.current.length;
    meta.textContent = `${lines} line${lines === 1 ? '' : 's'} · ${chars} chars`;
    hint.textContent = '— naming scheme & more';
  }
}

function startEditNotes() {
  notes.editing = true;
  notes.draft = notes.current;

  const ta = document.getElementById('notes-edit-area');
  ta.value = notes.draft;
  ta.hidden = false;
  document.getElementById('notes-view').hidden = true;

  document.getElementById('notes-edit').hidden = true;
  document.getElementById('notes-save').hidden = false;
  document.getElementById('notes-cancel').hidden = false;

  document.getElementById('notes').open = true;
  ta.focus();
}

function cancelEditNotes() {
  notes.editing = false;
  document.getElementById('notes-edit-area').hidden = true;
  document.getElementById('notes-view').hidden = false;
  document.getElementById('notes-edit').hidden = false;
  document.getElementById('notes-save').hidden = true;
  document.getElementById('notes-cancel').hidden = true;
}

async function saveNotes() {
  const ta = document.getElementById('notes-edit-area');
  const value = ta.value;
  try {
    const r = await fetch(API.notes, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readme: value }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
    notes.current = value;
    renderNotes();
    cancelEditNotes();
    toast('Notes saved.');
  } catch (err) {
    console.error(err);
    toast('Save failed: ' + err.message, true);
  }
}

/**
 * Tiny safe-ish markdown renderer — just enough for a personal readme.
 * We escape everything first, then reintroduce a small set of markup
 * constructs. No raw HTML is ever honored.
 *
 * Supports: # / ## / ### headings, **bold**, *italic*, `code`,
 * fenced ```code blocks```, bulleted (- / *) lists, numbered (1.) lists,
 * horizontal rules (---), and paragraphs.
 */
function renderMarkdown(src) {
  // 1. Escape HTML entirely.
  const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Pull fenced code blocks out first so their contents are never
  //    subjected to the inline pass.
  const blocks = [];
  src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, _lang, body) => {
    const token = `\u0000BLOCK${blocks.length}\u0000`;
    blocks.push(`<pre><code>${esc(body.replace(/\n$/, ''))}</code></pre>`);
    return token;
  });

  // 3. Escape everything that's left.
  let out = esc(src);

  // 4. Line-level pass: split into lines, build heading / list / rule / paragraph.
  const lines = out.split('\n');
  const html = [];
  let listMode = null;   // 'ul' | 'ol' | null
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push('<p>' + paragraph.join(' ') + '</p>');
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listMode) {
      html.push(`</${listMode}>`);
      listMode = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Fenced-block token on its own line
    if (/^\u0000BLOCK\d+\u0000$/.test(line)) {
      flushParagraph(); flushList();
      const idx = Number(line.match(/\u0000BLOCK(\d+)\u0000/)[1]);
      html.push(blocks[idx]);
      continue;
    }

    if (!line.trim()) {                              // blank line
      flushParagraph(); flushList();
      continue;
    }
    if (/^---+$/.test(line.trim())) {                // horizontal rule
      flushParagraph(); flushList();
      html.push('<hr/>');
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);       // heading
    if (h) {
      flushParagraph(); flushList();
      const level = h[1].length;
      html.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);       // bullet list
    if (ul) {
      flushParagraph();
      if (listMode !== 'ul') { flushList(); html.push('<ul>'); listMode = 'ul'; }
      html.push(`<li>${inlineMd(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);      // numbered list
    if (ol) {
      flushParagraph();
      if (listMode !== 'ol') { flushList(); html.push('<ol>'); listMode = 'ol'; }
      html.push(`<li>${inlineMd(ol[1])}</li>`);
      continue;
    }

    // Regular paragraph line
    flushList();
    paragraph.push(inlineMd(line));
  }
  flushParagraph(); flushList();

  return html.join('\n');
}

function inlineMd(s) {
  // Inline code first, so ** and * inside backticks don't get consumed.
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold **x**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic *x*  (simple, won't catch every pathological case)
  s = s.replace(/(^|[^\*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // Linkify bare URLs (already-escaped, so http and https only)
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>',
  );
  return s;
}

function esc(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
