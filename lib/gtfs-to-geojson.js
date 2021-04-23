const { clone, omit, uniqBy } = require('lodash');
const gtfs = require('gtfs');
const Timer = require('timer-machine');

const { getRouteName, msToSeconds } = require('./formatters');
const logUtils = require('./log-utils');

const envelope = require('./formats/envelope');
const convex = require('./formats/convex');
const linesAndStops = require('./formats/lines-and-stops');
const lines = require('./formats/lines');
const linesBuffer = require('./formats/lines-buffer');
const linesDissolved = require('./formats/lines-dissolved');
const stops = require('./formats/stops');
const stopsBuffer = require('./formats/stops-buffer');
const stopsDissolved = require('./formats/stops-dissolved');

const { version } = require('../package.json');

const setDefaultConfig = config => {
  const defaults = {
    gtfsToGeoJSONVersion: version,
    bufferSizeMeters: 400,
    outputType: 'agency',
    outputFormat: ['lines-and-stops'],
    skipImport: false,
    verbose: true,
    zipOutput: false
  };

  return Object.assign(defaults, config);
};

const getGeoJSONByFormat = async (config, routeId, directionId) => {
  const allGeo = {};
  if (config.outputFormat.includes('envelope')) {
    allGeo['envelope'] = await envelope(config, routeId, directionId);
  }

  if (config.outputFormat.includes('convex')) {
    allGeo['convex'] = await convex(config, routeId, directionId);
  }

  if (config.outputFormat.includes('lines-and-stops')) {
    allGeo['linesAndStops'] = await linesAndStops(config, routeId, directionId);
  }

  if (config.outputFormat.includes('lines')) {
    allGeo['lines'] = await lines(config, routeId, directionId);
  }

  if (config.outputFormat.includes('lines-buffer')) {
    allGeo['linesBuffer'] = await linesBuffer(config, routeId, directionId);
  }

  if (config.outputFormat.includes('lines-dissolved')) {
    allGeo['linesDissolved'] = await linesDissolved(config, routeId, directionId);
  }

  if (config.outputFormat.includes('stops')) {
    allGeo['stops'] = await stops(config, routeId, directionId);
  }

  if (config.outputFormat.includes('stops-buffer')) {
    allGeo['stopsBuffer'] = await stopsBuffer(config, routeId, directionId);
  }

  if (config.outputFormat.includes('stops-dissolved')) {
    allGeo['stopsDissolved'] = await stopsDissolved(config, routeId, directionId);
  }

  if (Object.keys(allGeo).length > 0) {
    return allGeo;
  }

  throw new Error(`Invalid \`outputFormat\`=${config.outputFormat} supplied in config.json`);
};

const buildGeoJSON = async (agencyKey, config, outputStats) => {
  if (config.outputType === 'route') {
    const routes = await gtfs.getRoutes();
    await Promise.all(routes.map(async route => {
      outputStats.routes += 1;

      const trips = await gtfs.getTrips({
        route_id: route.route_id
      }, [
        'trip_headsign',
        'direction_id'
      ]);

      const directions = uniqBy(trips, trip => trip.trip_headsign);
      const allGeo = {};
      await Promise.all(directions.map(async direction => {
        const geojson = await getGeoJSONByFormat(config, route.route_id, direction.direction_id);
        allGeo[`${getRouteName(route)}_${direction.direction_id}`] = geojson;
      }));
      return allGeo
    }));
  } else if (config.outputType === 'agency') {
    const geojson = await getGeoJSONByFormat(config);
    return geojson;
  } else {
    throw new Error(`Invalid \`outputType\`=${config.outputType} supplied in config.json`);
  }
};

module.exports = async initialConfig => {
  const config = setDefaultConfig(initialConfig);
  config.log = logUtils.log(config);
  config.logWarning = logUtils.logWarning(config);

  await gtfs.openDb(config);
  console.log(config)

  config.log(`Started GeoJSON creation for ${config.agencies.length} agencies.`);

  /* eslint-disable no-await-in-loop */
  for (const agency of config.agencies) {
    const timer = new Timer();
    timer.start();

    const outputStats = {
      routes: 0,
      files: 0
    };

    const agencyKey = agency.agency_key;

    if (config.skipImport !== true) {
      // Import GTFS
      const agencyConfig = clone(omit(config, 'agencies'));
      agencyConfig.agencies = [agency];

      await gtfs.import(agencyConfig);
    }

    config.log(`Starting GeoJSON creation for ${agencyKey}`);
    const geoJson = await buildGeoJSON(agencyKey, config, outputStats);
    config.log(`GeoJSON generation required ${msToSeconds(timer.time())} seconds`);
    return geoJson;
  }
  /* eslint-enable no-await-in-loop */
};
