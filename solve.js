// Fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01-run-20261121).
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the
// same input: {columns, rows, errors}. The semantics are the vendor's, kept
// line by line (see VALIDATION.md for the tricky details preserved):
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled
//     ("" inside is one quote, each CRLF or lone CR inside is LF); what
//     follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's
//     width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on (every LF, CRLF and lone CR inside a quoted field counted),
//     row its record's index in rows (null for the header), in the order met.
//
// Speed comes from native scanning instead of the vendor's character-by-
// character concatenation: unquoted fields are found with one regex search
// for the next delimiter (RegExp.prototype.test, whose lastIndex gives the
// match position without allocating a match array) and taken by slice;
// quoted fields are found with indexOf('"') and taken by slice, with a slow
// path only for the rare segments that hold a line break. No per-field
// object is allocated: the current field's result travels in closure
// variables (fValue, fEnded, fAdded). Deterministic, stdlib-only, no clock,
// no randomness, no locale.

/** The next unquoted-field delimiter: comma, LF or CR. One native search per field. */
const DELIM = /[,\n\r]/g;

/** How a field ended: 0 = comma (the record goes on), 1 = line break, 2 = end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters
  // were kept after its starting value (for the quote_junk check).
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `init` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets fValue, fEnded and
  // fAdded (the characters kept after `init`); updates pos and line.
  function readUnquoted(init) {
    DELIM.lastIndex = pos;
    if (!DELIM.test(text)) {
      fAdded = n - pos;
      fValue = init === '' ? text.slice(pos) : init + text.slice(pos);
      pos = n;
      fEnded = END;
      return;
    }
    const i = DELIM.lastIndex - 1;
    const d = text.charCodeAt(i);
    if (d === 44) {
      // ','
      fAdded = i - pos;
      fValue = init === '' ? text.slice(pos, i) : init + text.slice(pos, i);
      pos = i + 1;
      fEnded = COMMA;
      return;
    }
    if (d === 10) {
      // '\n'
      fAdded = i - pos;
      fValue = init === '' ? text.slice(pos, i) : init + text.slice(pos, i);
      pos = i + 1;
      line += 1;
      fEnded = LINE_BREAK;
      return;
    }
    // '\r'
    if (text.charCodeAt(i + 1) === 10) {
      // CRLF: one line break.
      fAdded = i - pos;
      fValue = init === '' ? text.slice(pos, i) : init + text.slice(pos, i);
      pos = i + 2;
      line += 1;
      fEnded = LINE_BREAK;
      return;
    }
    // A stray CR: the slow path. The field goes on past it, dropping it,
    // and each further stray CR the same way; segments are joined once.
    error('stray_cr');
    const segs = init === '' ? [] : [init];
    segs.push(text.slice(pos, i));
    let added = i - pos;
    pos = i + 1;
    for (;;) {
      DELIM.lastIndex = pos;
      if (!DELIM.test(text)) {
        segs.push(text.slice(pos));
        added += n - pos;
        pos = n;
        fValue = segs.join('');
        fAdded = added;
        fEnded = END;
        return;
      }
      const j = DELIM.lastIndex - 1;
      const e = text.charCodeAt(j);
      if (e === 44) {
        segs.push(text.slice(pos, j));
        added += j - pos;
        pos = j + 1;
        fValue = segs.join('');
        fAdded = added;
        fEnded = COMMA;
        return;
      }
      if (e === 10) {
        segs.push(text.slice(pos, j));
        added += j - pos;
        pos = j + 1;
        line += 1;
        fValue = segs.join('');
        fAdded = added;
        fEnded = LINE_BREAK;
        return;
      }
      if (text.charCodeAt(j + 1) === 10) {
        segs.push(text.slice(pos, j));
        added += j - pos;
        pos = j + 2;
        line += 1;
        fValue = segs.join('');
        fAdded = added;
        fEnded = LINE_BREAK;
        return;
      }
      error('stray_cr');
      segs.push(text.slice(pos, j));
      added += j - pos;
      pos = j + 1;
    }
  }

  // A quoted segment [cur, q) as its value contribution: CRLF and lone CR
  // each become one LF, and `line` advances by the number of line breaks.
  // The common case (no line break in the segment) is one slice.
  function quotedSegment(cur, q) {
    const nl = text.indexOf('\n', cur);
    if (nl !== -1 && nl < q) return quotedSegmentSlow(cur, q);
    const cr = text.indexOf('\r', cur);
    if (cr !== -1 && cr < q) return quotedSegmentSlow(cur, q);
    return text.slice(cur, q);
  }

  // A quoted segment that holds a line break: each CRLF, lone CR and lone LF
  // is one LF in the value and one line. (A CRLF is never split across two
  // segments: segments end at quotes, and a CR just before a quote is lone,
  // a LF just after one is lone.)
  function quotedSegmentSlow(cur, q) {
    const seg = text.slice(cur, q);
    let lines = 0;
    const converted = seg.replace(/\r\n?|\n/g, () => {
      lines += 1;
      return '\n';
    });
    line += lines;
    return converted;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue and
  // fEnded; updates pos and line. A quote that never closes is a literal
  // character and the text after it is read again as unquoted.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let cur = pos + 1;
    let segs = null;
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as an unquoted field. The line count from
        // the failed scan is undone (line = openLine) so the re-read counts
        // the lines as unquoted text counts them.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquoted('"');
        return;
      }
      const seg = quotedSegment(cur, q);
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        if (segs === null) segs = [];
        segs.push(seg, '"');
        cur = q + 2;
        continue;
      }
      // The closing quote.
      const value = segs === null ? seg : (segs.push(seg), segs.join(''));
      const after = q + 1;
      if (after >= n) {
        pos = n;
        fValue = value;
        fEnded = END;
        return;
      }
      const c = text.charCodeAt(after);
      if (c === 44) {
        pos = after + 1;
        fValue = value;
        fEnded = COMMA;
        return;
      }
      if (c === 10) {
        pos = after + 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        return;
      }
      if (c === 13 && text.charCodeAt(after + 1) === 10) {
        pos = after + 2;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break (quote_junk when the field ends, and only
      // when at least one character was kept: stray CRs alone do not count).
      pos = after;
      readUnquoted(value);
      if (fAdded > 0) error('quote_junk');
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    for (;;) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
