# OAF App Structure

The generated app is a single-app repository. Keep routes in `app/`, shared UI
in `components/`, domain slices in `features/`, small shared helpers in `lib/`,
server-only shared logic in `server/`, and schema/client/migrations in `db/`.

`oaf/` is factory-owned metadata. It contains the app record, stack marker,
docs-pack marker, and future receipts. Do not casually create top-level
directories or edit OAF metadata.
