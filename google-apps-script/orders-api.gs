/**
 * Amanat Logistics — Shipment Control Tracker API (Google Apps Script)
 * ====================================================================
 *
 * Backend for the Orders section of the website (/orders and /orders/admin),
 * reading the SHIPMENTS sheet of "Amanat_Shipment_Control_Tracker".
 *
 * Written against the real workbook, not a guess at it:
 *   - one row per ACCI invoice
 *   - fourteen movement stages, each its own date column
 *   - two customs routes: KDR leaves stage 7 empty, HRTN leaves 1 and 2 empty,
 *     so the stage reached is the HIGHEST numbered date present, never a count
 *   - dates are written "11-Aug-26"
 *   - "-" is used as an empty placeholder in the truck plate columns
 *   - weights and carton counts carry thousands separators ("11,390.00")
 *
 * Deploy: Extensions -> Apps Script, paste this file, then
 *         Deploy -> New deployment -> Web app
 *           Execute as:      Me
 *           Who has access:  Anyone
 *         Put the /exec URL in SHEETS_API_URL, and the same secret in both
 *         Script Properties (API_TOKEN) and SHEETS_API_TOKEN.
 *
 * "Anyone" is safe: every request must carry the token, and the token stays on
 * the Astro server — a browser never sees it.
 *
 * Endpoints
 *   GET  ?token=…&action=list             every shipment
 *   GET  ?token=…&action=find&code=…      one, by tracking OR ACCI invoice no
 *   POST {token, action:'update', id, fields:{…}}
 */

var SHEET_NAME = 'SHIPMENTS';

/**
 * Tracking number format: AM-0031-INV-062 for ACCI invoice RN-062.
 * The parser that reads existing codes back is built from these, so a change
 * here cannot leave the reader behind.
 */
var TRACKING_PREFIX = 'AM';
var TRACKING_SEGMENT = 'INV';
var SEQUENCE_PAD = 4;
var SEQUENCE_START = 1;

/**
 * Codes the office has ALREADY issued, before the website existed.
 *
 * These are real numbers customers may already be holding, so they are not
 * regenerated — an invoice listed here always gets exactly the code it was
 * given. Everything else carries on from the highest sequence here (0031), so
 * the next new shipment is AM-0032-INV-….
 *
 * This is a register of issued numbers, not a substitute for the rule: the
 * codes below all follow the same AM-<sequence>-INV-<invoice number> shape,
 * and new ones are built by buildTrackingNumber_() rather than listed.
 *
 * Once the sheet has a Tracking No column, its value wins over this list — so
 * a number corrected in the sheet stays corrected, and this list can be left
 * as the historical record.
 */
var ISSUED_CODES = {
  'RN-062': 'AM-0031-INV-062',
  'PH-028': 'AM-0030-INV-028',
  'PH-029': 'AM-0029-INV-029',
  'PH-030': 'AM-0028-INV-030',
  'PH-031': 'AM-0027-INV-031',
  'PH-033': 'AM-0026-INV-033',
  'PH-034': 'AM-0025-INV-034',
  'PH-032': 'AM-0024-INV-032',
  'MS-024': 'AM-0023-INV-024',
  'MS-023': 'AM-0022-INV-023',
  'FF-004': 'AM-0021-INV-004',
  'RM-066': 'AM-0020-INV-066',
  'SR-011': 'AM-0019-INV-011',
  'SR-010': 'AM-0018-INV-010',
  'RS-009': 'AM-0017-INV-009',
  'MS-020': 'AM-0016-INV-020',
  'MS-022': 'AM-0015-INV-022',
  'MS-021': 'AM-0014-INV-021',
  'MS-018': 'AM-0013-INV-018',
  'MS-019': 'AM-0012-INV-019',
  'INV-020': 'AM-0011-INV-020',
  'INV-021': 'AM-0010-INV-021',
};

/** The code this invoice was already issued, or '' if it is a new one. */
function issuedCode_(invoice) {
  var key = String(invoice == null ? '' : invoice).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(ISSUED_CODES, key) ? ISSUED_CODES[key] : '';
}

/**
 * The fourteen stages, named as the sheet names them. Stage 0 is "booked" —
 * the shipment exists from the moment the ACCI invoice is created.
 */
