// =======================================================
// Lemon Banjo Setup & Repair Info (Google Sheets Driven)
// Now supports:
// - Column A: Item
// - Column B: Price (number only)
// - Column C: Notes (optional)
// - Column D: Sort
// - Column E: Visible
// =======================================================

const SR_SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const SR_GVIZ = (sheet, tq) =>
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + SR_SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({ sheet, tq }).toString();

function srRows(t) {
  return (t?.table?.rows || t?.rows || []).map(r =>
    (r.c || []).map(c => (c && typeof c.v !== 'undefined' && c.v !== null) ? c.v : null)
  );
}

function srClean(v) {
  return (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());
}

async function srQuery(sheet, tq) {
  const res = await fetch(SR_GVIZ(sheet, tq), { cache: 'no-store' });
  const txt = await res.text();
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json;
}

function formatPrice(num) {
  if (num === null || num === "" || isNaN(num)) return "";
  return `$${Number(num).toFixed(2)}`;
}

async function loadSetupRepairTable() {
  const tbody = document.getElementById('setupTableBody');
  if (!tbody) return;

  try {
    // A, B, C, D, E
    const tq = "select A,B,C,D,E where A is not null order by D asc";
    const raw = await srQuery('SetupRepair', tq);
    const data = srRows(raw);

    const rows = data
      .map(row => {
        const [item, priceNum, notes, sort, visible] = row;
        return {
          item: srClean(item),
          price: priceNum,
          notes: srClean(notes),
          sort: Number(sort || 0),
          visible: String(visible).toLowerCase() !== 'false'
        };
      })
      .filter(r => r.item && r.visible)
      .sort((a, b) => a.sort - b.sort || a.item.localeCompare(b.item));

    tbody.innerHTML = '';

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No setup or repair items are currently available.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach(r => {
      const tr = document.createElement('tr');

      const tdItem = document.createElement('td');
      tdItem.textContent = r.item;

      const tdPrice = document.createElement('td');

      const formatted = formatPrice(r.price);
      tdPrice.textContent = formatted + (r.notes ? ` (${r.notes})` : '');

      tr.appendChild(tdItem);
      tr.appendChild(tdPrice);
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error loading SetupRepair sheet:', err);
    tbody.innerHTML = `
      <tr><td colspan="2">Unable to load setup & repair prices at this time.</td></tr>
    `;
  }
}

document.addEventListener('DOMContentLoaded', loadSetupRepairTable);
