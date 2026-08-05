// test/dump.test.js

import path from "path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dcmjs = require("dcmjs");
dcmjs.log.setLevel("silent");
dcmjs.log.getLogger("validation.dcmjs").setLevel("silent");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { runDump } from "../src/commands/dump.js";

const FIXTURE = path.join(__dirname, "fixtures", "sample-dicom.dcm");

function capture() {
    const lines = [];
    return { lines, write: text => lines.push(text) };
}

test("dump prints the naturalized dataset with binary summarized", async () => {
    const out = capture();
    const err = capture();
    const code = await runDump({
        dcmjs,
        positionals: [FIXTURE],
        values: {},
        stdout: out.write,
        stderr: err.write
    });

    expect(code).toBe(0);
    const text = out.lines.join("\n");
    expect(text).toContain("Fall 3");
    expect(text).toContain("[binary");
    // Parseable JSON — binary was replaced, not silently emptied
    const parsed = JSON.parse(text);
    expect(parsed.Modality).toBe("MR");
});

test("dump --raw prints tag/VR lines", async () => {
    const out = capture();
    const err = capture();
    const code = await runDump({
        dcmjs,
        positionals: [FIXTURE],
        values: { raw: true },
        stdout: out.write,
        stderr: err.write
    });

    expect(code).toBe(0);
    const text = out.lines.join("\n");
    expect(text).toMatch(/\(0010,0010\)\s+PN\s+PatientName/);
    expect(text).toMatch(/\(0002,0010\)\s+UI\s+TransferSyntaxUID/);
});

test("dump errors cleanly on a missing file", async () => {
    const out = capture();
    const err = capture();
    const code = await runDump({
        dcmjs,
        positionals: ["/no/such/file.dcm"],
        values: {},
        stdout: out.write,
        stderr: err.write
    });
    expect(code).toBe(1);
    expect(err.lines.join("\n")).toMatch(/no such file|ENOENT/i);
});
