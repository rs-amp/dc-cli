import { Arguments, Argv } from 'yargs';
import { ConfigurationParameters } from '../configure';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import paginator from '../../common/dc-management-sdk-js/paginator';
import { Edition, EditionSlot, Event, Hub } from 'dc-management-sdk-js';
import { createStream } from 'table';
import { streamTableOptions } from '../../common/table/table.consts';
import { TableStream } from '../../interfaces/table.interface';
import chalk from 'chalk';
import {
  ExportResult,
  nothingExportedExit,
  promptToOverwriteExports,
  uniqueFilenamePath,
  writeJsonToFile
} from '../../services/export.service';
import { loadJsonFromDirectory } from '../../services/import.service';
import { ExportEventBuilderOptions } from '../../interfaces/export-event-builder-options.interface';
import { ensureDirectoryExists } from '../../common/import/directory-utils';
import { relativeDate } from '../../common/filter/facet';
import { getDefaultLogPath } from '../../common/log-helpers';
import { FileLog } from '../../common/file-log';

export const command = 'export <dir>';

export const desc = 'Export Events';

export const LOG_FILENAME = (platform: string = process.platform): string =>
  getDefaultLogPath('event', 'export', platform);

export const builder = (yargs: Argv): void => {
  yargs
    .positional('dir', {
      describe: 'Output directory for the exported Events.',
      type: 'string'
    })
    .option('id', {
      describe: 'Export a single event by ID, rather then fetching all of them.',
      type: 'string'
    })
    .option('fromDate', {
      describe: 'Start date for filtering events. Either "NOW" or in the format "<number>:<unit>", example: "-7:DAYS".',
      type: 'string'
    })
    .option('toDate', {
      describe: 'To date for filtering events. Either "NOW" or in the format "<number>:<unit>", example: "-7:DAYS".',
      type: 'string'
    })
    .option('logFile', {
      type: 'string',
      default: LOG_FILENAME,
      describe: 'Path to a log file to write to.'
    });
};

interface ExportRecord {
  readonly filename: string;
  readonly status: ExportResult;
  readonly event: Event;
}

class EditionWithSlots extends Edition {
  slots: EditionSlot[];
}

class EventWithEditions extends Event {
  editions: EditionWithSlots[];
}

export const enrichEditions = async (editions: Edition[]): Promise<EditionWithSlots[]> => {
  for (const edition of editions) {
    const withEditions = edition as EditionWithSlots;
    const slots = await paginator(edition.related.slots.list);
    withEditions.slots = slots;
  }

  return editions as EditionWithSlots[];
};

export const enrichEvents = async (events: Event[], log?: FileLog): Promise<EventWithEditions[]> => {
  for (const event of events) {
    if (log) {
      log.appendLine(`Fetching ${event.name} with editions.`);
    }

    const withEditions = event as EventWithEditions;

    try {
      const editions = await paginator(event.related.editions.list);
      withEditions.editions = await enrichEditions(editions);
    } catch (e) {
      if (log) {
        log.error(`Failed to fetch editions for ${event.name}, skipping.`, e);
      }
    }
  }

  const result = events as EventWithEditions[];

  return result.filter(event => event.editions != undefined);
};

export const getExportRecordForEvent = (
  event: EventWithEditions,
  outputDir: string,
  previouslyExportedEvents: { [filename: string]: EventWithEditions }
): ExportRecord => {
  const indexOfExportedContentType = Object.values(previouslyExportedEvents).findIndex(c => c.id === event.id);
  if (indexOfExportedContentType < 0) {
    const filename = uniqueFilenamePath(outputDir, event.name, 'json', Object.keys(previouslyExportedEvents));

    // This filename is now used.
    previouslyExportedEvents[filename] = event;

    return {
      filename: filename,
      status: 'CREATED',
      event
    };
  }
  const filename = Object.keys(previouslyExportedEvents)[indexOfExportedContentType];
  /*
  const previouslyExportedEvent = Object.values(previouslyExportedEvents)[indexOfExportedContentType];

  if (equals(previouslyExportedEvent, event)) {
    return { filename, status: 'UP-TO-DATE', event };
  }
  */
  return {
    filename,
    status: 'UPDATED',
    event
  };
};

