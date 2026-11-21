# csv-reader-speed-01-run-20261121 — fast CSV reader

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/ernaXlife/csv-reader-speed-01-run-20261121-v1-akun5/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/ernaXlife/csv-reader-speed-01-run-20261121-v1-akun5/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast drop-in replacement for csv-reader 1.0.0's `readCsv`, built for the
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty on make.fun. It returns exactly what csv-reader 1.0.0 returns for every
input — same `{columns, rows, errors}`, same five error codes, same line and
row numbers — but roughly 7x faster on the practice set, by scanning with
native `RegExp`/`indexOf` searches and `slice` instead of reading one
character at a time.

- `main.ts` — the driver: reads `/input/cases.json`, answers each case with
  `run()` from `solve.js`, writes `/output/answers.json`.
- `solve.js` — the fast parser (ES module, stdlib-only, no dependencies).
- `package.json` — `{"type": "module"}` so Node parses `solve.js` as an ES
  module without a warning or re-parse.

Validated: 6/6 practice cases match both `expected.json` and the vendor
`readCsv`, plus 0 mismatches across 23,454 edge/fuzz cases and 24 full-size
files drawn with the kit's own generator.
