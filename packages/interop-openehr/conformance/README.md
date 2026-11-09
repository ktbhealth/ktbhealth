# openEHR conformance fixtures

`openehr_rm_1.1.0_all.json.gz` — the official openEHR ITS-JSON schema for
RM 1.1.0 (single-file "all" bundle, JSON Schema draft-07), gzipped, used by
the tests to validate the exported EXTRACT and every versioned object in it.

- Source: https://github.com/openEHR/specifications-ITS-JSON
  (`components/openehr_rm_1.1.0_all.json`, `$id`
  https://specifications.openehr.org/releases/ITS-JSON/latest/components/openehr_rm_1.1.0_all.json)
- License: Apache 2.0 (openEHR Foundation)
- sha256 (uncompressed): `57595ad01c7d58e46e691c09c0d3caba81c24e6ddd9b19d5b8bfc803d2523927`

The schema checks the Reference Model only. Archetype constraints are not
checked (the demographic archetypes are CKM v0 drafts; see DEVIATIONS in
src/person.ts), and a CDR import additionally needs an operational template.
