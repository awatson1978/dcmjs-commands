// src/commands/validate.mjs
//
// dcmjs validate <dir-or-file...> [--quiet] [--json <file>]
// Parse every discovered DICOM file through the classic read path and
// report per-file status. Exit 1 on any failure. The heavier three-path
// divergence harness lives in scripts/corpus-runner.mjs.

import fs from "node:fs";
import path from "node:path";
import { readFileArrayBuffer, discoverDicomFiles } from "../io.js";

export const validateUsage = `usage: dcmjs validate <dir-or-file...> [options]

Parse DICOM files and report failures.

    --quiet          only print failures and the summary
    --json <file>    write the full report as JSON
`;

/**
 * The validation core, decoupled from output formatting: discover, parse,
 * record. Consumed by runValidate (line-oriented CLI output) and by the MCP
 * server (raw records as structured tool results).
 *
 * @param {{ dcmjs: Object, targets: string[] }} args
 * @returns {{ records: Array, failures: number }}
 * @throws when a target cannot be walked or no DICOM files are found
 */
export function validateFiles({ dcmjs, targets }) {
  const { DicomMessage } = dcmjs.data;
  const files = [];
  for (const target of targets) {
    discoverDicomFiles(target, files);
  }
  if (files.length === 0) {
    throw new Error("no DICOM files found");
  }

  const records = [];
  let failures = 0;
  for (const file of files) {
    const relPath = path.relative(process.cwd(), file) || file;
    const startedAt = Date.now();
    try {
      const arrayBuffer = readFileArrayBuffer(file);
      DicomMessage.readFile(arrayBuffer);
      records.push({
        file: relPath,
        status: "ok",
        bytes: arrayBuffer.byteLength,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      failures += 1;
      records.push({
        file: relPath,
        status: "fail",
        error: err.message || String(err),
        ms: Date.now() - startedAt,
      });
    }
  }
  return { records, failures };
}

export async function runValidate({
  dcmjs,
  positionals,
  values,
  stdout,
  stderr,
}) {
  if (positionals.length === 0) {
    stderr("validate: no input files or directories given");
    stderr(validateUsage);
    return 1;
  }

  let result;
  try {
    result = validateFiles({ dcmjs, targets: positionals });
  } catch (err) {
    stderr(`validate: ${err.message}`);
    return 1;
  }
  const { records, failures } = result;

  for (const record of records) {
    if (record.status === "fail") {
      stdout(`FAIL  ${record.ms}ms  ${record.file}  (${record.error})`);
    } else if (!values.quiet) {
      stdout(`ok    ${record.bytes}B  ${record.ms}ms  ${record.file}`);
    }
  }

  stdout(
    `${records.length - failures}/${records.length} clean, ${failures} failed`
  );

  if (values.json) {
    fs.writeFileSync(values.json, JSON.stringify(records, null, 4));
  }

  return failures > 0 ? 1 : 0;
}