var STAGES = [
  { n: 1,  title: 'Docs Created — Kandahar' },
  { n: 2,  title: 'Customs Cleared — Kandahar' },
  { n: 3,  title: 'Departed Kandahar' },
  { n: 4,  title: 'Reached Kabul' },
  { n: 5,  title: 'Passed Salang' },
  { n: 6,  title: 'Reached Hairatan' },
  { n: 7,  title: 'Docs Created — Hairatan' },
  { n: 8,  title: 'Loaded to TAS Truck' },
  { n: 9,  title: 'Customs Cleared — Hairatan' },
  { n: 10, title: 'At Termez Border' },
  { n: 11, title: 'On the Way to Tashkent' },
  { n: 12, title: 'Reached Tashkent Airport' },
  { n: 13, title: 'Booked & Cleared — Awaiting Flight' },
  { n: 14, title: 'Delivered to Delhi' },
];
var STAGE_COUNT = STAGES.length;

/**
 * Header name -> field. Keys are lower-cased with non-alphanumerics removed,
 * so "ACCI Invoice Date (booked)" arrives here as "acciinvoicedatebooked".
 * Only the columns the website needs are listed; everything else in the sheet
 * (S.No, trip IDs, the formula columns, Remarks…) is read past and left alone.
 */
var FIELD_ALIASES = {
  acciinvoiceno: 'invoice_number',
  acciinvoice: 'invoice_number',
  invoiceno: 'invoice_number',
  invoicenumber: 'invoice_number',

  acciinvoicedatebooked: 'invoice_date',
  acciinvoicedate: 'invoice_date',
  invoicedate: 'invoice_date',
  bookeddate: 'invoice_date',

  commodity: 'commodity',
  cartonspkgs: 'cartons',
  cartons: 'cartons',
  pkgs: 'cartons',
  packages: 'cartons',

  grossweightkg: 'gross_weight',
  grossweight: 'gross_weight',
  weight: 'gross_weight',

  kdrtruckplate: 'kdr_plate',
  kdrplate: 'kdr_plate',
  tastruckplate: 'tas_plate',
  tasplate: 'tas_plate',

  awbno: 'awb_no',
  awb: 'awb_no',
  flightno: 'flight_no',
  flight: 'flight_no',
  flightdate: 'flight_date',

  currentstatuswheretheshipmentisnow: 'current_status',
  currentstatus: 'current_status',
  status: 'current_status',

  // Add this column to the sheet — the script fills it in and never clears it.
  trackingno: 'tracking_number',
  trackingnumber: 'tracking_number',
  amanattrackingno: 'tracking_number',
  amtrackingno: 'tracking_number',
};

/** What the admin form may write back. */
var WRITABLE = [
  'invoice_number', 'tracking_number', 'invoice_date', 'commodity', 'cartons',
  'gross_weight', 'kdr_plate', 'tas_plate', 'awb_no', 'flight_no', 'flight_date',
];

/* ------------------------------------------------------------------ */
/* Pure helpers (no Sheets calls — unit-tested from Node)              */
/* ------------------------------------------------------------------ */

function normaliseHeader_(header) {
  // Digits are kept so "1  Docs Created Kandahar" stays distinct from "2 …".
  return String(header == null ? '' : header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The sheet writes "-" where a value does not apply; that is not data. */
function isBlank_(value) {
  var text = String(value == null ? '' : value).trim();
  return text === '' || text === '-' || text === '–' || text === '—' || text.toLowerCase() === 'n/a';
}

/**
 * Header row -> { field: columnIndex }.
 *
 * A stage column is recognised by the number it starts with — "3  Departed
 * Kandahar" is stage 3 — so the wording can be edited in the sheet without
 * breaking the mapping.
 */
function mapHeaders_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var raw = String(headerRow[i] == null ? '' : headerRow[i]).trim();
    if (!raw) continue;

    var stage = /^(\d{1,2})\D/.exec(raw);
    if (stage) {
      var n = Number(stage[1]);
      if (n >= 1 && n <= STAGE_COUNT && map['stage_date_' + n] === undefined) {
        map['stage_date_' + n] = i;
        continue;
      }
    }

    var field = FIELD_ALIASES[normaliseHeader_(raw)];
    if (field && map[field] === undefined) map[field] = i;
  }
  return map;
}

var MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/**
 * Any of the shapes this workbook contains -> 'YYYY-MM-DD'.
 *
 * "11-Aug-26" is parsed here rather than handed to `new Date`, because a
 * two-digit year is engine-dependent: 26 must mean 2026, not 1926.
 */
