# Generated App Fixture

This directory is a small, checked-in representative of an app created by
`oaf init`. It is a test workspace, **not** a production-ready Next.js app:
it has no installed dependencies, lockfile, build output, database, or external
services.

Future agent-loop tests must copy this directory into a fresh temporary
workspace before reading, writing, or running validation. Never modify this
checked-in source fixture in place.

The fixture deliberately keeps only the generated files needed for realistic
navigation, mutation, and offline validation. `tests/generated-app-fixture.test.mjs`
compares every retained generated file to `getAppTemplates` with a fixed app
name and timestamp, so template changes fail the drift check instead of silently
changing the fixture contract. A single final newline is normalized for
checked-in text-file convention when a template omits one.

Offline validation uses only Node built-ins:

    node oaf/doctor.mjs
    node tests/sanity.test.mjs

Those commands validate skeleton structure only; they do not install packages
or run a real application.
