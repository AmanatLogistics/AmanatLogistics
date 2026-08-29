/**
 * Amanat Logistics — Orders API (Google Apps Script)
 * =================================================
 *
 * Backend for the Orders section of the tracker (/orders and /orders/admin).
 * The Google Sheet is the only database; this script is the whole API.
 *
 * Deploy: Extensions -> Apps Script, paste this file, then
 *         Deploy -> New deployment -> Web app
 *           Execute as:      Me
 *           Who has access:  Anyone
 *         Copy the /exec URL into SHEETS_API_URL, and set the same secret in
 *         both Script Properties (API_TOKEN) and SHEETS_API_TOKEN.
 *
 * "Anyone" is safe here because every request must carry the token: the script
 * answers nothing without it. The token never reaches the browser — the Astro
 * server is what calls this.
 *
 * Endpoints
 *   GET  ?token=…&action=list            every order
 *   GET  ?token=…&action=find&code=…     one order, by tracking OR invoice
 *   POST {token, action:'update', id, fields:{…}}
 *
 * Sheet contract: row 1 is a header row and columns are looked up by name, so
 * they can be reordered or renamed and extra columns are ignored. Everything
 * except Invoice Number is optional.
 */

var SHEET_NAME = 'Orders';
var STAGE_COUNT = 8;

/**
 * Tracking number format: AM-0031-INV-062
 *                         ^^  ^^^^     ^^^
 *                    prefix  sequence  the invoice's number (RN-062)
 *
 * Change these four to change the format everywhere — the parser that reads
 * existing codes back is built from them too, so the two can never disagree.
 */
var TRACKING_PREFIX = 'AM';
var TRACKING_SEGMENT = 'INV';
var SEQUENCE_PAD = 4; // 0031
var SEQUENCE_START = 1;

/** Header name -> internal field. Lower-cased, non-alphanumerics removed. */
var FIELD_ALIASES = {
  orderid: 'order_id',
  id: 'order_id',
  invoicenumber: 'invoice_number',
  invoice: 'invoice_number',
  invoiceno: 'invoice_number',
  trackingnumber: 'tracking_number',
  tracking: 'tracking_number',
  trackingno: 'tracking_number',
  customername: 'customer_name',
  customer: 'customer_name',
  name: 'customer_name',
  phone: 'phone',
  phonenumber: 'phone',
  whatsapp: 'whatsapp_number',
  whatsappnumber: 'whatsapp_number',
  product: 'product',
  productname: 'product',
  item: 'product',
  quantity: 'quantity',
  qty: 'quantity',
  weight: 'weight',
  totalweight: 'weight',
  origin: 'origin',
  from: 'origin',
  destination: 'destination',
  to: 'destination',
  shippingmethod: 'shipping_method',
  method: 'shipping_method',
  orderdate: 'order_date',
  date: 'order_date',
  bookingdate: 'order_date',
  estimateddelivery: 'estimated_delivery',
  estimateddeliverydate: 'estimated_delivery',
  eta: 'estimated_delivery',
  actualdelivery: 'actual_delivery',
  actualdeliverydate: 'actual_delivery',
  delivered: 'actual_delivery',
  delivereddate: 'actual_delivery',
  stage: 'stage',
  step: 'stage',
  currentstage: 'stage',
  status: 'status',
  notes: 'notes',
  note: 'notes',
  remarks: 'notes',
};

/** Fields the Astro admin is allowed to write back. */
var WRITABLE = [
  'invoice_number', 'customer_name', 'phone', 'whatsapp_number', 'product',
  'quantity', 'weight', 'origin', 'destination', 'shipping_method',
  'order_date', 'estimated_delivery', 'actual_delivery', 'stage', 'status', 'notes',
];

/* ------------------------------------------------------------------ */
/* Pure helpers (no Sheets calls — unit-tested from Node)              */
/* ------------------------------------------------------------------ */

function normaliseHeader_(header) {
  // Digits are kept so "Stage 1 Date" stays distinguishable from "Stage 2 Date".
  return String(header == null ? '' : header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Header row -> { field: columnIndex }. Unknown headers are ignored. */
function mapHeaders_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var key = normaliseHeader_(headerRow[i]);
    if (!key) continue;
    // "Stage 3 Date" and friends drive the timeline when they are present.
    var stageDate = /^stage(\d+)date$/.exec(key);
    if (stageDate) {
      map['stage_date_' + Number(stageDate[1])] = i;
      continue;
    }
    var field = FIELD_ALIASES[key];
    if (field && map[field] === undefined) map[field] = i;
  }
  return map;
}

