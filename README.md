# dcmjs-commands

Command line tools for [dcmjs](https://github.com/awatson1978/dcmjs) and
DICOMweb: parse, dump, convert, anonymize, and validate DICOM Part 10 files,
wrap and extract PDFs (the PACS "PDF in / PDF out" workflow), emit FHIR and
DICOMweb JSON, and download studies from DICOMweb servers into the Static
DICOMweb file layout.

Three bins ship with the package:

| Bin | Purpose |
|-----|---------|
| `dcmjs` | local Part 10 files: dump, instance, convert, anonymize, validate, filter |
| `dicomwebjs` | DICOMweb sources: dump, instance, download, part10 |
| `dimsejs` | DIMSE networking — **experimental stub, not implemented** |

For a worked tour of every command with runnable examples, see
[EXAMPLES.md](EXAMPLES.md).

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

# optional: global link so `dcmjs` / `dicomwebjs` are on your PATH
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

# PDF in: wrap a PDF into a DICOM Encapsulated PDF instance
dcmjs convert report.pdf --to dcm -o report.dcm \
    --patient-name "Doe^Jane" --patient-id MRN-42 --title "Discharge Summary"

# PDF out: extract the PDF from a PACS-sourced Encapsulated PDF instance
dcmjs convert report.dcm --to pdf -o report.pdf

# PDFs as FHIR DocumentReference (also works for .dcm carrying a PDF)
dcmjs convert report.pdf --to fhir
```

### anonymize

```bash
dcmjs anonymize scan.dcm -o anon.dcm    # default output: <input>-anon.dcm
```

### validate

```bash
dcmjs validate ./studies/               # recursive; exit 1 on any failure
dcmjs validate scan.dcm --json report.json --quiet
```

## dicomwebjs commands

### dump / instance

```bash
# Series query from a DICOMweb server
dicomwebjs dump https://d33do7qe4w26qo.cloudfront.net/dicomweb/studies/1.3.6.1.4.1.14519.5.2.1.4792.2001.105216574054253895819671475627/series

# Metadata retrieve
dicomwebjs dump https://d33do7qe4w26qo.cloudfront.net/dicomweb/studies/1.3.6.1.4.1.14519.5.2.1.4792.2001.105216574054253895819671475627/series/1.3.6.1.4.1.14519.5.2.1.4792.2001.323835191362867057104216682000/metadata

# Local Static DICOMweb files (plain or .gz)
dicomwebjs dump studies/<studyUID>/series/<seriesUID>/metadata.gz
```

### download

Downloads a study into the Static DICOMweb file layout. Bulkdata is stored
under `studies/<studyUID>/bulkdata/` with `../../bulkdata/<hash-path>`
relative references.

```bash
dicomwebjs download https://server/dicomweb -S <StudyInstanceUID> -d ~/dicomweb
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
