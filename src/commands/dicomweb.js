// src/commands/dicomweb.js
//
// dcmjs dicomweb <directory> [options]
//
// Publish a directory of Part 10 DICOM files as a Static-DICOMweb tree —
// the sibling of `dcmjs dicomdir`: same input (a folder of DICOM files),
// different index (the modern web layout instead of the CD one). Built on
// the Part10DirectoryAccess source and the same destination machinery
// `dicomwebjs download` uses.

import { DicomAccess } from "../access/DicomAccess.js";

export const dicomwebUsage = `usage: dcmjs dicomweb <directory> [options]

Build a Static-DICOMweb tree (studies/<uid>/...) from a directory of
Part 10 DICOM files.

    -d, --directory <dest>   output root (default: ./dicomweb)
    -S, --study <uid>        publish only this StudyInstanceUID
                             (default: every study found)
`;

export async function runDicomweb({
  dcmjs: _dcmjs,
  positionals,
  values,
  stdout,
  stderr,
  createAccess = DicomAccess.createInstance,
}) {
  const [sourceDir] = positionals;
  if (!sourceDir) {
    stderr("dicomweb: missing <directory>");
    stderr(dicomwebUsage);
    return 1;
  }
  const destDir = values.directory || "./dicomweb";

  try {
    const source = await createAccess(sourceDir, {});
    const destination = await createAccess(destDir, {
      scheme: "file",
      isDestination: true,
    });

    let studyUIDs;
    if (values.study) {
      studyUIDs = [values.study];
    } else if (typeof source.scan === "function") {
      const { groups } = await source.scan();
      studyUIDs = [...groups.keys()];
    } else {
      throw new Error(
        `${sourceDir} is not a directory of Part 10 files — pass ` +
          `-S <StudyInstanceUID> to publish from a DICOMweb source`
      );
    }

    for (const studyUID of studyUIDs) {
      const srcStudy = await source.queryStudy(studyUID);
      await destination.store(srcStudy, {
        ...DicomAccess.DICOMWEB_OPTIONS,
      });
      stdout(`dicomweb: study ${studyUID} → ${destDir}/studies/${studyUID}`);
    }
    stdout(
      `dicomweb: ${studyUIDs.length} ` +
        `${studyUIDs.length === 1 ? "study" : "studies"} published to ${destDir}`
    );
    return 0;
  } catch (err) {
    stderr(`dicomweb: ${err.message}`);
    return 1;
  }
}
