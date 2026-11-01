/** Đọc CSV theo RFC 4180: hỗ trợ dấu ngoặc kép, xuống dòng trong ô, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function escapeCell(value: string): string {
  // Chặn CSV injection khi mở bằng Excel: ô bắt đầu bằng ký tự công thức được thêm dấu nháy.
  const safe = /^[=+\-@\t]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Bỏ dấu nháy bảo vệ công thức khi nhập lại file đã xuất. */
export function unguardCell(value: string): string {
  return /^'[=+\-@\t]/.test(value) ? value.slice(1) : value;
}

/** Ghi CSV kèm BOM để Excel đọc đúng tiếng Việt. */
export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((r) => r.map(escapeCell).join(',')).join('\r\n')}\r\n`;
}
