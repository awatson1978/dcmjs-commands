# dcmjs-commands by example

A worked tour of every command. The design goal throughout: work *streaming* —
files pass through the tools piece by piece, so the same command that handles a
500 KB CT slice handles a 21.8 GB surgical video without loading it into
memory. Every example below was run against real files before being written
down.

Three binaries:

| binary | purpose |
|---|---|
| `dcmjs` | local Part 10 files: inspect, convert, validate, anonymize, filter |
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

### Combine everything

```bash
dcmjs filter in.dcm -o out.dcm \
  --module ./sha256-binaries.mjs \
  --set 00100010=ANON \
  --drop 00104000
# wrote out.dcm (527,462 bytes, 3 filters)
```

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