/** Dates arrive as Date objects or text; the API always speaks 'YYYY-MM-DD'. */
function toIsoDate_(value) {
  if (value == null || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
  }
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // Accept the common sheet formats rather than dropping the value.
  var dmy = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(text);
  if (dmy) {
    var d = Number(dmy[1]), m = Number(dmy[2]);
    // Ambiguous D/M vs M/D: a value above 12 settles which is the day.
    if (d > 12 && m <= 12) return dmy[3] + '-' + pad2_(m) + '-' + pad2_(d);
    return dmy[3] + '-' + pad2_(d) + '-' + pad2_(m);
  }
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? '' : toIsoDate_(parsed);
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/**
 * Tracking numbers — "AM-0031-INV-062" for invoice "RN-062".
 *
 * Two parts, and both are worked out from the sheet rather than typed in:
 *
 *   the sequence  a 4-digit running number, one higher than the highest
 *                 already in the sheet, so 0031 is followed by 0032
 *   the invoice   the number out of the invoice itself — "RN-062" gives "062",
 *                 keeping the leading zero exactly as the invoice writes it
 *
 * A code is generated once and written straight back into the sheet, so it is
 * fixed from then on: later reads simply use what is there. That is what keeps
 * the sequence stable when rows are re-sorted or deleted — nothing is ever
 * recalculated from a row's position.
 */

/** Left-pad a number: 31 -> "0031". Longer numbers are left alone. */
function padNumber_(value, width) {
  var text = String(value);
  while (text.length < width) text = '0' + text;
  return text;
}

/** The part the invoice contributes: "RN-062" -> "062", "INV/7" -> "7". */
function invoicePart_(invoice, rowNumber) {
  var text = String(invoice == null ? '' : invoice).toUpperCase().trim();

  // The last run of digits is the invoice's own number; any prefix ("RN-") is
  // the series, which the tracking number does not repeat.
  var digits = text.match(/[0-9]+/g);
  if (digits && digits.length) return digits[digits.length - 1];

  // An invoice with no digits at all still needs something stable.
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

/**
 * The sequence inside an existing code, or 0 when it is not one of ours —
 * a code typed in by hand in some other shape is kept, but does not move the
 * counter.
 */
function trackingSequence_(code) {
  var pattern = new RegExp('^' + TRACKING_PREFIX + '-(\\d+)-' + TRACKING_SEGMENT + '-', 'i');
  var found = pattern.exec(String(code == null ? '' : code).trim());
  return found ? parseInt(found[1], 10) || 0 : 0;
}

/** One past the highest sequence in the sheet — where new codes carry on from. */
function nextSequence_(orders) {
  var highest = SEQUENCE_START - 1;
  for (var i = 0; i < orders.length; i++) {
    var n = trackingSequence_(orders[i].tracking_number);
    if (n > highest) highest = n;
  }
  return highest + 1;
}

/** Stage as 1..STAGE_COUNT. Unreadable or missing values mean stage 1. */
function toStage_(value) {
  var n = parseInt(String(value == null ? '' : value).replace(/[^0-9]/g, ''), 10);
  if (!isFinite(n) || n < 1) return 1;
  return n > STAGE_COUNT ? STAGE_COUNT : n;
}

/** One sheet row -> the object the website consumes. */
function rowToOrder_(row, headers, rowNumber) {
  var read = function (field) {
    var i = headers[field];
    return i === undefined || row[i] == null ? '' : String(row[i]).trim();
  };
  var readDate = function (field) {
    var i = headers[field];
    return i === undefined ? '' : toIsoDate_(row[i]);
  };

  var stageDates = [];
  for (var n = 1; n <= STAGE_COUNT; n++) {
    var i = headers['stage_date_' + n];
    stageDates.push(i === undefined ? '' : toIsoDate_(row[i]));
  }

  return {
    row: rowNumber,
    order_id: read('order_id') || String(rowNumber),
    invoice_number: read('invoice_number'),
    tracking_number: read('tracking_number'),
    customer_name: read('customer_name'),
    phone: read('phone'),
    whatsapp_number: read('whatsapp_number') || read('phone'),
    product: read('product'),
    quantity: read('quantity'),
    weight: read('weight'),
    origin: read('origin'),
    destination: read('destination'),
    shipping_method: read('shipping_method'),
    order_date: readDate('order_date'),
    estimated_delivery: readDate('estimated_delivery'),
    actual_delivery: readDate('actual_delivery'),
    stage: toStage_(read('stage')),
    status: read('status'),
    notes: read('notes'),
    stage_dates: stageDates,
  };
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
 * The sheet, read once. Rows missing a tracking number are given one and the
 * codes are written back in a single setValues call rather than one per row.
 */
function readOrders_() {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { orders: [], headers: {}, sheet: sh };

  var headers = mapHeaders_(values[0]);
  var orders = [];
  var taken = {};
  var i;

  for (i = 1; i < values.length; i++) {
    var order = rowToOrder_(values[i], headers, i + 1);
    // A row with nothing in it at all is a spacer, not an order.
    if (!order.invoice_number && !order.tracking_number && !order.customer_name) continue;
    if (order.tracking_number) taken[order.tracking_number] = true;
    orders.push(order);
  }

  // Assign codes only where one is missing, carrying on from the highest
  // sequence already in the sheet, then write the column back once.
  var missing = [];
  var sequence = nextSequence_(orders);
  for (i = 0; i < orders.length; i++) {
    if (orders[i].tracking_number) continue;
    var code = buildTrackingNumber_(orders[i].invoice_number, sequence, orders[i].row);
    // A code somebody typed by hand could already sit on this sequence; step
    // past it rather than issuing the same number twice.
    while (taken[code]) {
      sequence++;
      code = buildTrackingNumber_(orders[i].invoice_number, sequence, orders[i].row);
    }
    taken[code] = true;
    sequence++;
    orders[i].tracking_number = code;
    missing.push(orders[i]);
  }

  if (missing.length && headers.tracking_number !== undefined) {
    var col = headers.tracking_number + 1;
    var first = missing[0].row;
    var last = missing[missing.length - 1].row;
    var block = sh.getRange(first, col, last - first + 1, 1).getValues();
    for (i = 0; i < missing.length; i++) {
      block[missing[i].row - first][0] = missing[i].tracking_number;
    }
    sh.getRange(first, col, block.length, 1).setValues(block);
  }

  return { orders: orders, headers: headers, sheet: sh };
}

/** Apply one order's changed fields. Writes the row's cells in a single call. */
function updateOrder_(id, fields) {
  var data = readOrders_();
  var order = null;
  for (var i = 0; i < data.orders.length; i++) {
    if (String(data.orders[i].order_id) === String(id)) { order = data.orders[i]; break; }
  }
  if (!order) return { error: 'No order with id ' + id + '.' };

  var headers = data.headers;
  var sh = data.sheet;
  var width = sh.getLastColumn();
  var row = sh.getRange(order.row, 1, 1, width).getValues()[0];
  var touched = false;

  for (var k = 0; k < WRITABLE.length; k++) {
    var field = WRITABLE[k];
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    var col = headers[field];
    // Silently skip a field the sheet has no column for, rather than failing.
    if (col === undefined || col >= width) continue;
    row[col] = fields[field] == null ? '' : fields[field];
    touched = true;
  }

  // Optional per-stage dates, when the sheet carries those columns.
  for (var n = 1; n <= STAGE_COUNT; n++) {
    var key = 'stage_date_' + n;
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    var sc = headers[key];
    if (sc === undefined || sc >= width) continue;
    row[sc] = fields[key] == null ? '' : fields[key];
    touched = true;
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

function matches_(order, code) {
  var wanted = String(code).trim().toLowerCase();
  return (
    String(order.tracking_number).toLowerCase() === wanted ||
    String(order.invoice_number).toLowerCase() === wanted
  );
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!authorised_(p.token)) return json_({ error: 'unauthorised' });

  try {
    if (p.action === 'find') {
      var found = null;
      var orders = readOrders_().orders;
      for (var i = 0; i < orders.length; i++) {
        if (matches_(orders[i], p.code || '')) { found = orders[i]; break; }
      }
      return json_({ ok: true, order: found });
    }
    // Default to the full list so a bare token URL is still useful.
    return json_({ ok: true, orders: readOrders_().orders });
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
    mapHeaders_: mapHeaders_, toIsoDate_: toIsoDate_, toStage_: toStage_, rowToOrder_: rowToOrder_,
    matches_: matches_, normaliseHeader_: normaliseHeader_, padNumber_: padNumber_,
    invoicePart_: invoicePart_, buildTrackingNumber_: buildTrackingNumber_,
    trackingSequence_: trackingSequence_, nextSequence_: nextSequence_,
  };
}
