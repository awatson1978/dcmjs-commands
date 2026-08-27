# dcmjs-commands by example

A worked tour of every command. Two terms up front for readers arriving
from outside DICOM: a *Part 10 file* is the standard on-disk DICOM file
format (the `.dcm` files a scanner or PACS produces), and *DICOMweb* is
the web API for the same data (JSON metadata, HTTP retrieval). The design
goal throughout these tools: work *streaming* — files pass through piece
by piece, so the same command that handles a 500 KB CT slice handles a
21.8 GB surgical video without loading it into memory. Every example
below was run against real files before being written down.

Four binaries:

| binary | purpose |
|---|---|
| `dcmjs` | local Part 10 files: inspect, convert, validate, anonymize, filter, dicomdir, dicomweb |
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

The quickest way to see what a DICOM file contains. Default output is one
line per element; `--json` gives the *naturalized* form — dcmjs's readable
representation, with keyword keys (`PatientName`) instead of numeric tags
and binary values summarized rather than printed.

```bash
dcmjs dump study/slice001.dcm
# (0008,0060) CS Modality: MR
# (0010,0010) PN PatientName: Fall 3
# (7FE0,0010) OB PixelData: [OB 524288 bytes]
# ...

dcmjs dump study/slice001.dcm --json | jq .PatientName
```

## `dcmjs instance` — tag-keyed DICOM JSON

The same file as standard DICOM JSON (numeric tag keys, `vr`/`Value`
entries) — the exact shape a DICOMweb `/metadata` endpoint returns, and
the shape other tools here accept as metadata input. Use this when a
machine is the consumer; use `dump --json` when a human is.

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

The scenario: years ago a DICOM study was exported as PNGs or JPEGs, with
the DICOM metadata saved alongside as JSON, and now you want real DICOM
files again. The converter accepts the image plus its metadata document —
any wrapper format works, because it collects tag-keyed `{vr, Value}`
entries wherever they sit in the JSON and tells you which keys it
ignored.

```bash
# 001.json next to 001.png is discovered automatically
dcmjs convert 001.png --to dcm -o rebuilt/001.dcm
# convert: note: ignored non-DICOM sidecar keys: png, provenance

dcmjs dump rebuilt/001.dcm | grep -E "0008,0008|0020,000D"
# (0008,0008) CS ImageType: DERIVED\SECONDARY   ← source instance detected
# (0020,000D) UI StudyInstanceUID: 1.3.12...    ← original study preserved
```

Two safety rules are built in rather than left to the caller. First,
measurements taken from the actual image (rows, columns, bit depth)
always override what the metadata claims — a wrong `Rows` is a hard error
naming both numbers, because silently trusting either side would corrupt
the output. Second, when the metadata identifies the original instance,
the rebuilt file is marked as a *derived* copy: it gets a **fresh
SOPInstanceUID**, a `SourceImageSequence` pointing back at the original,
and `LossyImageCompression 01`. Reusing the original UID would assert
that this file *is* the original — it is not; the pixels passed through a
lossy export.

About that lossiness: the PNG export was typically made by applying the
display window (a brightness/contrast mapping) to 16-bit data and saving
8-bit results. When the metadata still carries the window parameters
(WindowCenter/WindowWidth), the transform can be approximately inverted
to recover 16-bit-range stored values:

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

A DICOMDIR is the index file on DICOM interchange media (CDs, DVDs, USB
filesets): one DICOM file whose patient/study/series/image records point
at all the others by byte position. This command builds one for every
DICOM file under a directory. Indexing is fast because each file is only
parsed up to (not including) its pixel data, and the record offsets are
computed exactly — the hard part of writing a DICOMDIR, and the reason
many tools leave them as zeros and hope the reader doesn't check.

```bash
dcmjs dicomdir ./study
# dicomdir: 480 instances, 8 series, 1 study, 1 patient → ./study/DICOMDIR (198,364 bytes)

dcmjs dump ./study/DICOMDIR | head -6   # it's a DICOM file; dump reads it
```

One rule inherited from the CD era: the file names a DICOMDIR references
must fit the old ISO 9660 disc filesystem — uppercase A–Z, digits,
underscore, at most 8 characters per path component. Real directory trees
rarely comply. By default that's a warning, `--strict` makes it an error,
and `--copy` sidesteps the problem by staging a conformant CD-style tree
with generated names:

```bash
dcmjs dicomdir ./study --copy ./cd
# ./cd/DICOM/IM000001 ... IM000480, plus ./cd/DICOMDIR referencing them

dcmjs dicomdir ./study --json | jq .summary   # dry run: records, warnings, skips
```

## `dcmjs dicomweb` — publish a tree for web viewers

The modern sibling of `dcmjs dicomdir`: same input (a folder of DICOM
files), different index. Instead of a CD-style DICOMDIR, this writes the
*Static-DICOMweb* layout — the DICOMweb API's responses pre-computed as
files on disk (`studies/<uid>/...` with gzipped JSON metadata and
per-frame pixel files). OHIF and other DICOMweb viewers can read the
result directly from any static file host; no server-side DICOM logic is
required.

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

### dicomweb+fhir: `--fhir`

FHIR is how the rest of healthcare IT exchanges data; DICOM is where the
pixels live. The `--fhir` flag produces both halves of that partnership
in one output: the DICOMweb tree carries the images, and a `fhir/` layer
describes them to FHIR systems — a Patient, an ImagingStudy (id =
StudyInstanceUID, `subject` → the Patient, `endpoint` → where the pixels
are served), and a **transaction Bundle** that loads the whole set into
any FHIR server with one request:

