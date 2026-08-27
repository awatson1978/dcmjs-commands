# dcmjs-commands

Command line tools for [dcmjs](https://github.com/awatson1978/dcmjs) and
DICOMweb: parse, dump, convert, anonymize, validate, and filter DICOM
Part 10 files; rebuild DICOM from PNG/JPEG exports with DICOM JSON
metadata; wrap and extract PDFs (the PACS "PDF in / PDF out" workflow);
apply FHIR Patient demographics to DICOM streams; build DICOMDIR filesets
and Static-DICOMweb trees (optionally with a FHIR layer — the
dicomweb+fhir format); and expose all of it to LLM toolchains as an MCP
server.

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

> Status note: the 2026-08 feature arc (image convert, dicomdir, dicomweb
> publishing, FHIR demographics, dicomweb+fhir, MCP server) lands via the
> open PR stack #6–#11 here and #52–#54 in the dcmjs fork; this README
> describes the line with that stack applied.

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
dcmjs dump scan.dcm --json     # naturalized dataset as pretty JSON
```

### instance

```bash
dcmjs instance scan.dcm --pretty   # tag-keyed DICOM JSON of the dict
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

Streaming tag surgery — memory bounded by the largest fragment, so it works
unchanged on multi-GB inputs:

```bash
dcmjs filter in.dcm -o out.dcm --set 00100010=DOE^JANE --drop 00104000

# Apply a FHIR Patient resource to the patient module. Insert-or-replace:
# de-identified files whose patient tags were removed still receive the
# full module; fields absent from the resource are written empty.
dcmjs filter in.dcm -o out.dcm --fhir-patient patient.json

# Custom filters: a JS module speaking the event-stream vocabulary
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

Build a DICOMDIR (Media Storage Directory) with exact byte offsets for a
directory of DICOM files:

```bash
dcmjs dicomdir ./study                  # writes ./study/DICOMDIR
dcmjs dicomdir ./study --copy ./cd      # conformant CD tree: DICOM/IM000001...
dcmjs dicomdir ./study --json           # dry run: record tree as JSON
```

### dicomweb

Publish a directory of DICOM files as a Static-DICOMweb tree — the layout
OHIF and other DICOMweb viewers read directly. With `--fhir`, also write a
FHIR layer (the **dicomweb+fhir** format): Patient, ImagingStudy, a DICOM
WADO-RS Endpoint, and a transaction `Bundle.json` any FHIR server loads in
one POST.

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

Every verb above is also a typed MCP tool (`dicom_dump`, `dicom_instance`,
`dicom_validate`, `dicom_convert`, `dicom_anonymize`, `dicom_filter`,
`dicomdir_create`, `dicomweb_create`), served over stdio:

```bash
claude mcp add dcmjs -- dcmjs-mcp     # Claude Code; any MCP client works
```

Design contract: tool descriptions state defaults and conformance behavior;
errors are corrective (state → consequence → the parameter to change);
warnings ride in every result payload; destructive/derived operations offer
`dry_run`; binary results are always file paths, never inline bytes.

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
`studies/` under the base directory:

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
