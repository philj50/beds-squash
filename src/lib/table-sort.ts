/** Sort an admin table from its header row. Detail rows stay with the row above them. */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isEmpty(value: string) {
  const text = value.trim();
  return text === '' || text === '—' || text === '-' || text === '–';
}

function parseLooseDate(value: string) {
  const match = value.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (!match) return null;
  const month = MONTHS.findIndex((name) => match[2].toLowerCase().startsWith(name));
  if (month < 0) return null;
  const time = value.match(/(\d{1,2}):(\d{2})/);
  return Date.UTC(Number(match[3]), month, Number(match[1]), time ? Number(time[1]) : 0, time ? Number(time[2]) : 0);
}

export function compareCellText(left: string, right: string) {
  const a = left.trim();
  const b = right.trim();
  const numberA = a.replace(/,/g, '');
  const numberB = b.replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(numberA) && /^-?\d+(\.\d+)?$/.test(numberB)) return Number(numberA) - Number(numberB);
  const dateA = parseLooseDate(a);
  const dateB = parseLooseDate(b);
  if (dateA != null && dateB != null) return dateA - dateB;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

function cellValue(cell: Element | undefined) {
  if (!cell) return '';
  const field = cell.querySelector('input, select');
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) return field.value.trim();
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function headerLabel(th: HTMLTableCellElement) {
  const copy = th.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.sr-only').forEach((node) => node.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isCompanion(row: HTMLTableRowElement) {
  return row.hasAttribute('data-traffic-detail') || row.hasAttribute('data-member-detail') || row.hasAttribute('data-editor-row');
}

function rowGroups(tbody: HTMLTableSectionElement) {
  const groups: HTMLTableRowElement[][] = [];
  for (const row of [...tbody.rows]) {
    const previous = groups[groups.length - 1];
    if (previous && isCompanion(row)) previous.push(row);
    else groups.push([row]);
  }
  return groups;
}

function compareValues(left: string, right: string, direction: 1 | -1) {
  const emptyLeft = isEmpty(left);
  const emptyRight = isEmpty(right);
  if (emptyLeft || emptyRight) return emptyLeft === emptyRight ? 0 : emptyLeft ? 1 : -1;
  return direction * compareCellText(left, right);
}

export function sortTableElement(table: HTMLTableElement, column: number, direction: 1 | -1) {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const groups = rowGroups(tbody).filter((group) => group[0].cells.length > 1);
  if (groups.length < 2) return;
  groups.sort((left, right) => compareValues(cellValue(left[0].cells[column]), cellValue(right[0].cells[column]), direction));
  for (const group of groups) {
    for (const row of group) tbody.appendChild(row);
  }
}

export function sortMarkupRows(rows: string[], column: number, direction: 1 | -1) {
  const decorated = rows.map((html) => {
    const holder = document.createElement('tbody');
    holder.innerHTML = html;
    const row = holder.querySelector('tr');
    return { html, key: cellValue(row?.cells[column]) };
  });
  decorated.sort((left, right) => compareValues(left.key, right.key, direction));
  return decorated.map((item) => item.html);
}

export function watchSortableTables(
  root: ParentNode,
  onSort?: (table: HTMLTableElement, column: number, direction: 1 | -1) => boolean,
) {
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, label')) return;
    const th = target.closest('th');
    if (!(th instanceof HTMLTableCellElement)) return;
    const table = th.closest('table');
    const head = table?.tHead;
    const headerRow = head?.rows[0];
    if (!table || !head || !headerRow || !root.contains(table) || th.parentElement?.parentElement !== head) return;
    if (!headerLabel(th)) return;
    const direction: 1 | -1 = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
    for (const header of [...headerRow.cells]) header.removeAttribute('aria-sort');
    th.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');
    if (onSort?.(table, th.cellIndex, direction)) return;
    sortTableElement(table, th.cellIndex, direction);
  });
}