function toIsoDate_(value) {
  if (isBlank_(value)) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return value.getFullYear() + '-' + pad2_(value.getMonth() + 1) + '-' + pad2_(value.getDate());
  }

  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // 11-Aug-26 / 1 Sep 2026 — the workbook's own format.
  var named = /^(\d{1,2})[\s\-\/]([A-Za-z]{3,})[\s\-\/](\d{2,4})$/.exec(text);
  if (named) {
    var month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
    if (month >= 0) {
      var year = Number(named[3]);
      if (year < 100) year += 2000;
      return year + '-' + pad2_(month + 1) + '-' + pad2_(Number(named[1]));
    }
  }

  // 15/08/2026 and 08/15/2026.
  var numeric = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(text);
  if (numeric) {
    var a = Number(numeric[1]), b = Number(numeric[2]);
    if (a > 12 && b <= 12) return numeric[3] + '-' + pad2_(b) + '-' + pad2_(a);
    return numeric[3] + '-' + pad2_(a) + '-' + pad2_(b);
  }

  return '';
}

/** "11,390.00" -> "11390"; "500" -> "500". Anything unreadable is passed on. */
function toNumberText_(value) {
  if (isBlank_(value)) return '';
  var text = String(value).trim().replace(/,/g, '');
  var n = Number(text);
  if (!isFinite(n)) return String(value).trim();
  // Whole numbers lose their ".00"; a real fraction keeps it.
  return n === Math.floor(n) ? String(Math.round(n)) : String(n);
}

/** Left-pad a number: 31 -> "0031". Longer numbers are left alone. */
function padNumber_(value, width) {
  var text = String(value);
  while (text.length < width) text = '0' + text;
  return text;
}

/** The invoice's own number: "RN-062" -> "062", "MS-020" -> "020". */
function invoicePart_(invoice, rowNumber) {
  var text = String(invoice == null ? '' : invoice).toUpperCase().trim();
  var digits = text.match(/[0-9]+/g);
  if (digits && digits.length) return digits[digits.length - 1];
  var letters = text.replace(/[^A-Z0-9]/g, '');
  return letters || 'R' + rowNumber;
}

function buildTrackingNumber_(invoice, sequence, rowNumber) {
  return (
    TRACKING_PREFIX + '-' +
    padNumber_(sequence, SEQUENCE_PAD) + '-' +
    TRACKING_SEGMENT + '-' +
    invoicePart_(invoice, rowNumber)
  );
}

/** The sequence inside an existing code, or 0 when it is not one of ours. */
function trackingSequence_(code) {
  var pattern = new RegExp('^' + TRACKING_PREFIX + '-(\\d+)-' + TRACKING_SEGMENT + '-', 'i');
  var found = pattern.exec(String(code == null ? '' : code).trim());
  return found ? parseInt(found[1], 10) || 0 : 0;
}

/**
 * One past the highest sequence anywhere — in the sheet OR in the register of
 * codes already issued. Counting only the sheet would hand a new shipment a
 * number a customer is already holding.
 */
function nextSequence_(orders) {
  var highest = SEQUENCE_START - 1;
  var i;
  for (i = 0; i < orders.length; i++) {
    var n = trackingSequence_(orders[i].tracking_number);
    if (n > highest) highest = n;
  }
  for (var invoice in ISSUED_CODES) {
    if (!Object.prototype.hasOwnProperty.call(ISSUED_CODES, invoice)) continue;
    var m = trackingSequence_(ISSUED_CODES[invoice]);
    if (m > highest) highest = m;
  }
  return highest + 1;
}

/**
 * How far a shipment has got: the HIGHEST numbered stage that has a date.
 *
 * Not a count of filled dates — route KDR skips stage 7 and route HRTN skips
 * stages 1 and 2, so counting would under-report both. 0 means booked only.
 */
function stageReached_(stageDates) {
  for (var n = STAGE_COUNT; n >= 1; n--) {
    if (stageDates[n - 1]) return n;
  }
  return 0;
}