type ExportsMap = {
  uri: string;
  filename: string;
};

export const getEventExports = (
  outputDir: string,
  previouslyExportedEvents: { [filename: string]: EventWithEditions },
  eventsBeingExported: EventWithEditions[]
): [ExportRecord[], ExportsMap[]] => {
  const allExports: ExportRecord[] = [];
  const updatedExportsMap: ExportsMap[] = []; // uri x filename
  for (const event of eventsBeingExported) {
    if (!event.id) {
      continue;
    }

    const exportRecord = getExportRecordForEvent(event, outputDir, previouslyExportedEvents);
    allExports.push(exportRecord);
    if (exportRecord.status === 'UPDATED') {
      updatedExportsMap.push({ uri: event.id, filename: exportRecord.filename });
    }
  }
  return [allExports, updatedExportsMap];
};

export const processEvents = async (
  outputDir: string,
  previouslyExportedEvents: { [filename: string]: EventWithEditions },
  eventsBeingExported: Event[],
  log: FileLog
): Promise<void> => {
  if (eventsBeingExported.length === 0) {
    nothingExportedExit('No events to export from this hub, exiting.\n', false);
    return;
  }

  const enrichedEvents = await enrichEvents(eventsBeingExported, log);

  const [allExports, updatedExportsMap] = getEventExports(outputDir, previouslyExportedEvents, enrichedEvents);
  if (
    allExports.length === 0 ||
    (Object.keys(updatedExportsMap).length > 0 && !(await promptToOverwriteExports(updatedExportsMap)))
  ) {
    nothingExportedExit(undefined, false);
    return;
  }

  await ensureDirectoryExists(outputDir);

  const tableStream = (createStream(streamTableOptions) as unknown) as TableStream;
  tableStream.write([chalk.bold('File'), chalk.bold('Schema ID'), chalk.bold('Result')]);
  for (const { filename, status, event } of allExports) {
    if (status !== 'UP-TO-DATE') {
      delete event.id; // do not export id
      writeJsonToFile(filename, event);
    }
    tableStream.write([filename, event.name || '', status]);
  }
  process.stdout.write('\n');
};

export const filterEvents = (events: Event[], from: Date | undefined, to: Date | undefined) => {
  return events.filter(event => {
    const eventStart = new Date(event.start as string);
    const eventEnd = new Date(event.end as string);

    if (from && eventEnd < from) {
      return false;
    }

    if (to && eventStart > to) {
      return false;
    }

    return true;
  });
};

export const handler = async (argv: Arguments<ExportEventBuilderOptions & ConfigurationParameters>): Promise<void> => {
  const { dir, fromDate, toDate, logFile, id } = argv;

  const log = new FileLog(logFile);

  const from = fromDate === undefined ? undefined : relativeDate(fromDate);
  const to = toDate === undefined ? undefined : relativeDate(toDate);

  const previouslyExportedEvents = loadJsonFromDirectory<EventWithEditions>(dir, EventWithEditions);

  const client = dynamicContentClientFactory(argv);

  let hub: Hub;
  try {
    hub = await client.hubs.get(argv.hubId);
  } catch (e) {
    log.error(`Couldn't get hub with id ${argv.hubId}, aborting.`, e);
    await log.close();
    return;
  }

  let filteredEvents: Event[];
  if (id) {
    try {
      filteredEvents = [await client.events.get(id)];
      log.appendLine(`Exporting single event ${filteredEvents[0].name}.`);
    } catch (e) {
      log.error(`Failed to get event with id ${id}, aborting.`, e);
      await log.close();
      return;
    }
  } else {
    try {
      const storedEvents = await paginator(hub.related.events.list);

      filteredEvents = filterEvents(storedEvents, from, to);

      log.appendLine(`Exporting ${filteredEvents.length} of ${storedEvents.length} events...`);
    } catch (e) {
      log.error(`Failed to list events.`, e);
      filteredEvents = [];
    }
  }

  await processEvents(dir, previouslyExportedEvents, filteredEvents, log);

  log.appendLine(`Done.`);

  await log.close();
};
