import { builder, command, handler, enrichEditions, enrichEvents, filterEvents, LOG_FILENAME } from './export';
import dynamicContentClientFactory from '../../services/dynamic-content-client-factory';
import { Event, Edition, Hub, EditionSlot, Page } from 'dc-management-sdk-js';
import Yargs from 'yargs/yargs';
import MockPage from '../../common/dc-management-sdk-js/mock-page';
import { promisify } from 'util';
import { exists, readFile } from 'fs';
import paginator from '../../common/dc-management-sdk-js/paginator';

import rmdir from 'rimraf';
import * as facet from '../../common/filter/facet';

jest.mock('../../services/dynamic-content-client-factory');

jest.mock('../../common/filter/facet', () => ({
  relativeDate: jest
    .fn()
    .mockImplementation((relative: string) => jest.requireActual('../../common/filter/facet').relativeDate(relative))
}));

function rimraf(dir: string): Promise<Error> {
  return new Promise((resolve): void => {
    rmdir(dir, resolve);
  });
}

describe('event export command', () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });
  const yargArgs = {
    $0: 'test',
    _: ['test'],
    json: true,
    silent: true
  };
  const config = {
    clientId: 'client-id',
    clientSecret: 'client-id',
    hubId: 'hub-id'
  };

  it('should command should defined', function() {
    expect(command).toEqual('export <dir>');
  });

  describe('builder tests', function() {
    it('should configure yargs', function() {
      const argv = Yargs(process.argv.slice(2));
      const spyPositional = jest.spyOn(argv, 'positional').mockReturnThis();
      const spyOption = jest.spyOn(argv, 'option').mockReturnThis();

      builder(argv);

      expect(spyPositional).toHaveBeenCalledWith('dir', {
        describe: 'Output directory for the exported Events.',
        type: 'string'
      });

      expect(spyOption).toHaveBeenCalledWith('id', {
        describe: 'Export a single event by ID, rather then fetching all of them.',
        type: 'string'
      });

      expect(spyOption).toHaveBeenCalledWith('fromDate', {
        describe:
          'Start date for filtering events. Either "NOW" or in the format "<number>:<unit>", example: "-7:DAYS".',
        type: 'string'
      });

      expect(spyOption).toHaveBeenCalledWith('toDate', {
        describe: 'To date for filtering events. Either "NOW" or in the format "<number>:<unit>", example: "-7:DAYS".',
        type: 'string'
      });

      expect(spyOption).toHaveBeenCalledWith('logFile', {
        type: 'string',
        default: LOG_FILENAME,
        describe: 'Path to a log file to write to.'
      });
    });
  });

  const mockValues = ({
    status = 'DRAFT',
    deleteResource = false,
    mixedEditions = false,
    getHubError = false,
    getEventError = false,
    listEventError = false,
    listEditionError = false
  }): {
    mockGet: () => void;
    mockEditionsList: () => void;
    getHubMock: () => void;
    mockEventsList: () => void;
    mockSlotsList: () => void;
  } => {
    const mockGet = jest.fn();
    const mockEditionsList = jest.fn();
    const getHubMock = jest.fn();
    const mockEventsList = jest.fn();
    const mockSlotsList = jest.fn();

    (dynamicContentClientFactory as jest.Mock).mockReturnValue({
      hubs: {
        get: getHubMock
      },
      events: {
        get: mockGet
      }
    });

    getHubMock.mockResolvedValue(
      new Hub({
        name: '1',
        id: '1',
        client: {
          fetchLinkedResource: mockEventsList
        },
        _links: {
          events: {
            href: 'https://api.amplience.net/v2/content/events',
            templated: true
          }
        },
        related: {
          events: {
            list: mockEventsList
          }
        }
      })
    );

    mockEventsList.mockResolvedValue(
      new MockPage(Event, [
        new Event({
          id: 'test1',
          name: 'test1',
          start: '2021-05-05T12:00:00.000Z',
          end: '2021-05-06T12:00:00.000Z',
          client: {
            fetchLinkedResource: mockEditionsList
          },
          _links: {
            editions: {
              href: 'https://api.amplience.net/v2/content/events/1/editions{?projection,page,size,sort}',
              templated: true
            },
            delete: {
              href: 'https://api.amplience.net/v2/content/events/1'
            },
            archive: {
              href: 'https://api.amplience.net/v2/content/events/1/archive'
            }
          },
          related: {
            editions: {
              list: mockEditionsList
            }
          }
        }),
        new Event({
          id: 'test2',
          name: 'test2',
          start: '2021-05-07T12:00:00.000Z',
          end: '2021-05-08T12:00:00.000Z',
          client: {
            fetchLinkedResource: mockEditionsList
          },
          _links: {
            editions: {
              href: 'https://api.amplience.net/v2/content/events/2/editions{?projection,page,size,sort}',
              templated: true
            },
            delete: {
              href: 'https://api.amplience.net/v2/content/events/2'
            },
            archive: {
              href: 'https://api.amplience.net/v2/content/events/2/archive'
            }
          },
          related: {
            editions: {
              list: mockEditionsList
            }
          }
        })
      ])
    );

    mockGet.mockResolvedValue(
      new Event({
        name: 'test1',
        id: '1',
        start: '2021-05-05T12:00:00.000Z',
        end: '2021-05-06T12:00:00.000Z',
        client: {
          fetchLinkedResource: mockEditionsList
        },
        _links: {
          editions: {
            href: 'https://api.amplience.net/v2/content/events/1/editions{?projection,page,size,sort}',
            templated: true
          },
          delete: !deleteResource && {
            href: 'https://api.amplience.net/v2/content/events/1'
          },
          archive: {
            href: 'https://api.amplience.net/v2/content/events/1/archive'
          }
        },
        related: {
          editions: {
            list: mockEditionsList
          }
        }
      })
    );

    const editions = [
      new Edition({
        name: 'ed1',
        id: 'ed1',
        publishingStatus: status,
        client: {
          fetchLinkedResource: mockSlotsList
        },
        _links: {
          'list-slots': {
            href: 'https://api.amplience.net/v2/content/editions/ed1/slots{?includedSlots}',
            templated: true
          },
          archive: {
            href: 'https://api.amplience.net/v2/content/editions/ed1/archive'
          },
          delete: {
            href: 'https://api.amplience.net/v2/content/editions/ed1'
          },
          schedule: {
            href: 'https://api.amplience.net/v2/content/editions/ed1/schedule'
          }
        }
      })
    ];

    const slots = [
      new EditionSlot({
        id: 'slot1',
        eventId: 'test1',
        editionId: 'ed1',
        createdDate: '2021-05-06T09:52:27.065Z',
        lastModifiedDate: '2021-05-06T09:52:27.065Z',
        content: { body: { _meta: { schema: 'http://schema.com/test.json', name: 'example-slot-test' } } },
        status: 'VALID',
        slotStatus: 'ACTIVE',
        contentTypeId: 'testType',
        slotId: 'testSlotId',
        slotLabel: 'example-slot-test',
        conflicts: false,
        locale: null,
        empty: true,
        _links: {
          self: {
            href: 'https://api.amplience.net/v2/content/editions/ed1/slots/slot1'
          },
          'edition-slot': {
            href: 'https://api.amplience.net/v2/content/editions/ed1/slots/slot1'
          },
          edition: {
            href: 'https://api.amplience.net/v2/content/editions/ed1'
          },
          slot: {
            href: 'https://api.amplience.net/v2/content/content-items/testSlotId{?projection}',
            templated: true
          },
          content: {
            href: 'https://api.amplience.net/v2/content/editions/ed1/slots/slot1/content'
          },
          'safe-update-content': {
            href:
              'https://api.amplience.net/v2/content/editions/ed1/slots/slot1/content{?lastModifiedDate,page,size,sort}',
            templated: true
          }
        }
      })
    ];

    if (mixedEditions) {
      editions.push(
        new Edition({
          name: 'ed2',
          id: 'ed2',
          publishingStatus: 'PUBLISHED',
          client: {
            fetchLinkedResource: mockEventsList
          },
          _links: {
            archive: {
              href: 'https://api.amplience.net/v2/content/editions/ed2/archive'
            },
            delete: {
              href: 'https://api.amplience.net/v2/content/editions/ed2'
            },
            schedule: {
              href: 'https://api.amplience.net/v2/content/editions/ed2/schedule'
            }
          }
        })
      );
    }
    mockEditionsList.mockResolvedValue(new MockPage(Edition, editions));

    mockSlotsList.mockResolvedValue(new MockPage(EditionSlot, slots));

    if (getHubError) {
      getHubMock.mockRejectedValue(new Error('Error'));
    }

    if (getEventError) {
      mockGet.mockRejectedValue(new Error('Error'));
    }

    if (listEventError) {
      mockEventsList.mockRejectedValue(new Error('Error'));
    }

    if (listEditionError) {
      mockEditionsList.mockRejectedValue(new Error('Error'));
    }

    return {
      mockGet,
      mockEditionsList,
      mockEventsList,
      mockSlotsList,
      getHubMock
    };
  };

  describe('handler tests', function() {
    beforeAll(async () => {
      await rimraf('temp/exportEvent/');
    });

    afterAll(async () => {
      await rimraf('temp/exportEvent/');
    });

    it('should list and export all editions', async () => {
      const { mockEventsList, mockEditionsList, mockSlotsList } = mockValues({});

      const argv = {
        ...yargArgs,
        ...config,
        dir: 'temp/exportEvent/all/',
        logFile: 'temp/exportEvent/all.log'
      };
      await handler(argv);

      expect(mockEventsList).toHaveBeenCalled();
      expect(mockEditionsList).toHaveBeenCalledTimes(2);
      expect(mockSlotsList).toHaveBeenCalledTimes(2);

      const results = [
        await promisify(readFile)('temp/exportEvent/all/test1.json', { encoding: 'utf-8' }),
        await promisify(readFile)('temp/exportEvent/all/test2.json', { encoding: 'utf-8' })
      ];

      const log = await promisify(readFile)('temp/exportEvent/all.log', { encoding: 'utf-8' });

      expect(results).toMatchSnapshot();
      expect(log).toMatchSnapshot();
    });

    it('should list and export a single edition', async () => {
      const { mockEventsList, mockEditionsList, mockSlotsList, mockGet } = mockValues({});

      const argv = {
        ...yargArgs,
        ...config,
        id: 'item1',
        dir: 'temp/exportEvent/single/',
        logFile: 'temp/exportEvent/single.log'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalledWith('item1');
      expect(mockEventsList).not.toHaveBeenCalled();
      expect(mockEditionsList).toHaveBeenCalledTimes(1);
      expect(mockSlotsList).toHaveBeenCalledTimes(1);

      const results = [await promisify(readFile)('temp/exportEvent/single/test1.json', { encoding: 'utf-8' })];

      const log = await promisify(readFile)('temp/exportEvent/single.log', { encoding: 'utf-8' });

      expect(results).toMatchSnapshot();
      expect(log).toMatchSnapshot();
    });

    it('should pass from and to date parameters to filterEvents', async () => {
      const { mockEventsList, mockEditionsList, mockSlotsList } = mockValues({});

      const argv = {
        ...yargArgs,
        ...config,
        dir: 'temp/exportEvent/date/',
        logFile: 'temp/exportEvent/date.log',
        fromDate: '-1:DAYS',
        toDate: '1:DAYS'
      };
      await handler(argv);

      expect((facet.relativeDate as jest.Mock).mock.calls).toMatchInlineSnapshot(`
        Array [
          Array [
            "-1:DAYS",
          ],
          Array [
            "1:DAYS",
          ],
        ]
      `);

      expect(mockEventsList).toHaveBeenCalled();
      expect(mockEditionsList).not.toHaveBeenCalled();
      expect(mockSlotsList).not.toHaveBeenCalled();

      const dirExists = await promisify(exists)('temp/exportEvent/date/');
      const log = await promisify(readFile)('temp/exportEvent/date.log', { encoding: 'utf-8' });

      expect(dirExists).toBeFalsy();
      expect(log).toMatchSnapshot();
    });

    it('should exit early if getting the hub fails', async () => {
      const { getHubMock, mockEventsList, mockEditionsList, mockSlotsList, mockGet } = mockValues({
        getEventError: true,
        getHubError: true
      });

      const argv = {
        ...yargArgs,
        ...config,
        id: 'missing',
        dir: 'temp/exportEvent/noHub/',
        logFile: 'temp/exportEvent/noHub.log'
      };
      await handler(argv);

      expect(getHubMock).toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockEventsList).not.toHaveBeenCalled();
      expect(mockEditionsList).not.toHaveBeenCalled();
      expect(mockSlotsList).not.toHaveBeenCalled();

      const dirExists = await promisify(exists)('temp/exportEvent/noHub/');
      const log = await promisify(readFile)('temp/exportEvent/noHub.log', { encoding: 'utf-8' });

      expect(dirExists).toBeFalsy();
      expect(log).toMatchSnapshot();
    });

    it('should log an error when getting a single event fails', async () => {
      const { mockEventsList, mockEditionsList, mockSlotsList, mockGet } = mockValues({ getEventError: true });

      const argv = {
        ...yargArgs,
        ...config,
        id: 'missing',
        dir: 'temp/exportEvent/singleError/',
        logFile: 'temp/exportEvent/singleError.log'
      };
      await handler(argv);

      expect(mockGet).toHaveBeenCalledWith('missing');
      expect(mockEventsList).not.toHaveBeenCalled();
      expect(mockEditionsList).not.toHaveBeenCalled();
      expect(mockSlotsList).not.toHaveBeenCalled();

      const dirExists = await promisify(exists)('temp/exportEvent/singleError/');
      const log = await promisify(readFile)('temp/exportEvent/singleError.log', { encoding: 'utf-8' });

      expect(dirExists).toBeFalsy();
      expect(log).toMatchSnapshot();
    });

    it('should log an error when listing events fails', async () => {
      const { mockEventsList, mockEditionsList, mockSlotsList, mockGet } = mockValues({ listEventError: true });

      const argv = {
        ...yargArgs,
        ...config,
        dir: 'temp/exportEvent/listError/',
        logFile: 'temp/exportEvent/listError.log'
      };
      await handler(argv);

      expect(mockGet).not.toHaveBeenCalled();
      expect(mockEventsList).toHaveBeenCalled();
      expect(mockEditionsList).not.toHaveBeenCalled();
      expect(mockSlotsList).not.toHaveBeenCalled();

      const dirExists = await promisify(exists)('temp/exportEvent/listError/');
      const log = await promisify(readFile)('temp/exportEvent/listError.log', { encoding: 'utf-8' });

      expect(dirExists).toBeFalsy();
      expect(log).toMatchSnapshot();
    });

    it('should return event file name', async () => {
      const logFile = LOG_FILENAME();

      expect(logFile).toContain('event-export-<DATE>.log');
    });
  });

  describe('enrichEvents tests', () => {
    it('should request and populate editions for each of the provided events', async () => {
      const { mockEventsList, mockEditionsList } = mockValues({});

      const events = await paginator((mockEventsList as unknown) as () => Promise<Page<Event>>);

      await expect(enrichEvents(events)).resolves.toMatchSnapshot();

      expect(mockEditionsList).toHaveBeenCalledTimes(2);
    });

    it('should omit events when fetching their editions failed', async () => {
      const { mockEventsList, mockEditionsList } = mockValues({ listEditionError: true });

      const events = await paginator((mockEventsList as unknown) as () => Promise<Page<Event>>);

      await expect(enrichEvents(events)).resolves.toEqual([]);

      expect(mockEditionsList).toHaveBeenCalledTimes(2);
    });

    it('should return empty array if no events provided', async () => {
      expect(enrichEvents([])).resolves.toEqual([]);
    });
  });

  describe('enrichEditions tests', () => {
    it('should request and populate slots for each of the provided editions', async () => {
      const { mockEditionsList, mockSlotsList } = mockValues({});

      const editions = await paginator((mockEditionsList as unknown) as () => Promise<Page<Edition>>);

      await expect(enrichEditions(editions)).resolves.toMatchSnapshot();

      expect(mockSlotsList).toHaveBeenCalledTimes(1);
    });

    it('should return empty array if no editions provided', async () => {
      expect(enrichEditions([])).resolves.toEqual([]);
    });
  });

  describe('filterEvents tests', () => {
    const testEvents = [
      new Event({ start: '2021-01-01T12:00:00.000Z', end: '2021-05-05T12:00:00.000Z' }),
      new Event({ start: '2021-04-04T12:00:00.000Z', end: '2021-06-06T12:00:00.000Z' }),
      new Event({ start: '2021-08-08T12:00:00.000Z', end: '2021-09-09T12:00:00.000Z' }),
      new Event({ start: '2021-01-01T12:00:00.000Z', end: '2021-10-10T12:00:00.000Z' })
    ];

    it('should return the input events if from and to are undefined', async () => {
      expect(filterEvents(testEvents, undefined, undefined)).toEqual(testEvents);
    });

    it('should filter out events from before the from date when provided', async () => {
      expect(filterEvents(testEvents, new Date('2021-08-08T12:00:00.000Z'), undefined)).toEqual(testEvents.slice(2));
    });

    it('should filter out events from after the to date when provided', async () => {
      expect(filterEvents(testEvents, undefined, new Date('2021-07-07T12:00:00.000Z'))).toEqual([
        testEvents[0],
        testEvents[1],
        testEvents[3]
      ]);
    });

    it('should filter out events outwith the from and to dates when both are provided', async () => {
      expect(
        filterEvents(testEvents, new Date('2021-05-06T12:00:00.000Z'), new Date('2021-07-07T12:00:00.000Z'))
      ).toEqual([testEvents[1], testEvents[3]]);
    });
  });
});