/** One sheet row -> the object the website consumes. */
function rowToOrder_(row, headers, rowNumber) {
  var read = function (field) {
    var i = headers[field];
    if (i === undefined || isBlank_(row[i])) return '';
    return String(row[i]).trim();
  };
  var readDate = function (field) {
    var i = headers[field];
    return i === undefined ? '' : toIsoDate_(row[i]);
  };
  var readNumber = function (field) {
    var i = headers[field];
    return i === undefined ? '' : toNumberText_(row[i]);
  };

  var stageDates = [];
  for (var n = 1; n <= STAGE_COUNT; n++) {
    var i = headers['stage_date_' + n];
    stageDates.push(i === undefined ? '' : toIsoDate_(row[i]));
  }

  return {
    row: rowNumber,
    order_id: String(rowNumber),
    invoice_number: read('invoice_number'),
    tracking_number: read('tracking_number'),
    invoice_date: readDate('invoice_date'),
    commodity: read('commodity'),
    cartons: readNumber('cartons'),
    gross_weight: readNumber('gross_weight'),
    kdr_plate: read('kdr_plate'),
    tas_plate: read('tas_plate'),
    awb_no: read('awb_no'),
    flight_no: read('flight_no'),
    flight_date: readDate('flight_date'),
    current_status: read('current_status'),
    stage_dates: stageDates,
    stage: stageReached_(stageDates),
  };
}

/** Lookup accepts either number, ignoring case and stray spaces. */
function matches_(order, code) {
  var wanted = String(code).trim().toLowerCase();
  return (
    String(order.tracking_number).toLowerCase() === wanted ||
    String(order.invoice_number).toLowerCase() === wanted
  );
}

/* ------------------------------------------------------------------ */
/* Sheet access                                                        */
/* ------------------------------------------------------------------ */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (!sh) throw new Error('No sheet found named "' + SHEET_NAME + '".');
  return sh;
}

/**
 * Find the header row. The sheet opens with a merged title and a note before
 * the real headers, so the first row containing the invoice column wins.
 */
function findHeaderRow_(values) {
  for (var i = 0; i < Math.min(values.length, 20); i++) {
    var map = mapHeaders_(values[i]);
    if (map.invoice_number !== undefined) return { index: i, headers: map };
  }
  return { index: -1, headers: {} };
}

/**
 * Give every row without a code one, in place. Marks each row it touched with
 * `assigned` so the caller knows which cells to write back.
 *
 * Three sources, in order of authority:
 *
 *   1. the sheet          a code already in the Tracking No column, including
 *                         one an admin has edited by hand — always kept
 *   2. the register       ISSUED_CODES, for invoices the office numbered
 *                         before the website existed
 *   3. a new sequence     built from the invoice number, carrying on past
 *                         every code in either of the two above
 *
 * A register entry is used once. Where the same invoice appears on several
 * rows — this sheet has a few — the first row keeps the issued code and the
 * rest are given new ones, so no two shipments share a number.
 */
function assignCodes_(orders, taken) {
  var i;
  for (i = 0; i < orders.length; i++) {
    if (orders[i].tracking_number) continue;
    var issued = issuedCode_(orders[i].invoice_number);
    if (issued && !taken[issued]) {
      taken[issued] = true;
      orders[i].tracking_number = issued;
      orders[i].assigned = true;
    }
  }

  var sequence = nextSequence_(orders);
  for (i = 0; i < orders.length; i++) {
    if (orders[i].tracking_number) continue;
    var code = buildTrackingNumber_(orders[i].invoice_number, sequence, orders[i].row);
    while (taken[code]) {
      sequence++;
      code = buildTrackingNumber_(orders[i].invoice_number, sequence, orders[i].row);
    }
    taken[code] = true;
    sequence++;
    orders[i].tracking_number = code;
    orders[i].assigned = true;
  }
}

/**
 * The sheet, read once. Rows without a tracking number are given one and the
 * codes are written back in a single setValues call, not one per row.
 */
function readOrders_() {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  var found = findHeaderRow_(values);
  if (found.index < 0) {
    throw new Error('No header row found — expected a column named "ACCI INVOICE NO".');
  }

  var headers = found.headers;
  var orders = [];
  var taken = {};
  var i;

  for (i = found.index + 1; i < values.length; i++) {
    var order = rowToOrder_(values[i], headers, i + 1);
    // A shipment exists once its invoice number does; anything else is a
    // spacer, a totals line, or the sheet's own notes.
    if (!order.invoice_number) continue;
    if (order.tracking_number) taken[order.tracking_number] = true;
    orders.push(order);
  }

  if (headers.tracking_number === undefined) {
    // No column to keep codes in, but the website still needs them, so they
    // are worked out in memory and simply not written back. Adding the column
    // later makes them permanent; until then they are recomputed each read.
    assignCodes_(orders, taken);
    return { orders: orders, headers: headers, sheet: sh, headerRow: found.index + 1 };
  }

  assignCodes_(orders, taken);
  var missing = [];
  for (i = 0; i < orders.length; i++) {
    if (orders[i].assigned) missing.push(orders[i]);
  }

  if (missing.length) {
    var col = headers.tracking_number + 1;
    var first = missing[0].row;
    var last = missing[missing.length - 1].row;
    var block = sh.getRange(first, col, last - first + 1, 1).getValues();
    for (i = 0; i < missing.length; i++) {
      block[missing[i].row - first][0] = missing[i].tracking_number;
    }
    sh.getRange(first, col, block.length, 1).setValues(block);
  }

  return { orders: orders, headers: headers, sheet: sh, headerRow: found.index + 1 };
}

