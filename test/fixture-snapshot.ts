/**
 * A small, hand-written snapshot for unit tests. Dates mirror endoflife.date where noted, but
 * the tests depend only on this file, not on the bundled data, so they never change when the
 * data is refreshed.
 */
import type { Snapshot } from '../src/types.js';

export const TODAY = '2026-10-28';

export const fixtureSnapshot: Snapshot = {
  schemaVersion: 1,
  dataDate: '2026-10-28',
  createdAt: '2026-10-28T12:00:00.000Z',
  source: {
    name: 'endoflife.date',
    method: 'api-v1',
    repository: 'https://github.com/endoflife-date/endoflife.date',
    licence: 'MIT',
    licenceUrl: 'https://github.com/endoflife-date/endoflife.date/blob/master/LICENSE',
  },
  productCount: 9,
  products: [
    {
      name: 'angularjs',
      label: 'AngularJS',
      aliases: ['angular-js'],
      category: 'framework',
      labels: { eoas: null, eol: 'Support', eoes: 'Extended Long Term Support', discontinued: null },
      link: 'https://endoflife.date/angularjs',
      releases: [
        { cycle: '1.8', label: '1.8', releaseDate: '2020-06-04', lts: true, eol: '2021-12-31', eoes: false, latest: '1.8.3', latestDate: '2022-04-07' },
        { cycle: '1.7', label: '1.7', releaseDate: '2018-05-11', lts: false, eol: '2021-12-31', latest: '1.7.9' },
        { cycle: '1.6', label: '1.6', releaseDate: '2016-12-08', lts: false, eol: '2021-12-31', eoes: false, latest: '1.6.10' },
        { cycle: '1.5', label: '1.5', releaseDate: '2016-02-05', lts: false, eol: '2021-12-31', eoes: false, latest: '1.5.11' },
      ],
    },
    {
      name: 'angular',
      label: 'Angular',
      aliases: [],
      category: 'framework',
      labels: { eoas: 'Active Support', eol: 'Security Support', eoes: 'Commercial Support', discontinued: null },
      link: 'https://endoflife.date/angular',
      releases: [
        { cycle: '22', label: '22', releaseDate: '2026-06-03', lts: false, eoas: '2027-06-30', eol: '2028-06-30', eoes: false, latest: '22.2.3' },
        { cycle: '21', label: '21', releaseDate: '2025-11-19', lts: false, eoas: '2026-06-03', eol: '2027-06-30', eoes: false, latest: '21.2.25' },
        { cycle: '20', label: '20', releaseDate: '2025-05-28', lts: false, eoas: '2025-11-19', eol: '2026-11-28', eoes: false, latest: '20.3.34' },
        { cycle: '15', label: '15', releaseDate: '2022-11-16', lts: false, eoas: '2023-05-03', eol: '2024-05-18', eoes: false, latest: '15.2.10' },
      ],
    },
    {
      name: 'dotnet',
      label: 'Microsoft .NET',
      aliases: ['dotnetcore'],
      category: 'framework',
      labels: { eoas: null, eol: 'Support Status', eoes: null, discontinued: null },
      link: 'https://endoflife.date/dotnet',
      releases: [
        { cycle: '11', label: '11', releaseDate: '2026-11-10', lts: false, eol: '2028-11-14' },
        { cycle: '10', label: '10', releaseDate: '2025-11-11', lts: true, eol: '2028-11-14', latest: '10.0.13' },
        { cycle: '9', label: '9', releaseDate: '2024-11-12', lts: false, eol: '2026-11-10', latest: '9.0.21' },
        { cycle: '8', label: '8', releaseDate: '2023-11-14', lts: true, eol: '2026-11-10', latest: '8.0.32' },
        { cycle: '6', label: '6', releaseDate: '2021-11-08', lts: true, eol: '2024-11-12', latest: '6.0.36' },
        { cycle: '3.1', label: 'Core 3.1', releaseDate: '2019-12-03', lts: true, eol: '2022-12-13', latest: '3.1.32' },
        { cycle: '1.0', label: 'Core 1.0', releaseDate: '2016-06-27', lts: false, eol: '2019-06-27', latest: '1.0.16' },
      ],
    },
    {
      name: 'dotnetfx',
      label: 'Microsoft .NET Framework',
      aliases: [],
      category: 'framework',
      labels: { eoas: null, eol: 'Support Status', eoes: null, discontinued: null },
      link: 'https://endoflife.date/dotnetfx',
      releases: [
        { cycle: '4.8.1', label: '4.8.1', releaseDate: '2022-08-09', lts: false, eol: false },
        { cycle: '4.8', label: '4.8', releaseDate: '2019-04-18', lts: false, eol: false },
        { cycle: '4.7.2', label: '4.7.2', releaseDate: '2018-04-30', lts: false, eol: false },
        { cycle: '4.6.2', label: '4.6.2', releaseDate: '2016-08-02', lts: false, eol: '2027-01-12' },
        { cycle: '4.5.2', label: '4.5.2', releaseDate: '2014-05-05', lts: false, eol: '2022-04-26' },
        { cycle: '3.5-sp1', label: '3.5 SP1', releaseDate: '2007-11-19', lts: false, eol: '2029-01-09' },
      ],
    },
    {
      name: 'nodejs',
      label: 'Node.js',
      aliases: ['node'],
      category: 'framework',
      labels: { eoas: 'Active Support', eol: 'Security Support', eoes: 'Commercial Support', discontinued: null },
      link: 'https://endoflife.date/nodejs',
      releases: [
        { cycle: '26', label: '26', releaseDate: '2026-05-05', lts: '2026-10-28', eoas: '2027-10-27', eol: '2029-04-30', latest: '26.13.0' },
        { cycle: '24', label: '24', releaseDate: '2025-05-06', lts: '2025-10-28', eoas: '2026-10-20', eol: '2028-04-30', latest: '24.22.1' },
        { cycle: '22', label: '22', releaseDate: '2024-04-24', lts: '2024-10-29', eoas: '2025-10-21', eol: '2027-04-30', eoes: false, latest: '22.23.4' },
        { cycle: '20', label: '20', releaseDate: '2023-04-18', lts: '2023-10-24', eoas: '2024-10-22', eol: '2026-04-30', eoes: false, latest: '20.20.2' },
        { cycle: '18', label: '18', releaseDate: '2022-04-19', lts: '2022-10-25', eoas: '2023-10-18', eol: '2025-04-30', eoes: false, latest: '18.20.8' },
        { cycle: '12', label: '12', releaseDate: '2019-04-23', lts: '2019-10-21', eoas: '2020-11-30', eol: '2022-04-30', latest: '12.22.12' },
        { cycle: '4', label: '4', releaseDate: '2015-09-09', lts: '2015-10-01', eoas: '2017-04-01', eol: '2018-04-30', latest: '4.9.1' },
      ],
    },
    {
      name: 'mysql',
      label: 'MySQL',
      aliases: [],
      category: 'database',
      labels: { eoas: 'Premier Support', eol: 'Extended Support', eoes: null, discontinued: null },
      link: 'https://endoflife.date/mysql',
      releases: [
        { cycle: '9.7', label: '9.7', releaseDate: '2026-04-21', lts: true, eoas: '2031-04-30', eol: '2034-04-30', latest: '9.7.4' },
        { cycle: '8.4', label: '8.4', releaseDate: '2024-04-30', lts: true, eoas: '2029-04-30', eol: '2032-04-30', latest: '8.4.9' },
        { cycle: '8.0', label: '8.0', releaseDate: '2018-04-19', lts: '2023-07-18', eoas: '2025-04-30', eol: '2026-04-30', latest: '8.0.46' },
        { cycle: '5.7', label: '5.7', releaseDate: '2015-10-09', lts: false, eoas: '2020-10-31', eol: '2023-10-31', latest: '5.7.44' },
      ],
    },
    {
      name: 'postgresql',
      label: 'PostgreSQL',
      aliases: ['postgres', 'pg'],
      category: 'database',
      labels: { eoas: null, eol: 'Support Status', eoes: null, discontinued: null },
      link: 'https://endoflife.date/postgresql',
      releases: [
        { cycle: '18', label: '18', releaseDate: '2025-09-25', lts: false, eol: '2030-11-14', latest: '18.6' },
        { cycle: '14', label: '14', releaseDate: '2021-09-30', lts: false, eol: '2026-11-12', latest: '14.21' },
        { cycle: '12', label: '12', releaseDate: '2019-10-03', lts: false, eol: '2024-11-21', latest: '12.22' },
        { cycle: '9.6', label: '9.6', releaseDate: '2016-09-29', lts: false, eol: '2021-11-11', latest: '9.6.24' },
      ],
    },
    {
      name: 'react',
      label: 'React',
      aliases: [],
      category: 'framework',
      labels: { eoas: 'Active Support', eol: 'Security Support', eoes: null, discontinued: null },
      link: 'https://endoflife.date/react',
      releases: [
        { cycle: '19', label: '19', releaseDate: '2024-12-05', lts: false, eol: false, latest: '19.3.1' },
        { cycle: '18', label: '18', releaseDate: '2022-03-29', lts: false, eoas: '2024-12-05', eol: false, latest: '18.3.1' },
      ],
    },
    {
      name: 'ubuntu',
      label: 'Ubuntu',
      aliases: [],
      category: 'os',
      labels: { eoas: 'Hardware & Maintenance', eol: 'Maintenance & Security Support', eoes: 'Expanded Security Maintenance', discontinued: null },
      link: 'https://endoflife.date/ubuntu',
      releases: [
        { cycle: '24.04', label: "24.04 'Noble Numbat'", codename: 'Noble Numbat', releaseDate: '2024-04-25', lts: true, eoas: '2029-05-31', eol: '2029-05-31', eoes: '2034-04-25' },
        { cycle: '22.04', label: "22.04 'Jammy Jellyfish'", codename: 'Jammy Jellyfish', releaseDate: '2022-04-21', lts: true, eoas: '2024-09-30', eol: '2027-06-01', eoes: '2032-04-09' },
      ],
    },
  ],
};
