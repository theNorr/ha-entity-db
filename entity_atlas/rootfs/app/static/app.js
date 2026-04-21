/* =========================================================================
   Entity Atlas — client
   Talks to the addon's backend at the same origin (ingress-relative paths).
   ========================================================================= */

// Ingress-safe: always use relative URLs.
const API = {
  data:   'api/data',
  entity: 'api/entity',
  device: 'api/device',
};

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
//
//   key       : field on the row
//   label     : header text
//   kind      : 'text' | 'pill' | 'state' | 'mono' | 'comment' | 'list' | 'area' | 'friendly'
//   editable  : how the cell saves — null | 'friendly' | 'area' | 'device_name' | 'comment'
//   default   : visible by default
//   width     : initial CSS width hint
//
// "editable: 'friendly'" means edits POST /api/entity with friendly_name.
// "editable: 'area'"     means edits POST /api/entity with area_id (dropdown).
// "editable: 'device_name'" means edits POST /api/device with device_name.
// "editable: 'comment'"  stays local (the backend stores it in SQLite).

const COLS = [
  { key: 'entity_id',     label: 'entity_id',     kind: 'mono',      editable: null,           default: true,  width: '240px' },
  { key: 'friendly_name', label: 'friendly name', kind: 'friendly',  editable: 'friendly',     default: true,  width: '220px' },
  { key: 'state',         label: 'state',         kind: 'state',     editable: null,           default: true,  width: '110px' },
  { key: 'domain',        label: 'domain',        kind: 'pill',      editable: null,           default: true,  width: '110px' },
  { key: 'area_name',     label: 'room (area)',   kind: 'area',      editable: 'area',         default: true,  width: '160px' },
  { key: 'floor_name',    label: 'floor',         kind: 'text',      editable: null,           default: true,  width: '120px' },
  { key: 'device_name',   label: 'device',        kind: 'text',      editable: 'device_name',  default: true,  width: '200px' },
  { key: 'manufacturer',  label: 'brand',         kind: 'text',      editable: null,           default: true,  width: '140px' },
  { key: 'model',         label: 'model',         kind: 'text',      editable: null,           default: true,  width: '160px' },
  { key: 'comment',       label: 'comment',       kind: 'comment',   editable: 'comment',      default: true,  width: '280px' },
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
  missingOnly: false,
  visibleCols: new Set(COLS.filter(c => c.default).map(c => c.key)),
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
  wireStaticUI();
  await loadData();
});

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
  document.getElementById('f-missing').addEventListener('change', (e) => {
    state.missingOnly = e.target.checked; applyFilters(); renderBody();
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
}

function applyFilters() {
  const q = state.query;
  const rows = state.rows.filter(r => {
    if (state.domain && r.domain !== state.domain) return false;
    if (state.area && r.area_id !== state.area) return false;
    if (state.floor && r.floor_id !== state.floor) return false;
    if (state.manufacturer && r.manufacturer !== state.manufacturer) return false;
    if (state.missingOnly && r.area_id) return false;
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
  rows.sort((a, b) => {
    const av = a[k], bv = b[k];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
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

  // Area uses a dropdown; everything else is a text input.
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

function esc(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