/** Apply one shipment's changed fields, writing its row in a single call. */
function updateOrder_(id, fields) {
  var data = readOrders_();
  var order = null;
  for (var i = 0; i < data.orders.length; i++) {
    if (String(data.orders[i].order_id) === String(id)) { order = data.orders[i]; break; }
  }
  if (!order) return { error: 'No shipment with id ' + id + '.' };

  var headers = data.headers;
  var sh = data.sheet;
  var width = sh.getLastColumn();
  var row = sh.getRange(order.row, 1, 1, width).getValues()[0];
  var touched = false;

  var write = function (field, value) {
    var col = headers[field];
    // A field the sheet has no column for is skipped, never an error.
    if (col === undefined || col >= width) return;
    row[col] = value == null ? '' : value;
    touched = true;
  };

  for (var k = 0; k < WRITABLE.length; k++) {
    if (Object.prototype.hasOwnProperty.call(fields, WRITABLE[k])) {
      write(WRITABLE[k], fields[WRITABLE[k]]);
    }
  }
  for (var n = 1; n <= STAGE_COUNT; n++) {
    var key = 'stage_date_' + n;
    if (Object.prototype.hasOwnProperty.call(fields, key)) write(key, fields[key]);
  }

  if (touched) sh.getRange(order.row, 1, 1, width).setValues([row]);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Web app                                                             */
/* ------------------------------------------------------------------ */

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function authorised_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  return !!expected && String(token) === expected;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!authorised_(p.token)) return json_({ error: 'unauthorised' });

  try {
    var data = readOrders_();
    if (p.action === 'find') {
      var found = null;
      for (var i = 0; i < data.orders.length; i++) {
        if (matches_(data.orders[i], p.code || '')) { found = data.orders[i]; break; }
      }
      return json_({ ok: true, order: found, stages: STAGES });
    }
    return json_({
      ok: true,
      orders: data.orders,
      stages: STAGES,
      // Lets the website warn instead of silently handing out codes that the
      // sheet has nowhere to keep.
      trackingColumn: data.headers.tracking_number !== undefined,
    });
  } catch (err) {
    return json_({ error: String((err && err.message) || err) });
  }
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ error: 'Body was not valid JSON.' });
  }
  if (!authorised_(body.token)) return json_({ error: 'unauthorised' });

  try {
    if (body.action === 'update') {
      // One writer at a time, so two admins saving together cannot interleave.
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        return json_(updateOrder_(body.id, body.fields || {}));
      } finally {
        lock.releaseLock();
      }
    }
    return json_({ error: 'Unknown action.' });
  } catch (err) {
    return json_({ error: String((err && err.message) || err) });
  }
}

// Lets Node load the pure helpers for testing; ignored by Apps Script.
if (typeof module !== 'undefined') {
  module.exports = {
    STAGES: STAGES, STAGE_COUNT: STAGE_COUNT,
    normaliseHeader_: normaliseHeader_, isBlank_: isBlank_, mapHeaders_: mapHeaders_,
    toIsoDate_: toIsoDate_, toNumberText_: toNumberText_, padNumber_: padNumber_,
    invoicePart_: invoicePart_, buildTrackingNumber_: buildTrackingNumber_,
    trackingSequence_: trackingSequence_, nextSequence_: nextSequence_,
    stageReached_: stageReached_, rowToOrder_: rowToOrder_, matches_: matches_,
    findHeaderRow_: findHeaderRow_, ISSUED_CODES: ISSUED_CODES, issuedCode_: issuedCode_,
    assignCodes_: assignCodes_,
  };
}
