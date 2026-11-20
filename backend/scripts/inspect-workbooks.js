'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '../../Central_Placement_Committee_UTU');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.xlsx?$/i.test(entry.name)) files.push(fullPath);
  }
}
walk(root);
for (const file of files) {
  const workbook = XLSX.readFile(file, { cellDates: true, dense: false });
  console.log(`\nFILE: ${path.relative(root, file)}`);
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const nonEmpty = rows.filter((row) => row.some((value) => String(value).trim() !== ''));
    const headers = nonEmpty[0] || [];
    console.log(JSON.stringify({ sheet: sheetName, rows: Math.max(nonEmpty.length - 1, 0), columns: headers }));
  }
}
