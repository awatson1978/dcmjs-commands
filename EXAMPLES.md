# dcmjs-commands by example

A worked tour of every command. The design goal throughout: work *streaming* —
files pass through the tools piece by piece, so the same command that handles a
500 KB CT slice handles a 21.8 GB surgical video without loading it into
memory. Every example below was run against real files before being written
down.

Four binaries:

| binary | purpose |
|---|---|
| `dcmjs` | local Part 10 files: inspect, convert, validate, anonymize, filter, dicomdir |
| `dcmjs-mcp` | the same verbs as MCP tools for LLM toolchains (stdio server) |
| `dicomwebjs` | DICOMweb sources (http or Static-DICOMWeb file trees): dump, instance, study transfer |
| `dimsejs` | DIMSE networking (stub — placeholder surface) |

Install per the [README](README.md#install) — in short: build the sibling
`../dcmjs` checkout first (`pnpm install && pnpm run build`), then
`npm install` here. Rebuild dcmjs after changing its `src/`, or the CLI
silently sees the old version. Run the tests with `npm test` (it sets the
`--experimental-vm-modules` flag Jest needs for ESM).

---

## `dcmjs dump` — look inside a file

The quickest way to see what a DICOM file contains. Default output is one line
per element; `--json` gives the naturalized dataset (human-friendly names,
binary summarized).

```bash
dcmjs dump study/slice001.dcm
# (0008,0060) CS Modality: MR
# (0010,0010) PN PatientName: Fall 3
# (7FE0,0010) OB PixelData: [OB 524288 bytes]
# ...

dcmjs dump study/slice001.dcm --json | jq .PatientName
```

## `dcmjs instance` — tag-keyed DICOM JSON

The same file as standards-shaped DICOM JSON (tag keys, `vr`/`Value` entries) —
the form DICOMweb metadata services speak.

```bash
dcmjs instance study/slice001.dcm --pretty
# {
#   "00080060": { "vr": "CS", "Value": ["MR"] },
#   ...
```

## `dcmjs convert` — between representations

Input kind is auto-detected from the file; `--to` picks the target.

```bash
# DICOM → naturalized JSON on stdout
dcmjs convert slice001.dcm --to json --pretty

# DICOM → a FHIR resource (ImagingStudy/DocumentReference as appropriate)
dcmjs convert report.dcm --to fhir --fhir-version R4B --pretty

# DICOM → the PDF embedded in an Encapsulated PDF instance
dcmjs convert report.dcm --to pdf -o report.pdf

# PDF → a new Encapsulated PDF DICOM instance, with patient context
dcmjs convert consent.pdf --to dcm -o consent.dcm \
  --patient-name "DOE^JANE" --patient-id 12345 \
  --title "Signed consent" --study-uid 1.2.840.113619.2.5.1762583153.215519.978957063.78
```

## `dcmjs convert` — images back into DICOM

The forward-migration path: a PNG or JPEG exported from an old DICOM file,
traveling with its metadata as DICOM JSON (any wrapper document works — the
converter plucks tag-keyed `{vr, Value}` entries wherever they sit and tells
you what it ignored).

```bash
# 001.json next to 001.png is discovered automatically
dcmjs convert 001.png --to dcm -o rebuilt/001.dcm
# convert: note: ignored non-DICOM sidecar keys: png, provenance

dcmjs dump rebuilt/001.dcm | grep -E "0008,0008|0020,000D"
# (0008,0008) CS ImageType: DERIVED\SECONDARY   ← source instance detected
# (0020,000D) UI StudyInstanceUID: 1.3.12...    ← original study preserved
```

Conformance is enforced by the dcmjs library, not left to the caller: the
actual image geometry always beats metadata claims (a wrong `Rows` is a hard
error naming both numbers), and when the metadata identifies the original
instance the rebuilt file gets a **fresh SOPInstanceUID**, a
`SourceImageSequence` reference, and `LossyImageCompression 01` — original
UIDs are never reused for rebuilt pixels.

An 8-bit export of a 16-bit original can approximately invert the window
rendering when the metadata carries WindowCenter/WindowWidth:

```bash
dcmjs convert 001.png --to dcm -o rebuilt/001.dcm --restore-values
# convert: restored ~12-bit stored values from WindowCenter 312 / WindowWidth 673 (lossy 8-bit source)
```

Gray-stored-as-RGB (the usual screenshot/export shape) collapses to
MONOCHROME2 automatically; real color stays RGB. A bare image with no
metadata becomes a plain Secondary Capture instance.

## `dcmjs validate` — sweep a corpus

Parse everything under a directory and report what fails — useful before
pointing a pipeline at a pile of files of unknown provenance.

```bash
dcmjs validate ./incoming --quiet
# incoming/bad-transfer-syntax.dcm: parse failure ...
# 214 files, 212 ok, 2 failed

dcmjs validate ./incoming --json report.json   # full machine-readable report
```

## `dcmjs dicomdir` — index a tree onto media

Build a DICOMDIR — the Media Storage Directory a CD/DVD viewer reads — for
every DICOM file under a directory. Record keys come from a partial parse
that stops before PixelData, so large studies index in moments; the byte
offsets inside the directory records are computed exactly (measure-then-
write in dcmjs.media), not left as zeros.

```bash
dcmjs dicomdir ./study
# dicomdir: 480 instances, 8 series, 1 study, 1 patient → ./study/DICOMDIR (198,364 bytes)

dcmjs dump ./study/DICOMDIR | head -6   # it's a DICOM file; dump reads it
```

DICOMDIR referenced file names must be ISO 9660 level 1 (A–Z 0–9 _, max 8
chars per component). Real trees rarely are — by default that's a warning,
`--strict` makes it an error, and `--copy` sidesteps it by staging a
conformant CD-style tree:

```bash
dcmjs dicomdir ./study --copy ./cd
# ./cd/DICOM/IM000001 ... IM000480, plus ./cd/DICOMDIR referencing them

dcmjs dicomdir ./study --json | jq .summary   # dry run: records, warnings, skips
```

## `dcmjs dicomweb` — publish a tree for web viewers

The modern sibling of `dcmjs dicomdir`: same input (a folder of DICOM
files), different index — the Static-DICOMweb layout (`studies/<uid>/...`
with gzipped metadata and multipart frame files) that OHIF and other
DICOMweb viewers read directly, no server required.

```bash
dcmjs dicomweb ./study -d ./web
# dicomweb: study 1.3.12... → ./web/studies/1.3.12...
# dicomweb: 1 study published to ./web

dcmjs dicomweb ./mixed-folder -d ./web        # every study found is published
dcmjs dicomweb ./study -d ./web -S 1.3.12...  # or just one
```

The same machinery makes `dicomwebjs download` accept a plain directory of
Part 10 files as its source (auto-detected — a `studies/` subdirectory
means Static-DICOMweb, DICM magic anywhere means Part 10):

```bash
dicomwebjs download ./study -S 1.3.12... -d ./web   # Part 10 dir in
dicomwebjs part10 ./web -S 1.3.12... -d ./exported  # Part 10 back out
```

A wrong study UID answers with the studies actually found (patient, description,
counts) instead of a stack trace. For heavyweight publishing (thumbnails,
deduplicated metadata trees, a server), `@radicalimaging/static-wado-creator`'s
`mkdicomweb` remains the production tool — this is the right-sized native path.

## `dcmjs anonymize` — strip PHI (current form)

Today's anonymize applies the dcmjs anonymizer's default tag rules and writes
a scrubbed copy:

```bash
dcmjs anonymize slice001.dcm -o slice001-anon.dcm
dcmjs dump slice001-anon.dcm | grep 0010,0010
# (0010,0010) PN PatientName: ANON^PATIENT
```

A streaming rewrite is planned (salt-derived deterministic UIDs, consistent
date offsets, name-list substitution) built on `filter`, below — this command
stays as-is until the filter version reaches parity.

## `dcmjs filter` — the streaming workhorse

`filter` streams a file through an event-stream filter chain into a new file.
Nothing ever holds the whole dataset, so it works unchanged on inputs of any
size — the pipeline underneath is the one verified on a 21.8 GB fragmented
video instance (peak memory ≈ two fragments, output video bit-identical).

### Structural copy (no filters)

Copies a file element-by-element through the full parse/serialize cycle. Not
byte-identical by design (undefined-length sequences, recomputed group
lengths), but semantically equal: tags, VRs, and binary payloads all survive
re-parse exactly. A cheap way to normalize a file's encoding or prove a file
survives the event-stream round trip:

```bash
dcmjs filter in.dcm -o copy.dcm
# wrote copy.dcm (527,456 bytes, 0 filters)
```

### Replace values in place: `--set TAG=VALUE`

Repeatable; the tag is 8 hex digits. Multi-valued elements collapse to the
one replacement.

```bash
# Rename the patient and re-identify the instance in one streaming pass
dcmjs filter in.dcm -o out.dcm \
  --set 00100010=RESEARCH^SUBJECT^42 \
  --set 00080018=2.25.107441562676745974564652992770535752833
```

The same shape at scale: swapping the SOP Instance UID inside a 21.8 GB video
instance took one pass at ~2 GB peak memory, and the video payload's SHA-256
was unchanged.

### Remove elements or whole sequences: `--drop TAG`

Dropping a sequence tag removes the sequence and everything nested in it, at
any depth.

```bash
dcmjs filter in.dcm -o out.dcm \
  --drop 00104000 \
  --drop 00081140   # ReferencedImageSequence, 3 items — gone as a unit
```

### Custom filters: `--module file.mjs`

The escape hatch that makes `filter` a framework. A module's default export is
a filter object (or an array of them) speaking the event-stream vocabulary:
each method has the shape `method(next, ...args)` and calls `next(...)` to
pass the event along — or doesn't, to swallow it.

A working example — fingerprint every binary element while copying, without
buffering anything:

```js
// sha256-binaries.mjs
import crypto from "node:crypto";

let tag = null;
let hash = null;

export default {
  startElement(next, t, info)  { tag = t; return next(t, info); },
  startBinary(next, opts)      { hash = crypto.createHash("sha256"); return next(opts); },
  binaryFragment(next, chunk) {
    hash.update(Buffer.from(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk));
    return next(chunk);
  },
  endBinary(next) {
    console.error(`sha256(${tag}) = ${hash.digest("hex")}`);
    return next();
  }
};
```

```bash
dcmjs filter in.dcm -o copy.dcm --module ./sha256-binaries.mjs
# sha256(20011003) = df3f6198...
# sha256(7FE00010) = c8f81c31...   ← PixelData digest, computed as it streamed
# wrote copy.dcm (527,828 bytes, 1 filter)
```

Two things worth knowing when writing modules:

- **`this` is the shared listener**, not your filter object — several filters
  chain onto one listener, so keep private state in module scope (as above)
  to avoid collisions.
- **Order**: `--module` filters run before the built-in `--set`/`--drop`
  filters, and multiple modules run in the order given.

### Demographics from FHIR: `--fhir-patient resource.json`

The FHIR loop, closed: `convert --to fhir` maps DICOM → FHIR, and
`--fhir-patient` maps a FHIR Patient back onto DICOM — no jq, no shell
plumbing. The mapping (in `@dcmjs/fhir`, one audited place) picks the
`official` name over `maiden`, the MR-typed identifier over others, and
converts administrative gender narrowly (male→M, female→F, other and any
unrecognized value→O, unknown/absent→empty — extensions are deliberately
never consulted).

```bash
cat jane-fox.json
# { "resourceType": "Patient",
#   "name": [ { "use": "official", "family": "FOX", "given": ["JANE"] },
#             { "use": "maiden",   "family": "DOE", "given": ["JANE"] } ],
#   "identifier": [ { "type": { "coding": [{ "code": "MR" }] }, "value": "22446688" } ],
#   "gender": "female", "birthDate": "1980-04-15" }

dcmjs filter in.dcm -o out.dcm --fhir-patient jane-fox.json
dcmjs dump out.dcm | grep "(0010"
# (0010,0010) PN PatientName: FOX^JANE     ← official, not the maiden DOE
# (0010,0020) LO PatientID: 22446688
# (0010,0030) DA PatientBirthDate: 19800415
# (0010,0040) CS PatientSex: F
```

Unlike `--set` (replace-only), this is **insert-or-replace**: a
de-identified file whose patient tags were removed outright still receives
the full module, emitted at the correct tag-ordered position. And it's a
deterministic overwrite — fields the resource doesn't carry are written
present-but-empty, so no trace of the previous identity survives.

The same flag works on `convert` for any input kind:

```bash
dcmjs convert scan.png --to dcm -o out.dcm --fhir-patient jane-fox.json
dcmjs convert report.pdf --to dcm -o out.dcm --fhir-patient jane-fox.json
```

### Combine everything

```bash
dcmjs filter in.dcm -o out.dcm \
  --module ./sha256-binaries.mjs \
  --set 00100010=ANON \
  --drop 00104000
# wrote out.dcm (527,462 bytes, 3 filters)
```

---

## `dcmjs-mcp` — the toolbox for LLM toolchains

The forward-migration problem in practice: decades of DICOM files, and the
thing driving the migration is an LLM agent. `dcmjs-mcp` is a stdio MCP
server that exposes every verb above as a tool an agent can call natively —
`dicom_dump`, `dicom_instance`, `dicom_validate`, `dicom_convert`,
`dicom_anonymize`, `dicom_filter`, `dicomdir_create`.

Register it (Claude Code shown; any MCP client works):

```bash
claude mcp add dcmjs -- dcmjs-mcp
```

The design contract is "help the agent make the correct choice":

- **Descriptions are guidance, not labels** — each tool states its defaults
  and conformance behavior ("original UIDs are never reused for rebuilt
  pixels", "validate the output and audit before release").
- **Errors are corrective**: state → consequence → the parameter to change.
  `"target \"dcm\" produces binary — pass output: <path> to receive
  { written: path }"`; `"image is 8-bit but metadata claims BitsStored=12 —
  pass restore_values true or accept 8-bit output"`.
- **Warnings ride along**: every result is `{ ok, warnings, ... }`, so a
  partial success (ignored sidecar keys, non-conformant file names, skipped
  files) is visible in the payload the agent reasons over.
- **Dry runs before destruction**: `dicom_anonymize` returns its tag-level
  change list and `dicomdir_create` its full record tree without writing
  anything when `dry_run` is set.
- **Binary stays on disk** — tools return `{ written: path }`, never inline
  bytes.

The handlers are the same DI'd command functions the CLI uses — one code
path, two front ends. (After pulling this feature, re-run `npm link` here so
the `dcmjs-mcp` symlink is created.)

---

## `dicomwebjs` — DICOMweb sources

The same inspect verbs, pointed at DICOMweb — either an http server or a
Static-DICOMWeb file tree on disk — plus study transfer in both directions.

```bash
# Dump query/metadata responses
dicomwebjs dump https://server/dicomweb/studies?PatientID=12345
dicomwebjs dump ./dicomweb/studies/1.2.840.../series/1.2.840.../metadata

# Instance metadata as DICOM JSON
dicomwebjs instance https://server/dicomweb/studies/1.2.840.../metadata --pretty

# Pull a whole study into a local Static-DICOMWeb layout
dicomwebjs download https://server/dicomweb -S 1.2.840.113619.2.5.1762583153... -d ./local-cache

# Pull a study back out as Part 10 .dcm files
dicomwebjs part10 ./local-cache -S 1.2.840.113619.2.5.1762583153... -d ./exported
```

---

## Measuring: the performance harness

`bench/baseline.js` times the three things people actually do with a file —
open it, read its metadata, save it back — through both the legacy parse path
and the event-stream path, so improvements (and regressions) are provable:

```bash
node bench/baseline.js          # human table
node bench/baseline.js --json   # machine-readable
```

Current recorded baseline: event-stream parse+naturalize is 1.4–1.8× slower
than the legacy path (a constant ~0.2–0.3 ms per parse), write cost is
equivalent. Those numbers exist to be beaten; the trend line is the point.

## The streaming story in one table

Numbers from the 21.8 GB Supplement 225 video instance (21 fragments of
1 GiB), the fixture these tools are tested against:

| operation | peak memory | integrity check |
|---|---|---|
| read only (parse every element) | 1.9 GB | all 21 fragments, byte counts exact |
| filter copy with UID rewrite | 2.0 GB | payload SHA-256 identical to source |
| independent verifier (no dcmjs) | 59 MB | reconstructed video == source MP4 |

Memory is bounded by the largest *fragment*, never the file: the same
commands run on the same hardware whether the input is 500 KB or 21.8 GB.
