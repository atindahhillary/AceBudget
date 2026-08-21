/**
 * xlsx.js: minimal OOXML spreadsheet (.xlsx) read/write.
 *
 * Writing uses inline strings (no shared-strings table) to keep the encoder
 * simple; reading supports both inline strings and shared strings, since
 * real-world workbooks from Excel/Google Sheets/LibreOffice always use the
 * latter. Parsing uses the browser's native DOMParser: no XML library.
 */

import { writeZip, readZip } from './zip.js';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function colIndexToLetter(n) {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function colLetterToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sanitizeSheetName(name, used) {
  let clean = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let out = clean;
  let n = 2;
  while (used.has(out)) out = `${clean.slice(0, 28)} ${n++}`;
  used.add(out);
  return out;
}

// --- writing ----------------------------------------------------------------

function contentTypesXml(sheets) {
  const overrides = sheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${overrides}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheets) {
  const entries = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${entries}</sheets>
</workbook>`;
}

function workbookRelsXml(sheets) {
  const rels = sheets.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function sheetXml(rows) {
  const rowXml = rows.map((row, r) => {
    const cells = (row || []).map((val, c) => {
      if (val == null || val === '') return '';
      const ref = `${colIndexToLetter(c)}${r + 1}`;
      if (typeof val === 'number' && Number.isFinite(val)) return `<c r="${ref}"><v>${val}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}"><sheetData>${rowXml}</sheetData></worksheet>`;
}

/**
 * Build a real, valid .xlsx workbook from tabular sheets.
 * @param {Array<{name:string, rows: any[][]}>} sheets
 * @returns {Blob}
 */
export function buildXlsxBlob(sheets) {
  const used = new Set();
  const safe = sheets.map((s) => ({ name: sanitizeSheetName(s.name, used), rows: s.rows }));
  const enc8 = new TextEncoder();
  const parts = [
    { name: '[Content_Types].xml', data: enc8.encode(contentTypesXml(safe)) },
    { name: '_rels/.rels', data: enc8.encode(rootRelsXml()) },
    { name: 'xl/workbook.xml', data: enc8.encode(workbookXml(safe)) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc8.encode(workbookRelsXml(safe)) },
    ...safe.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc8.encode(sheetXml(s.rows)) })),
  ];
  return new Blob([writeZip(parts)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// --- reading ------------------------------------------------------------

/**
 * Parse an .xlsx file into tabular sheets. Handles both shared-string and
 * inline-string cells, and both stored and DEFLATE-compressed archives.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<{name:string, rows: (string|number)[][]}>>}
 */
export async function parseXlsxRows(buffer) {
  const files = await readZip(buffer);
  const dec = new TextDecoder();
  const parser = new DOMParser();
  const parseXml = (name) => {
    const bytes = files.get(name);
    return bytes ? parser.parseFromString(dec.decode(bytes), 'application/xml') : null;
  };

  const wbDoc = parseXml('xl/workbook.xml');
  if (!wbDoc) throw new Error('Not a valid .xlsx workbook: missing xl/workbook.xml.');
  const relsDoc = parseXml('xl/_rels/workbook.xml.rels');
  const relMap = new Map();
  if (relsDoc) {
    for (const rel of relsDoc.getElementsByTagName('Relationship')) {
      relMap.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
    }
  }

  const sheetMeta = [...wbDoc.getElementsByTagName('sheet')].map((s) => ({
    name: s.getAttribute('name') || 'Sheet',
    rid: s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'),
  }));

  let sharedStrings = [];
  const ssDoc = parseXml('xl/sharedStrings.xml');
  if (ssDoc) {
    sharedStrings = [...ssDoc.getElementsByTagName('si')].map((si) =>
      [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')
    );
  }

  const sheets = [];
  for (const meta of sheetMeta) {
    const target = relMap.get(meta.rid);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.?\//, '')}`;
    const sheetDoc = parseXml(path);
    if (!sheetDoc) continue;

    const rows = [];
    for (const rowEl of sheetDoc.getElementsByTagName('row')) {
      const rIdx = parseInt(rowEl.getAttribute('r'), 10) - 1;
      const row = rows[rIdx] || (rows[rIdx] = []);
      for (const cellEl of rowEl.getElementsByTagName('c')) {
        const ref = cellEl.getAttribute('r') || '';
        const colIdx = colLetterToIndex(ref.replace(/[0-9]/g, '') || 'A');
        const type = cellEl.getAttribute('t');
        let value;
        if (type === 's') {
          const idx = parseInt(cellEl.getElementsByTagName('v')[0]?.textContent || '0', 10);
          value = sharedStrings[idx] ?? '';
        } else if (type === 'inlineStr') {
          value = cellEl.getElementsByTagName('t')[0]?.textContent ?? '';
        } else if (type === 'str' || type === 'e') {
          value = cellEl.getElementsByTagName('v')[0]?.textContent ?? '';
        } else {
          const raw = cellEl.getElementsByTagName('v')[0]?.textContent;
          value = raw === undefined || raw === '' ? '' : Number(raw);
        }
        row[colIdx] = value;
      }
    }
    sheets.push({ name: meta.name, rows: rows.map((r) => r || []) });
  }
  return sheets;
}
