# dcmjs-commands

Command-line tools, built on [dcmjs](https://github.com/awatson1978/dcmjs),
for working with medical imaging files — DICOM on disk (*Part 10* files,
the `.dcm` format scanners and PACS systems produce) and DICOM on the web
(*DICOMweb*, the JSON-and-HTTP API for the same data).

What you can do with them:

- **Inspect and check**: dump any file's contents, validate whole
  directory trees, emit standard DICOM JSON.
- **Convert**: DICOM to and from JSON, FHIR, and PDF; rebuild real DICOM
  instances from PNG/JPEG exports and their saved metadata.
- **Rewrite safely**: change or remove tags in a streaming pass (any file
  size), apply FHIR Patient demographics, strip PHI with an auditable
  dry-run.
- **Package and publish**: build DICOMDIR filesets for interchange media,
  or Static-DICOMweb trees that web viewers like OHIF read directly —
  optionally with a FHIR layer (the *dicomweb+fhir* format) so FHIR
  systems can discover the study too.
- **Hand it to an AI agent**: every verb is also available as a typed MCP
  tool, with guardrails designed for machine callers.

Four bins ship with the package:

| Bin | Purpose |
|-----|---------|
| `dcmjs` | local Part 10 files: dump, instance, convert, anonymize, validate, filter, dicomdir, dicomweb |
| `dcmjs-mcp` | the same verbs as MCP tools over stdio, for LLM agents |
| `dicomwebjs` | DICOMweb sources: dump, instance, download, part10 |
| `dimsejs` | DIMSE networking — **experimental stub, not implemented** |

For a worked tour of every command with runnable examples, see
[EXAMPLES.md](EXAMPLES.md). For where the tooling is headed (library-level
APIs, pipeable CLI, SMART-context inputs), see
[architecture-design.md](architecture-design.md).

> Reviewer note: the 2026-08 feature arc (image convert, dicomdir, dicomweb
> publishing, FHIR demographics, dicomweb+fhir, MCP server) is merged on
> this branch. The PR chain remains open for per-feature inspection —
> #6–#11 here and #52–#55 in the dcmjs fork, each showing its own diff.

## Install

Requires Node >= 22.13. The `dcmjs` dependency points at the sibling
checkout `file:../dcmjs` (the awatson1978 fork, `development` branch), which
must be built first:

```bash
# sibling checkout, one time
git clone -b development https://github.com/awatson1978/dcmjs.git ../dcmjs
(cd ../dcmjs && pnpm install && pnpm run build)

# then this package
npm install

# optional: global link so the bins are on your PATH
npm link
```

## dcmjs commands

Run `dcmjs --help` for the command list, and `dcmjs <command> --help` for
the full options of each command. The sections below show common
invocations, not every flag.

### dump

```bash
dcmjs dump scan.dcm            # tag lines: (GGGG,EEEE) VR Keyword: value
dcmjs dump scan.dcm --json     # readable JSON: keyword keys, binary summarized
```

### instance

```bash
dcmjs instance scan.dcm --pretty   # standard DICOM JSON — what a DICOMweb
                                   # /metadata endpoint returns
```

### convert

```bash
dcmjs convert scan.dcm --to fhir --pretty        # Patient + ImagingStudy
dcmjs convert scan.dcm --to dicomweb-json        # DICOM JSON model
dcmjs convert scan.dcm --to json                 # naturalized JSON
dcmjs convert scan.dcm --to dcm -o copy.dcm      # Part 10 round trip

# Image in: rebuild DICOM from a PNG/JPEG export. A same-basename .json
# (DICOM JSON metadata, any wrapper document) is discovered automatically;
# when it identifies the original instance, the result is a conformant
# derived instance (fresh SOPInstanceUID, DERIVED\SECONDARY,
# SourceImageSequence — original UIDs are never reused for rebuilt pixels).
dcmjs convert slice.png --to dcm -o rebuilt.dcm
dcmjs convert slice.png --to dcm -o rebuilt.dcm --restore-values
    # invert WindowCenter/Width to approximate the original stored values

# PDF in: wrap a PDF into a DICOM Encapsulated PDF instance
dcmjs convert report.pdf --to dcm -o report.dcm \
    --patient-name "Doe^Jane" --patient-id MRN-42 --title "Discharge Summary"

# PDF out: extract the PDF from a PACS-sourced Encapsulated PDF instance
dcmjs convert report.dcm --to pdf -o report.pdf

# Any input kind: apply a FHIR Patient's demographics while converting
dcmjs convert slice.png --to dcm -o rebuilt.dcm --fhir-patient patient.json
```

### filter

Copy a file while rewriting or removing tags in a streaming pass. Memory
stays bounded by the largest piece of pixel data rather than the file, so
the same command works unchanged on multi-gigabyte inputs:

```bash
dcmjs filter in.dcm -o out.dcm --set 00100010=DOE^JANE --drop 00104000

# Apply a FHIR Patient resource to the patient identity tags.
# Insert-or-replace: de-identified files whose patient tags were removed
# still receive the full set; fields absent from the resource are written
# empty, so nothing of the previous identity survives.
dcmjs filter in.dcm -o out.dcm --fhir-patient patient.json

# Custom filters: a JS module whose methods intercept the streaming
# reader's events (startElement, value, binaryFragment, ...)
dcmjs filter in.dcm -o out.dcm --module ./my-filter.mjs
```

### anonymize

```bash
dcmjs anonymize scan.dcm -o anon.dcm    # default output: <input>-anon.dcm
dcmjs anonymize scan.dcm --dry-run      # tag-level change list as JSON, no write
```

The default rule set covers standard PHI tags only — private tags and
burned-in pixel data are not touched; audit before release.

### validate

```bash
dcmjs validate ./studies/               # recursive; exit 1 on any failure
dcmjs validate scan.dcm --json report.json --quiet
```

### dicomdir

Build a DICOMDIR — the index file on DICOM interchange media (CDs, DVDs,
USB filesets), whose records point at every file by byte position — for a
directory of DICOM files, with the offsets computed exactly:

```bash
dcmjs dicomdir ./study                  # writes ./study/DICOMDIR
dcmjs dicomdir ./study --copy ./cd      # conformant CD tree: DICOM/IM000001...
dcmjs dicomdir ./study --json           # dry run: record tree as JSON
```

### dicomweb

Publish a directory of DICOM files as a Static-DICOMweb tree — the
DICOMweb API's responses pre-computed as files on disk, which OHIF and
other web viewers read directly from any static file host. With `--fhir`,
also write a FHIR layer (the **dicomweb+fhir** format): a Patient, an
ImagingStudy, an Endpoint saying where the pixels are served, and a
transaction `Bundle.json` that loads the whole set into any FHIR server
with one POST.

```bash
dcmjs dicomweb ./study -d ./web                    # every study found
dcmjs dicomweb ./study -d ./web --fhir \
    --fhir-patient patient.json \
    --wado-root https://pacs.example.org/dicomweb

curl -X POST https://fhir.example.org/ \
    -H 'Content-Type: application/fhir+json' -d @./web/fhir/Bundle.json
```

A provided `--fhir-patient` is embedded verbatim as the authoritative
Patient; if it disagrees with the instance tags you get a warning (run
`dcmjs filter --fhir-patient` first when the instances should match).
`--fhir-encounter` embeds an Encounter and references it from
`ImagingStudy.encounter`.

## dcmjs-mcp — MCP server for LLM toolchains

MCP is the standard protocol by which AI assistants call external tools.
`dcmjs-mcp` serves every verb above as a typed tool (`dicom_dump`,
`dicom_instance`, `dicom_validate`, `dicom_convert`, `dicom_anonymize`,
`dicom_filter`, `dicomdir_create`, `dicomweb_create`), so an agent can
inspect, convert, and publish DICOM without shell access:

```bash
claude mcp add dcmjs -- dcmjs-mcp     # Claude Code; any MCP client works
```

The design contract is "help the agent make the correct choice": tool
descriptions state defaults and conformance behavior rather than just
labeling; errors are corrective (they state what happened, what it means,
and the exact parameter to change); warnings ride in every result payload
so partial successes are visible; destructive or derived operations offer
`dry_run`; and binary results are always file paths, never inline bytes.
The tool handlers are the same functions the CLI runs, so the two
surfaces cannot drift apart.

## dicomwebjs commands

### dump / instance

```bash
# Series query from a DICOMweb server
dicomwebjs dump https://server/dicomweb/studies/<studyUID>/series

# Metadata retrieve
dicomwebjs dump https://server/dicomweb/studies/<studyUID>/series/<seriesUID>/metadata

# Local Static DICOMweb files (plain or .gz)
dicomwebjs dump studies/<studyUID>/series/<seriesUID>/metadata.gz
```

### download

Downloads a study into the Static DICOMweb file layout. The source may be
a DICOMweb server URL, a Static-DICOMweb tree, **or a plain directory of
Part 10 files** (auto-detected by DICM magic). `--fhir` writes the FHIR
layer alongside; `--verbose` narrates per-instance progress.

```bash
dicomwebjs download https://server/dicomweb -S <StudyInstanceUID> -d ~/dicomweb
dicomwebjs download ./study -S <StudyInstanceUID> -d ~/dicomweb   # Part 10 dir
```

### part10

Converts DICOMweb data into binary Part 10 files.

```bash
dicomwebjs part10 https://server/dicomweb -S <StudyInstanceUID> -d ./downloads
```

### Static DICOMweb file locations

Tree-structured file sources follow the Static DICOMweb format, rooted at
`studies/` under the base directory. Each file is a pre-computed DICOMweb
response — QIDO is the query/search half of the API, WADO the retrieval
half:

- `studies/index.json.gz` — QIDO response index for the studies
- `studies/<studyUID>/index.json.gz` — the study's index entry
- `studies/<studyUID>/series/index.json.gz` — the series QIDO response
- `studies/<studyUID>/series/<seriesUID>/metadata.gz` — the metadata WADO response
- `studies/<studyUID>/bulkdata/...` — bulkdata files
- `studies/<studyUID>/series/<seriesUID>/instances/<sopUID>/frames/<n>.mht[.gz]` — frame data

Uncompressed variants are accepted, but will not be found on a search.

## Development

```bash
npm test              # jest (native ESM)
npm run lint          # eslint
npm run format:check  # prettier
```

Tests use the committed fixture `test/fixtures/sample-dicom.dcm` plus
synthesized data — no network and no submodules. CI (GitHub Actions) checks
out and builds the sibling dcmjs fork before running the suite on Node 22
and 24.
