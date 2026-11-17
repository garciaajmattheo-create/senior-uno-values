// Turns pasted text, CSV/Excel files and School Form 1 (SF1) exports into
// a clean list of students: { lrn, last_name, first_name, middle_name, sex }.

const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

export function titleCase(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Only re-case names typed in ALL CAPS or all lowercase.
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-'.])([a-zñ])/g, (m, a, b) => a + b.toUpperCase());
}

const isLrn = (v) => /^\d{12}$/.test(String(v || '').replace(/\s/g, ''));
const sexOf = (v) => {
  const t = String(v || '').trim().toUpperCase();
  if (t === 'M' || t === 'MALE') return 'M';
  if (t === 'F' || t === 'FEMALE') return 'F';
  return null;
};

// "DELA CRUZ, JUAN SANTOS" → last / first / middle
function splitCommaName(text) {
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  const last = parts[0] || '';
  let first = parts[1] || '';
  let middle = parts[2] || '';
  if (!middle && parts.length === 2) {
    // "Juan Santos" after the comma: the last word may be the middle name if it
    // was written as an initial ("Juan S.") — keep full first names otherwise.
    const m = first.match(/^(.*?)\s+([A-Za-zÑñ]\.?)$/);
    if (m) { first = m[1]; middle = m[2]; }
  }
  return { last_name: titleCase(last), first_name: titleCase(first), middle_name: titleCase(middle) || null };
}

// One row of cells (from paste, CSV or Excel) with no known header.
function rowToStudent(cells) {
  cells = cells.map((c) => String(c ?? '').trim()).filter((c) => c !== '');
  if (!cells.length) return null;
  let lrn = null, sex = null;
  const text = [];
  for (const c of cells) {
    if (!lrn && isLrn(c)) { lrn = c.replace(/\s/g, ''); continue; }
    if (!sex && sexOf(c) && c.length <= 6) { sex = sexOf(c); continue; }
    if (/^\d+\.?$/.test(c)) continue;          // row numbers like "1." or "12"
    if (/[A-Za-zÑñ]/.test(c)) text.push(c.replace(/^\d+\s*[.)\-]\s*/, ''));
  }
  if (!text.length) return null;
  let name;
  if (text.length === 1 && text[0].includes(',')) name = splitCommaName(text[0]);
  else if (text.length >= 2) name = { last_name: titleCase(text[0]), first_name: titleCase(text[1]), middle_name: titleCase(text[2] || '') || null };
  else {
    const w = text[0].split(/\s+/);
    if (w.length < 2) return null;
    name = { last_name: titleCase(w.pop()), first_name: titleCase(w.join(' ')), middle_name: null };
  }
  if (!name.last_name || !name.first_name) return null;
  return { lrn, sex, ...name };
}

// Pasted text: one student per line. Columns may be separated by tabs (copied
// from Excel / Google Sheets) or semicolons.
export function parsePasted(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => (l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : [l]));
  return parseRows(rows);
}

// Table rows (arrays of cells). Uses a header row if one is found.
export function parseRows(rows) {
  const head = findHeader(rows);
  const out = [];
  const start = head ? head.index + 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i] || [];
    let s;
    if (head) {
      const get = (k) => (head.cols[k] != null ? String(r[head.cols[k]] ?? '').trim() : '');
      if (head.cols.full != null && head.cols.last == null) s = rowToStudent([get('lrn'), get('full'), get('sex')]);
      else {
        const last = get('last'), first = get('first');
        if (!last || !first) { s = rowToStudent(r); }
        else s = { lrn: isLrn(get('lrn')) ? get('lrn').replace(/\s/g, '') : null, last_name: titleCase(last), first_name: titleCase(first),
                   middle_name: titleCase(get('middle')) || null, sex: sexOf(get('sex')) };
      }
    } else s = rowToStudent(r);
    if (s) out.push(s);
  }
  return dedupe(out);
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map((c) => String(c ?? '').toLowerCase().trim());
    const cols = {};
    r.forEach((c, j) => {
      if (/^lrn|learner reference/.test(c)) cols.lrn = j;
      else if (/last\s*name|surname|apelyido/.test(c)) cols.last = j;
      else if (/first\s*name|given/.test(c)) cols.first = j;
      else if (/middle/.test(c)) cols.middle = j;
      else if (/^sex|gender|^m\/f/.test(c)) cols.sex = j;
      else if (/^name|full\s*name|learner'?s? name/.test(c)) cols.full = j;
    });
    if (cols.last != null && cols.first != null) return { index: i, cols };
    if (cols.full != null) return { index: i, cols };
  }
  return null;
}

// School Form 1 (from LIS): rows that contain a 12-digit LRN are students.
export function parseSF1(rows) {
  const out = [];
  for (const r of rows) {
    const cells = (r || []).map((c) => String(c ?? '').trim());
    const li = cells.findIndex(isLrn);
    if (li < 0) continue;
    const rest = cells.slice(li + 1).filter(Boolean);
    const nameCell = rest.find((c) => /[A-Za-zÑñ]/.test(c) && c.includes(','));
    let s;
    if (nameCell) s = { lrn: cells[li].replace(/\s/g, ''), ...splitCommaName(nameCell) };
    else {
      const texts = rest.filter((c) => /[A-Za-zÑñ]{2,}/.test(c) && !sexOf(c));
      if (texts.length < 2) continue;
      s = { lrn: cells[li].replace(/\s/g, ''), last_name: titleCase(texts[0]), first_name: titleCase(texts[1]), middle_name: titleCase(texts[2] || '') || null };
    }
    const sexCell = rest.find((c) => sexOf(c));
    s.sex = sexCell ? sexOf(sexCell) : null;
    if (s.last_name && s.first_name) out.push(s);
  }
  return dedupe(out);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((s) => {
    const k = s.lrn || (s.last_name + '|' + s.first_name).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// Simple CSV parser (handles quotes, commas and new lines inside quotes).
export function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Reads a .csv / .xlsx / .xls file into rows of cells (first sheet; for SF1 all sheets).
export async function readFileRows(file, allSheets = false) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCSV(await file.text());
  const XLSX = await import(SHEETJS);
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheets = allSheets ? wb.SheetNames : [wb.SheetNames[0]];
  let rows = [];
  for (const sn of sheets) rows = rows.concat(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' }));
  return rows;
}

export const TEMPLATE_CSV = 'LRN,Last Name,First Name,Middle Name,Sex\n123456789012,Dela Cruz,Juan,Santos,M\n';
