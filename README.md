# Alpaca alert watch

This package observes caller-selected decision journals and failed-unit readings,
batches newly observed alerts, and uses the existing Turntide admin-alert transport.
It does not place trades or change trading timers. Live transport, host access,
credentials and deployment require their separately authorized operating context.

## Runtime owners

The command selects the published JavaScript operation runtime 0.2.0 and Node
>=24.2. The default alert function comes from
`turntide-islands-discord-platform/admin-alert` 0.1.0. The obsolete unexported local
Discord implementation is removed; its original fixture cases now exercise that
actual supplier. The unused Koios dependency is removed. Published files contain
only source and scripts, never instance cursor/lock files under `data/state`.

## Journal framing and cursor contract

The input remains UTF-8 NDJSON, following the newline framing in
[NDJSON 1.0.0](https://github.com/ndjson/ndjson-spec#3-functional-specification).
One byte snapshot determines both parsing and the returned offset. Only complete
LF-terminated frames advance the cursor; CRLF is accepted. An incomplete trailing
JSON value or UTF-8 character remains pending until its delimiter arrives. A
smaller replacement file resets the cursor to zero. Offsets must be nonnegative
safe integers. The existing policy of ignoring malformed complete records is
retained; this change does not claim strict validation of every producer record.

The previous implementation skipped an incomplete suffix but advanced to the file
size, losing that observation when a concurrent writer finished it. Regression
cases cover partial JSON, a valid JSON value awaiting its delimiter, split UTF-8,
CRLF, repeat reads, truncation and invalid offsets. Domain record fields are
preserved; presentation summaries are not substituted for the original journal.

## Qualification and limits

Run `npm test` with the selected published suppliers. Tests use synthetic journals,
temporary directories, fake systemd output and injected transports; the actual CLI
is exercised only for help and malformed-input refusal. No real host command,
account read, alert message or inference request is required. Packed qualification
uses the same source-owned tests separately from the published source files.

The retained default instance paths and delivery/offset behavior still require
installed-consumer receiving. An ambiguous remote send failure is not exactly-once
delivery evidence. A source merge does not deploy a timer or send an alert.