```bash
dcmjs dicomweb ./study -d ./web --fhir \
  --fhir-patient jane-fox.json \
  --wado-root https://pacs.example.org/dicomweb
# dicomweb: fhir: Patient/22446688, ImagingStudy/1.3.12... → ./web/fhir

curl -X POST https://fhir.example.org/ -H 'Content-Type: application/fhir+json' \
  -d @./web/fhir/Bundle.json    # idempotent PUT entries — safe to re-run
```

FHIR resources also work as *inputs*. A provided `--fhir-patient` is
embedded verbatim as the authoritative Patient; if it disagrees with what
the instance tags say, you get a warning rather than a silent resolution
— run `dcmjs filter --fhir-patient` first when the instances themselves
should be updated. `--fhir-encounter` embeds an Encounter and references
it from `ImagingStudy.encounter` (it is deliberately *not* written into
DICOM tags — see below). Without `--fhir-patient`, the Patient is derived
from the instance tags.

Two questions are knowingly open, flagged for team discussion in
[architecture-design.md](architecture-design.md): what `Endpoint.address`
should be for a static tree that cannot know its eventual serving URL
(the default suits a local static-wado-webserver; set `--wado-root` for
anything else), and how far Encounter/order context should map onto DICOM
tags. `dicomwebjs download` accepts the same flags, so a study pulled
from a live server can emit its FHIR layer on the way down.

## `dcmjs anonymize` — strip PHI (current form)

Today's anonymize applies the dcmjs anonymizer's default tag rules and writes
a scrubbed copy (`--dry-run` prints the tag-level change list as JSON
without writing anything):

```bash
dcmjs anonymize slice001.dcm -o slice001-anon.dcm
dcmjs dump slice001-anon.dcm | grep 0010,0010
# (0010,0010) PN PatientName: ANON^PATIENT
```

Know the limits before relying on it: the default rules cover the
*standard* PHI tags only. Vendor private tags and text burned into the
pixels themselves are not touched — audit the output before releasing
anything. A streaming rewrite is planned (salt-derived deterministic
UIDs, consistent date offsets, name-list substitution) built on `filter`,
below — this command stays as-is until the filter version reaches parity.

## `dcmjs filter` — the streaming workhorse

`filter` copies a file to a new file while a chain of filters watches (and
optionally rewrites) every element as it streams past. Nothing ever holds
the whole dataset in memory, so the same command works on inputs of any
size — the pipeline underneath is the one verified on a 21.8 GB fragmented
video instance (peak memory about two pixel fragments, output video
bit-identical to the source).

### Structural copy (no filters)

With no filters given, the copy still passes through the full
parse-and-serialize cycle. The output is not byte-identical to the input
— encoding details like sequence lengths are legitimately rewritten — but
it is semantically equal: every tag, VR, and binary payload survives
re-parse exactly. Useful for normalizing a file's encoding, or as a cheap
proof that a file round-trips cleanly:

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

The escape hatch that makes `filter` a framework. A module's default
export is a filter object (or an array of them) whose methods are named
after the streaming reader's events — `startElement`, `value`,
`binaryFragment`, and so on. Each method has the shape
`method(next, ...args)`: call `next(...)` to pass the event along, change
the arguments to rewrite it, or return without calling `next` to swallow
it entirely.

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

The two standards meet here in both directions: `convert --to fhir` maps
DICOM out to FHIR, and `--fhir-patient` maps a FHIR Patient resource back
onto DICOM's patient tags — no hand-written field mapping required. The
mapping decisions live in one audited place (`@dcmjs/fhir`): where a
Patient carries several names, the `official` one wins over the `maiden`;
among identifiers, one typed MR (medical record number) is preferred; and
administrative gender converts narrowly (male→M, female→F, other or any
unrecognized value→O, unknown or absent→empty — profile extensions are
deliberately never consulted, because they carry different semantics).

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

Decades of legacy DICOM files exist, and increasingly the thing doing the
migration work is an LLM agent. `dcmjs-mcp` is an MCP server — the
standard protocol by which AI assistants call external tools — exposing
every verb above as a typed tool: `dicom_dump`, `dicom_instance`,
`dicom_validate`, `dicom_convert`, `dicom_anonymize`, `dicom_filter`,
`dicomdir_create`, `dicomweb_create`.

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

Under the hood the tool handlers are the very same command functions the
CLI runs — one implementation, two front ends — so CLI behavior and agent
behavior can never drift apart. (If `dcmjs-mcp` is missing from your PATH
after updating, re-run `npm link` here — new binary names need
relinking.)

---

## `dicomwebjs` — DICOMweb sources

The same inspect verbs, pointed at DICOMweb sources — a live http server,
a Static-DICOMweb file tree on disk, or (auto-detected) a plain directory
of Part 10 files — plus study transfer in both directions. Transfers
print one completion line by default; `--verbose` narrates per-instance
progress.

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
open it, read its metadata, save it back — through both the classic parse
path and the event-stream path, so improvements (and regressions) are
provable rather than anecdotal:

```bash
node bench/baseline.js          # human table
node bench/baseline.js --json   # machine-readable
```

Current recorded baseline: event-stream parse+naturalize is 1.4–1.8× slower
than the classic path (a constant ~0.2–0.3 ms per parse), write cost is
equivalent. Those numbers exist to be beaten; the trend line is the point.

## The streaming story in one table

Numbers from a 21.8 GB DICOM surgical-video instance (21 pixel-data
fragments of 1 GiB each), the fixture these tools are tested against:

| operation | peak memory | integrity check |
|---|---|---|
| read only (parse every element) | 1.9 GB | all 21 fragments, byte counts exact |
| filter copy with UID rewrite | 2.0 GB | payload SHA-256 identical to source |
| independent verifier (no dcmjs) | 59 MB | reconstructed video == source MP4 |

Memory is bounded by the largest *fragment*, never the file: the same
commands run on the same hardware whether the input is 500 KB or 21.8 GB.
