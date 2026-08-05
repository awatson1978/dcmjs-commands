import { StudyAccess } from "../access/DicomAccess.js";
import { naturalize, logger } from "../utils/index.js";
import { DicomWebSeries } from "./DicomWebSeries.js";

const log = logger.commandsLog.getLogger("DicomWeb", "Study");

export class DicomWebStudy extends StudyAccess {
  async read() {
    log.info("Querying dicomweb for study", this.uid);
    const json = await this.dicomAccess.client.searchForStudies({
      queryParams: {
        studyInstanceUID: this.uid,
      },
    });
    log.info("Read study query result", json?.length);
    if (!json) {
      throw new Error(`No study results found for ${this.uid}`);
    }
    this.jsonData = json;
    this.natural = naturalize(json);
  }

  createAccess(seriesUID, natural) {
    log.debug("Creating access on seriesUID", seriesUID);
    return new DicomWebSeries(this, seriesUID, natural);
  }

  async queryChildren() {
    if (this.childrenMap.size) {
      return [...this.childrenMap.values()];
    }
    log.info("About to query for series in study", this.uid);
    const json = await this.dicomAccess.client.searchForSeries({
      studyInstanceUID: this.uid,
    });
    const naturalJson = naturalize(json);
    log.debug("Found series count=", naturalJson.length);
    return naturalJson.map((series) => this.addJson(series));
  }
}
