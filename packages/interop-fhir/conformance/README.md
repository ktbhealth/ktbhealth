# FHIR R4 conformance fixtures

`fhir.schema.json.gz` — the official HL7 FHIR R4 (4.0.1) JSON Schema, gzipped,
used by the tests to validate every exported Bundle.

- Source: https://hl7.org/fhir/R4/fhir.schema.json.zip
- License: HL7 FHIR is published under CC0 (https://hl7.org/fhir/R4/license.html)
- sha256 (uncompressed): `2230406893b4cf002a4ee1e5e2bbeca22ac5d2d4931b3e9ef7b9594bbc376a01`

The schema checks structure and datatypes only. FHIRPath invariants,
terminology bindings and profiles (BR Core) need the official validator:

```sh
java -jar validator_cli.jar export.fhir-r4.json -version 4.0.1 \
  -ig https://hl7.org.br/fhir/core/package.tgz
```
