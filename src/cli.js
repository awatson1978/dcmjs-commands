// src/cli.js
//
// Command router for the dcmjs bin. Parsing is node:util parseArgs;
// commands receive an injected `dcmjs` (the built bundle from bin/, or a
// test-supplied instance) plus stdout/stderr sinks, and return exit codes.
// The dicomwebjs bin keeps commander for its legacy surface — this router
// only serves the local-file `dcmjs` commands.

import { parseArgs } from "node:util";
import { runConvert, convertUsage } from "./commands/convert.js";
import { runDump, dumpUsage } from "./commands/dump.js";
import { runInstance, instanceUsage } from "./commands/instance.js";
import { runAnonymize, anonymizeUsage } from "./commands/anonymize.js";
import { runValidate, validateUsage } from "./commands/validate.js";
import { runFilter, filterUsage } from "./commands/filter.js";
import { runDicomdir, dicomdirUsage } from "./commands/dicomdir.js";

export const usage = `usage: dcmjs <command> [options]

Commands:
    convert     convert between DICOM, PDF, FHIR, and JSON representations
    dump        print a DICOM file's dataset (tag lines; --json for JSON)
    instance    print a DICOM file's dict as tag-keyed DICOM JSON
    anonymize   strip PHI tags and write a scrubbed copy
    filter      stream a file through an event-stream filter chain
    validate    parse files/directories and report failures
    dicomdir    build a DICOMDIR indexing a directory of DICOM files

Run 'dcmjs <command> --help' for command options.
`;

const COMMANDS = {
  convert: {
    run: runConvert,
    usage: convertUsage,
    options: {
      to: { type: "string", short: "t" },
      output: { type: "string", short: "o" },
      pretty: { type: "boolean", default: false },
      bundle: { type: "boolean", default: false },
      "fhir-version": { type: "string" },
      "patient-name": { type: "string" },
      "patient-id": { type: "string" },
      title: { type: "string" },
      "study-uid": { type: "string" },
      "series-uid": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  },
  dump: {
    run: runDump,
    usage: dumpUsage,
    options: {
      json: { type: "boolean", default: false },
      raw: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  },
  instance: {
    run: runInstance,
    usage: instanceUsage,
    options: {
      pretty: { type: "boolean", short: "p", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  },
  anonymize: {
    run: runAnonymize,
    usage: anonymizeUsage,
    options: {
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h", default: false },
    },
  },
  filter: {
    run: runFilter,
    usage: filterUsage,
    options: {
      output: { type: "string", short: "o" },
      set: { type: "string", multiple: true },
      drop: { type: "string", multiple: true },
      module: { type: "string", multiple: true },
      help: { type: "boolean", short: "h", default: false },
    },
  },
  validate: {
    run: runValidate,
    usage: validateUsage,
    options: {
      quiet: { type: "boolean", default: false },
      json: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  },
  dicomdir: {
    run: runDicomdir,
    usage: dicomdirUsage,
    options: {
      output: { type: "string", short: "o" },
      copy: { type: "string" },
      "fileset-id": { type: "string" },
      strict: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  },
};

export async function runCli({ dcmjs, argv, stdout, stderr }) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    if (command) {
      stdout(usage);
      return 0;
    }
    stderr(usage);
    return 1;
  }

  const spec = COMMANDS[command];
  if (!spec) {
    stderr(`dcmjs: unknown command "${command}"`);
    stderr(usage);
    return 1;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: spec.options,
      strict: true,
      allowPositionals: true,
    });
  } catch (err) {
    stderr(`dcmjs ${command}: ${err.message}`);
    stderr(spec.usage);
    return 1;
  }

  if (parsed.values.help) {
    stdout(spec.usage);
    return 0;
  }

  return spec.run({
    dcmjs,
    positionals: parsed.positionals,
    values: parsed.values,
    stdout,
    stderr,
  });
}
