import DICOMwebClient from "dicomweb-client";

import { DicomAccess } from "./DicomAccess.js";
import { DicomWebStudy } from "./DicomWebStudy.js";
import { commandsLog } from "../utils/logger.js";

const log = commandsLog.getLogger("DicomWebAccess");

export class DicomWebAccess extends DicomAccess {
  constructor(url, options) {
    super(url, options);
    log.debug("Creating DicomWebAccess for", url);
    this.client = new DICOMwebClient.api.DICOMwebClient({
      url,
      verbose: false,
    });
    log.debug("Created DICOMwebclient api", !!this.client);
  }

  createAccess(studyUID, natural) {
    return new DicomWebStudy(this, studyUID, natural);
  }
}

export default DicomWebAccess;
