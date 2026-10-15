/**
 * NYC Urban Mobility Strategy - Interactive Citywide Atlas
 * Complete multi-layered GIS & analytical web application
 * Authoritative evidence baseline: LODES 2023, ACS 2022, CMS 2024, ATMS speeds, GTFS subway/bus, Stage 5 OTP
 */

// Global State
const state = {
  currentModule: 'overview',
  activeTimeband: 'AM_PEAK',
  robustOnlyTraffic: true,
  originMetric: 'to_manhattan_crz', // or 'to_manhattan'
  screenedOnlyOpportunity: false,
  selectedOD: {
    origin: 'O1_FRESH_MEADOWS_188',
    destination: 'D1_MIDTOWN_EAST_GCT',
    time: 'AM Peak Core (08:00 AM)'
  },
  layers: {},
  data: {},
  chart: null,
  drawerOpen: true
};

// Initialize Leaflet Map
const map = L.map('map', {
  center: [40.7128, -73.9352],
  zoom: 11,
  minZoom: 9,
  maxZoom: 18,
  zoomSnap: 0.25,
  zoomControl: false
});

// Add Zoom Control to Top-Left below title
L.control.zoom({ position: 'topleft' }).addTo(map);

// Add Clean Executive CartoDB Positron Basemap Tiles
const basemap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
// Let viewers switch between the street map and a satellite photo
const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19
});
L.control.layers({ 'Street map': basemap, 'Satellite': satellite }, null, { position: 'bottomright', collapsed: false }).addTo(map);

// Palette shared with the deck: charcoal, greys and one orange accent
const C = { ink: '#1a1a1a', dark: '#2b2b2b', mid: '#5c5c5c', steel: '#8a8a8a', grey: '#b8b8b8', light: '#e2e2e2', orange: '#c8532a', brick: '#a8441f', brown: '#6b3a22' };

// Layer Groups
const lgBoroughs = L.layerGroup();
const lgCRZ = L.layerGroup();
const lgGateways = L.layerGroup();
const lgTraffic = L.layerGroup();
const lgOrigins = L.layerGroup();
const lgOpportunity = L.layerGroup();
const lgTransit = L.layerGroup();
const lgBuses = L.layerGroup();
const lgJourneys = L.layerGroup();
const lgScenarios = L.layerGroup();
const lgSolutions = L.layerGroup();

// Color Helpers
function getTrafficSpeedColor(diffMph) {
  if (diffMph === null || diffMph === undefined) return C.light;
  if (diffMph > 2.0) return C.dark;    // faster
  if (diffMph < -2.0) return C.orange; // slower
  return C.grey;                       // little change
}

function getLODESChoroplethColor(val) {
  return val > 2000 ? '#5f2713' :
         val > 1200 ? '#8f3a1b' :
         val > 600  ? '#c8532a' :
         val > 250  ? '#df8a66' :
         val > 100  ? '#efbfa8' :
         val > 0    ? '#f8e6dc' : '#f4f4f4';
}

function getDriveAloneChoroplethColor(pct) {
  return pct > 60 ? '#5f2713' :
         pct > 45 ? '#a8441f' :
         pct > 30 ? '#d6754f' :
         pct > 20 ? '#efbfa8' :
         pct > 0  ? '#f8e6dc' : '#f4f4f4';
}

// Data Fetching
async function loadAtlasData() {
  try {
    const fetchJson = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load ${url}: ${res.statusText}`);
      return await res.json();
    };

    const [
      boroughs,
      crzGeofence,
      gateways,
      traffic,
      commuterLodes,
      carOpportunity,
      subwayStations,
      busRoutes,
      otpJourneys,
      stage5Matrix,
      locationSolutions
    ] = await Promise.all([
      fetchJson('data/nyc_boroughs.geojson'),
      fetchJson('data/nyc_crz_geofence.geojson'),
      fetchJson('data/crz_gateways.geojson'),
      fetchJson('data/traffic_speeds_all_bands.geojson'),
      fetchJson('data/census_tracts_commuter_lodes.geojson'),
      fetchJson('data/census_tracts_car_opportunity.geojson'),
      fetchJson('data/transit_subway_stations.geojson'),
      fetchJson('data/transit_bus_routes_29.json'),
      fetchJson('data/otp_verified_10_itineraries.geojson'),
      fetchJson('data/stage5_scenario_results.json'),
      fetchJson('data/location_solutions.geojson')
    ]);

    state.data = {
      boroughs,
      crzGeofence,
      gateways,
      traffic,
      commuterLodes,
      carOpportunity,
      subwayStations,
      busRoutes,
      otpJourneys,
      stage5Matrix,
      locationSolutions
    };

    initMapLayers();
    enableHover();
    const start = (location.hash || '').slice(1);
    setModule(STEPS.some(x => x[0] === start) ? start : 'overview');
    const loader = document.getElementById('map-loading');
    if (loader) loader.remove();
  } catch (err) {
    console.error('Atlas initialization error:', err);
    document.getElementById('map').innerHTML = `
      <div class="p-8 text-center bg-red-50 text-red-900 border border-red-300 rounded-lg m-8 max-w-xl mx-auto shadow-lg">
        <h2 class="text-lg font-bold mb-2">Error Loading Spatial Datasets</h2>
        <p class="text-xs text-red-700">${err.message}</p>
        <p class="text-[11px] text-slate-500 mt-3">Ensure you are serving this directory via an HTTP server (e.g. GitHub Pages or local webserver) so fetch requests succeed.</p>
      </div>`;
  }
}

// Hover: outline the shape under the mouse and keep the tooltip style consistent
function enableHover() {
  function enhance(l) {
    if (!(l instanceof L.Path) || l._hov || l.options.interactive === false) return;
    l._hov = true;
    const t = l.getTooltip && l.getTooltip();
    if (t) { t.options.className = 'atlas-tip'; t.options.direction = 'auto'; t.options.offset = [12, 0]; t.options.opacity = 1; }
    let base = null;
    l.on('mouseover', () => {
      base = { weight: l.options.weight, color: l.options.color, opacity: l.options.opacity, fillOpacity: l.options.fillOpacity };
      const poly = l instanceof L.Polygon;
      const isZone = poly && l.feature && !l.feature.properties.GEOID;
      if (isZone) return;
      l.setStyle(poly ? { weight: 2.5, color: C.ink, opacity: 1 } : { weight: (base.weight || 3) + 3, opacity: 1 });
      if (!poly) l.bringToFront();
    });
    l.on('mouseout', () => { if (base) l.setStyle(base); });
  }
  function walk(l) { if (l.eachLayer) l.eachLayer(walk); enhance(l); }
  [lgBoroughs, lgCRZ, lgGateways, lgTraffic, lgOrigins, lgOpportunity, lgTransit, lgBuses, lgJourneys, lgScenarios, lgSolutions].forEach(walk);
  map.on('layeradd', e => walk(e.layer));
}

// Layer Initializers
function initMapLayers() {
  // 1. Boroughs Layer
  L.geoJSON(state.data.boroughs, {
    style: (feature) => ({
      color: C.mid,
      weight: 1.2,
      opacity: 0.7,
      fillColor: C.grey,
      fillOpacity: 0.03,
      interactive: false
    }),
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(`<strong>${feature.properties.borough_name || 'Borough'}</strong>`, { sticky: true });
      layer.on('click', () => inspectBorough(feature.properties));
    }
  }).addTo(lgBoroughs);

  // 2. CRZ Geofence
  L.geoJSON(state.data.crzGeofence, {
    style: {
      color: C.orange,
      weight: 2.5,
      opacity: 1,
      fillColor: C.orange,
      fillOpacity: 0.07,
      interactive: false
    },
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(`<strong>Congestion pricing zone</strong><br>Manhattan south of 60th St`, { sticky: true });
      layer.on('click', () => inspectCRZGeofence());
    }
  }).addTo(lgCRZ);

  // 3. Gateways
  state.data.gateways.features.forEach(ft => {
    const coords = [ft.geometry.coordinates[1], ft.geometry.coordinates[0]];
    const p = ft.properties;
    const radius = Math.max(6, Math.min(18, Math.sqrt(p.weekday_entries) / 20));

    const marker = L.circleMarker(coords, {
      radius: radius,
      fillColor: C.dark,
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    });

    marker.bindTooltip(`
      <strong>${p.name}</strong><br>${p.weekday_entries.toLocaleString()} vehicles a weekday (${p.share_pct}% of all crossings)
    `, { sticky: true });

    marker.on('click', () => inspectGateway(p));
    marker.addTo(lgGateways);
  });

  // 4. Traffic Speeds
  buildTrafficLayer();

  // 5. Commuter Origins (LODES)
  buildOriginsLayer();

  // 6. Car Dependence & Opportunity
  buildOpportunityLayer();

  // 7. Transit Stations (496 Parent Stations)
  state.data.subwayStations.features.forEach(ft => {
    const coords = [ft.geometry.coordinates[1], ft.geometry.coordinates[0]];
    const p = ft.properties;

    const marker = L.circleMarker(coords, {
      radius: 3,
      fillColor: C.mid,
      color: '#ffffff',
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.9
    });

    marker.bindTooltip(`<strong>${p.name}</strong><br>Subway station`, { sticky: true });
    marker.on('click', () => inspectSubwayStation(p));
    marker.addTo(lgTransit);
  });

  // 8. Monitored Bus Corridors (29 Routes)
  // Representative corridor alignments linking borough hubs
  buildBusCorridorLayer();

  // 9. Multimodal Journeys (M01 - M10)
  L.geoJSON(state.data.otpJourneys, {
    style: (feature) => ({
      color: feature.properties.market_id === 'M01' ? C.orange :
             feature.properties.market_id === 'M02' ? C.brown :
             feature.properties.market_id === 'M07' ? C.dark : C.steel,
      weight: ['M01', 'M02', 'M07'].includes(feature.properties.market_id) ? 5 : 3,
      opacity: ['M01', 'M02', 'M07'].includes(feature.properties.market_id) ? 0.95 : 0.6
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`<strong>${p.market_name}</strong><br>${p.total_min} min door to door<br>Walking ${p.walk_min} min &middot; waiting ${p.wait_min} min<br><em>Schematic line, not the actual route</em>`, { sticky: true });
      layer.on('click', () => inspectJourney(p));
    }
  }).addTo(lgJourneys);

  // 10. Targeted Solutions (C01 - C04)
  L.geoJSON(state.data.locationSolutions, {
    style: (feature) => ({
      color: feature.properties.corridor_id === 'C04' ? C.orange :
             feature.properties.corridor_id === 'C01' ? C.brick :
             feature.properties.corridor_id === 'C02' ? C.dark : C.steel,
      weight: 6,
      opacity: 0.9
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`<strong>${p.corridor_id}: ${p.name}</strong><br>${p.origin}<br><em>Schematic line. Click for details</em>`, { sticky: true });
      layer.on('click', () => inspectSolution(p));
    }
  }).addTo(lgSolutions);
}

// Dynamic Builders for Toggleable Layers
function buildTrafficLayer() {
  lgTraffic.clearLayers();
  const band = state.activeTimeband;

  L.geoJSON(state.data.traffic, {
    filter: (feature) => {
      if (state.robustOnlyTraffic && !feature.properties.is_robust) return false;
      return true;
    },
    style: (feature) => {
      const tb = feature.properties.timebands ? feature.properties.timebands[band] : null;
      const diff = tb ? tb.diff_mph : feature.properties.am_diff_mph;
      const isBQE = feature.properties.is_bqe_deck_repair;

      return {
        color: isBQE ? C.brown : getTrafficSpeedColor(diff),
        weight: isBQE ? 5 : (feature.properties.is_robust ? 4 : 2),
        opacity: feature.properties.is_robust ? 0.9 : 0.45,
        dashArray: isBQE ? '6, 3' : null
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const tb = p.timebands ? p.timebands[band] : null;
      const s24 = tb ? tb.speed_2024 : p.am_speed_2024;
      const s25 = tb ? tb.speed_2025 : p.am_speed_2025;
      const diff = tb ? tb.diff_mph : p.am_diff_mph;
      const cov = tb ? tb.coverage : p.am_coverage;

      layer.bindTooltip(`
        <strong>${p.link_name}</strong><br>${p.borough}<br>
        2024: ${s24 !== null ? s24.toFixed(1) + ' mph' : 'n/a'} &rarr; 2025: ${s25 !== null ? s25.toFixed(1) + ' mph' : 'n/a'}<br>
        <strong>Change: ${diff !== null ? (diff > 0 ? '+' : '') + diff.toFixed(1) + ' mph' : 'n/a'}</strong>
        ${p.is_bqe_deck_repair ? '<br>Deck repairs were under way in 2025' : ''}
      `, { sticky: true });

      layer.on('click', () => inspectTrafficLink(p, tb));
    }
  }).addTo(lgTraffic);
}

function buildOriginsLayer() {
  lgOrigins.clearLayers();
  const metric = state.originMetric;

  L.geoJSON(state.data.commuterLodes, {
    style: (feature) => {
      const val = feature.properties[metric] || 0;
      return {
        fillColor: getLODESChoroplethColor(val),
        fillOpacity: 0.62,
        weight: 0.4,
        color: '#ffffff',
        opacity: 0.8
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`
        <strong>Census tract ${p.GEOID}</strong><br>${p.borough}<br>
        Residents working in the zone: <strong>${p.to_manhattan_crz.toLocaleString()}</strong><br>
        Working anywhere in Manhattan: ${p.to_manhattan.toLocaleString()}
      `, { sticky: true });

      layer.on('click', () => inspectOriginTract(p));
    }
  }).addTo(lgOrigins);
}

function buildOpportunityLayer() {
  lgOpportunity.clearLayers();

  L.geoJSON(state.data.carOpportunity, {
    filter: (feature) => {
      if (state.screenedOnlyOpportunity && !feature.properties.is_screened_tract) return false;
      return true;
    },
    style: (feature) => {
      const p = feature.properties;
      const pct = p.acs_drive_alone_share_pct || 0;
      return {
        fillColor: getDriveAloneChoroplethColor(pct),
        fillOpacity: p.is_screened_tract ? 0.75 : 0.45,
        weight: p.is_screened_tract ? 1.5 : 0.4,
        color: p.is_screened_tract ? C.ink : '#ffffff',
        opacity: 0.8
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`
        <strong>Census tract ${p.GEOID}</strong><br>${p.borough}<br>
        Drive alone to work: <strong>${p.acs_drive_alone_share_pct != null ? p.acs_drive_alone_share_pct.toFixed(1) + '%' : 'n/a'}</strong><br>
        Take transit: ${p.acs_public_transit_share_pct != null ? p.acs_public_transit_share_pct.toFixed(1) + '%' : 'n/a'}<br>
        Residents working in the zone: ${p.to_manhattan_crz.toLocaleString()}
        ${p.is_screened_tract ? `<br><strong>Shortlisted area</strong>` : ''}
      `, { sticky: true });

      layer.on('click', () => inspectOpportunityTract(p));
    }
  }).addTo(lgOpportunity);
}

function buildBusCorridorLayer() {
  lgBuses.clearLayers();

  // Route lines are approximate (drawn for location only). Speeds and on-time figures come from the MTA file.
  const real = {};
  (state.data.busRoutes || []).forEach(r => { real[r.route_id.toUpperCase()] = r; });
  const pick = (id) => real[id.toUpperCase()] || {};
  const busNodes = [
    { id: 'B46', key: 'B46', name: 'B46 (Utica Ave)', borough: 'Brooklyn', coords: [[40.612, -73.931], [40.670, -73.932], [40.697, -73.987]] },
    { id: 'B41', key: 'B41', name: 'B41 (Flatbush Ave)', borough: 'Brooklyn', coords: [[40.615, -73.928], [40.655, -73.959], [40.694, -73.989]] },
    { id: 'Bx12', key: 'BX12', name: 'Bx12 (Fordham Rd / Pelham Pkwy)', borough: 'Bronx', coords: [[40.865, -73.921], [40.858, -73.890], [40.853, -73.828]] },
    { id: 'Q44', key: 'Q44+', name: 'Q44 Select Bus (Main St)', borough: 'Queens', coords: [[40.702, -73.801], [40.760, -73.830], [40.842, -73.878]] },
    { id: 'M15', key: 'M15', name: 'M15 (First / Second Aves)', borough: 'Manhattan', coords: [[40.702, -74.013], [40.758, -73.965], [40.803, -73.935]] },
    { id: 'Q30', key: 'Q30', name: 'Q30 (Utopia Pkwy, Fresh Meadows)', borough: 'Queens', coords: [[40.708, -73.799], [40.725, -73.793], [40.755, -73.778]], isGap: true },
    { id: 'Bx8', key: 'BX8', name: 'Bx8 (Throggs Neck)', borough: 'Bronx', coords: [[40.825, -73.815], [40.840, -73.832], [40.880, -73.855]], isGap: true }
  ].map(b => Object.assign(b, b.isGap ? { speed: null, wait: null } : { speed: pick(b.key).speed_mph, wait: pick(b.key).wait_assessment_peak_pct }));

  busNodes.forEach(b => {
    const mid = b.coords[1];
    const mk = L.circleMarker(mid, {
      radius: 8, fillColor: b.isGap ? '#ffffff' : (b.speed < 7.0 ? C.orange : C.dark),
      color: b.isGap ? C.steel : '#ffffff', weight: b.isGap ? 2.5 : 2, dashArray: b.isGap ? '3, 3' : null, fillOpacity: 1
    });
    mk.bindTooltip(`
      <strong>${b.name}</strong><br>${b.borough}<br>
      ${b.isGap ? 'Not in the MTA speed data: speed and reliability unknown' :
        `Morning speed: <strong>${b.speed.toFixed(1)} mph</strong><br>Buses evenly spaced: ${b.wait.toFixed(1)}% of the time`}`, { sticky: true });
    mk.on('click', () => inspectBusRoute(b));
    mk.addTo(lgBuses);
    L.marker(mid, { interactive: false, icon: L.divIcon({ className: 'bus-label', html: `${b.id}${b.isGap ? ' · not measured' : ' · ' + b.speed.toFixed(1) + ' mph'}`, iconSize: null, iconAnchor: [-12, 8] }) }).addTo(lgBuses);
  });
}

// Module Switcher Logic
function setModule(modId) {
  state.currentModule = modId;
  if (history.replaceState) history.replaceState(null, '', '#' + modId);

  // Update tab navigation active styles
  document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
  const activeTab = document.getElementById(`btn-${modId}`);
  if (activeTab) activeTab.classList.add('active');

  // Clear existing active layers from map
  [lgBoroughs, lgCRZ, lgGateways, lgTraffic, lgOrigins, lgOpportunity, lgTransit, lgBuses, lgJourneys, lgScenarios, lgSolutions].forEach(lg => {
    map.removeLayer(lg);
  });

  // Always keep faint borough outline as base orientation
  map.addLayer(lgBoroughs);

  // Frame each view on what it shows
  const NYC = [[40.49, -74.27], [40.92, -73.69]];
  const frames = {
    overview: NYC, traffic: NYC, origins: NYC, opportunity: NYC, transit: NYC, buses: NYC, journeys: NYC,
    congestion: [[40.695, -74.03], [40.775, -73.94]],
    solutions: [[40.60, -74.05], [40.86, -73.70]]
  };
  if (frames[modId]) map.flyToBounds(frames[modId], { duration: 0.6, padding: [10, 10] });

  // Activate specific module layer
  switch (modId) {
    case 'overview':
      map.addLayer(lgCRZ);
      map.addLayer(lgTransit);
      renderOverviewModule();
      break;
    case 'congestion':
      map.addLayer(lgCRZ);
      map.addLayer(lgGateways);
      renderCongestionModule();
      break;
    case 'traffic':
      map.addLayer(lgTraffic);
      renderTrafficModule();
      break;
    case 'origins':
      map.addLayer(lgOrigins);
      map.addLayer(lgCRZ);
      renderOriginsModule();
      break;
    case 'opportunity':
      map.addLayer(lgOpportunity);
      renderOpportunityModule();
      break;
    case 'transit':
      map.addLayer(lgTransit);
      renderTransitModule();
      break;
    case 'buses':
      map.addLayer(lgBuses);
      renderBusesModule();
      break;
    case 'journeys':
      map.addLayer(lgJourneys);
      map.addLayer(lgCRZ);
      renderJourneysModule();
      break;
    case 'scenarios':
      map.addLayer(lgCRZ);
      renderScenariosModule();
      break;
    case 'solutions':
      map.addLayer(lgSolutions);
      map.addLayer(lgCRZ);
      renderSolutionsModule();
      break;
  }

  renderStepNav(modId);
}

// ---------------------------------------------------------------- helpers for the modules
function fmt(n) { return Number(n).toLocaleString('en-US'); }
function legendRow(swatch, text) { return `<div class="flex items-center gap-2">${swatch}<span>${text}</span></div>`; }
function box(color, extra) { return `<span class="inline-block w-3.5 h-3.5 shrink-0" style="background:${color};${extra || ''}"></span>`; }
function line(color, dashed) { return `<span class="inline-block w-5 shrink-0" style="border-top:3px ${dashed ? 'dashed' : 'solid'} ${color}"></span>`; }
function dot(color) { return `<span class="inline-block w-3 h-3 rounded-full shrink-0" style="background:${color};border:1.5px solid #fff;box-shadow:0 0 0 1px ${color}"></span>`; }
function legendBox(title, rows, foot) {
  return `<div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">${title}</div>
    <div class="space-y-1.5 text-slate-700">${rows.join('')}</div>
    ${foot ? `<div class="lg-foot text-[11px] text-slate-500 pt-2">${foot}</div>` : ''}`;
}
function toolbarTitle(text, sub) {
  return `<span class="font-bold text-slate-900 whitespace-nowrap">${text}</span>${sub ? `<span class="tb-sub text-slate-600 whitespace-nowrap">${sub}</span>` : ''}`;
}

// Figures below match the briefing deck and its exhibits (Census LODES 2023, CMS 2024, MTA, NYC DOT).
const ZONE_JOBS = { Manhattan: 401034, Brooklyn: 389274, Queens: 264568, Bronx: 137519, 'Staten Island': 46867 };
const ALL_MN_JOBS = { Manhattan: 532110, Brooklyn: 475957, Queens: 343646, Bronx: 206562, 'Staten Island': 59459 };
const CAR_TRIPS = { Bronx: 102489, Brooklyn: 42408, Queens: 36439, 'Staten Island': 8901 };

// MODULE 1: Citywide Overview
function renderOverviewModule() {
  updateToolbar(toolbarTitle('Citywide overview', 'Five boroughs, the congestion pricing zone and 496 subway stations (lines not drawn)'));
  updateLegend(legendBox('On the map', [
    legendRow(box('transparent', `border:2.5px solid ${C.orange};background:rgba(200,83,42,.08)`), 'Congestion pricing zone (south of 60th St)'),
    legendRow(dot(C.mid), 'Subway station (496); subway lines not drawn'),
    legendRow(line(C.mid), 'Borough boundary')
  ]));
  updateDrawerHeader('Fix the trip to the train, starting in Eastern Queens', 'Congestion pricing cut traffic. On outer-borough transit trips, walking and waiting add about 13–22 minutes; faster feeder buses and easier transfers can shorten them.', 'Overview');
  updateKPIs([
    { label: 'Fewer vehicles a day', val: '67,000', sub: 'entering the zone (−11%)' },
    { label: 'Zone workers from Brooklyn + Queens', val: '52.8%', sub: '653,842 of 1.24 million' },
    { label: 'Walking and waiting', val: '13–22 min', sub: 'of a typical outer-borough trip' },
    { label: 'Saved in the model test', val: '6.2–12.5 min', sub: '6 Union Tpke origins → Midtown East, 8 a.m.' }
  ]);
  renderChart('bar', {
    labels: Object.keys(ZONE_JOBS),
    datasets: [{ label: 'Residents working in the zone', data: Object.values(ZONE_JOBS),
      backgroundColor: Object.keys(ZONE_JOBS).map(b => (b === 'Brooklyn' || b === 'Queens') ? C.orange : C.grey) }]
  }, 'Where people who work in the zone live', 'US Census, 2023');
  setPolicyNote('Jobs show where workers live, not whether they drive. Car trips are counted to all of Manhattan, not only the tolled zone.');
}

// MODULE 2: Congestion Pricing
function renderCongestionModule() {
  updateToolbar(toolbarTitle('Congestion pricing', 'About 67,000 fewer vehicles a day (−11%) in the first six months'));
  updateLegend(legendBox('On the map', [
    legendRow(box('transparent', `border:2.5px solid ${C.orange};background:rgba(200,83,42,.08)`), 'Congestion pricing zone'),
    legendRow(dot(C.dark), 'Entry crossing (size = vehicles a weekday)')
  ], 'The 12 crossings add up to 511,829 a weekday. They use a different method from the official totals.'));
  updateDrawerHeader('Traffic into the zone fell', 'MTA six-month results, 5 Jan – 30 Jun 2025', 'Congestion pricing');
  updateKPIs([
    { label: 'Before tolling', val: '~600,000', sub: 'vehicles a day (official estimate)' },
    { label: 'After tolling', val: '~533,000', sub: 'vehicles a day' },
    { label: 'Busiest crossing', val: 'East 60th St', sub: '79,465 a weekday (15.5%)' },
    { label: 'Top two crossings', val: '26%', sub: 'East 60th St and FDR Drive' }
  ]);
  const gw = state.data.gateways.features.map(f => f.properties).sort((a, b) => b.weekday_entries - a.weekday_entries);
  renderChart('bar', {
    labels: gw.map(g => g.name),
    datasets: [{ label: 'Vehicles a weekday', data: gw.map(g => g.weekday_entries), backgroundColor: gw.map((g, i) => i < 2 ? C.orange : C.grey) }]
  }, 'Vehicles a weekday at each crossing (2025)', 'MTA / NY Open Data', { indexAxis: 'y' });
  setPolicyNote('This shows what changed, not why every change happened. Crossing counts and official totals use different methods, so they do not add up.');
}

// MODULE 3: Highway Speeds
function renderTrafficModule() {
  updateToolbar(`
    ${toolbarTitle('Highway speeds')}
    <label class="flex items-center gap-1.5 text-slate-700 whitespace-nowrap">
      <span>Time of day</span>
      <select id="timeband-select" onchange="setTimeband(this.value)" class="bg-white border border-slate-300 px-2 py-1 text-xs">
        <option value="AM_PEAK" ${state.activeTimeband === 'AM_PEAK' ? 'selected' : ''}>Morning peak (7–9 a.m.)</option>
        <option value="MIDDAY" ${state.activeTimeband === 'MIDDAY' ? 'selected' : ''}>Midday (11 a.m.–2 p.m.)</option>
        <option value="PM_PEAK" ${state.activeTimeband === 'PM_PEAK' ? 'selected' : ''}>Evening peak (4–7 p.m.)</option>
        <option value="WEEKDAY_DAYTIME" ${state.activeTimeband === 'WEEKDAY_DAYTIME' ? 'selected' : ''}>Weekday daytime (6 a.m.–8 p.m.)</option>
        <option value="ALL_WEEKDAY" ${state.activeTimeband === 'ALL_WEEKDAY' ? 'selected' : ''}>All weekday hours</option>
      </select>
    </label>
    <label class="flex items-center gap-1.5 text-slate-700 cursor-pointer whitespace-nowrap">
      <input type="checkbox" id="robust-toggle" ${state.robustOnlyTraffic ? 'checked' : ''} onchange="toggleRobustTraffic(this.checked)" class="accent-[#c8532a]">
      <span>Only roads with good data (80 of 122)</span>
    </label>
  `);
  updateLegend(legendBox('Speed change, 2024 to 2025', [
    legendRow(line(C.dark), 'Faster by more than 2 mph'),
    legendRow(line(C.grey), 'Little change (within 2 mph)'),
    legendRow(line(C.orange), 'Slower by more than 2 mph'),
    legendRow(line(C.brown, true), 'BQE link (deck repairs under way in 2025)')
  ], 'Counts in the panel are for the morning peak. The data shows changes, not their causes.'));
  updateDrawerHeader('Highway speeds barely changed overall', 'Same months (March–June) in 2024 and 2025, NYC DOT sensors', 'Highway speeds');
  updateKPIs([
    { label: 'Roads with good data', val: '80', sub: 'of 122 monitored links' },
    { label: 'Faster', val: '13', sub: 'by more than 2 mph' },
    { label: 'Little change', val: '45', sub: 'within 2 mph' },
    { label: 'Slower', val: '22', sub: 'by more than 2 mph' }
  ]);
  renderChart('bar', {
    labels: ['Faster', 'Little change', 'Slower'],
    datasets: [{ label: 'Roads (morning peak)', data: [13, 45, 22], backgroundColor: [C.dark, C.grey, C.orange] }]
  }, 'Morning-peak roads by speed change', 'NYC DOT');
  setPolicyNote('');
}

function setTimeband(tb) {
  state.activeTimeband = tb;
  buildTrafficLayer();
  renderTrafficModule();
}

function toggleRobustTraffic(val) {
  state.robustOnlyTraffic = val;
  buildTrafficLayer();
}

// MODULE 4: Commuter Origins
function renderOriginsModule() {
  updateToolbar(`
    ${toolbarTitle('Who travels')}
    <label class="flex items-center gap-1.5 text-slate-700 whitespace-nowrap">
      <span>Shade by</span>
      <select id="origin-metric-select" onchange="setOriginMetric(this.value)" class="bg-white border border-slate-300 px-2 py-1 text-xs">
        <option value="to_manhattan_crz" ${state.originMetric === 'to_manhattan_crz' ? 'selected' : ''}>Residents working in the zone</option>
        <option value="to_manhattan" ${state.originMetric === 'to_manhattan' ? 'selected' : ''}>Residents working anywhere in Manhattan</option>
      </select>
    </label>
  `);
  const ramp = [['#5f2713', 'More than 2,000'], ['#8f3a1b', '1,201 – 2,000'], ['#c8532a', '601 – 1,200'], ['#df8a66', '251 – 600'], ['#efbfa8', '101 – 250'], ['#f8e6dc', '1 – 100']];
  updateLegend(legendBox('Workers per census tract', ramp.map(r => legendRow(box(r[0]), r[1])).concat([
    legendRow(box('transparent', `border:2.5px solid ${C.orange}`), 'Congestion pricing zone')])));
  updateDrawerHeader('Brooklyn and Queens supply most zone workers', 'Where people who work in the zone live (US Census, 2023)', 'Who travels');
  updateKPIs([
    { label: 'Zone jobs held by New Yorkers', val: '1,239,262', sub: 'south of 60th St' },
    { label: 'Brooklyn + Queens', val: '52.8%', sub: '653,842 jobs' },
    { label: 'Queens residents', val: fmt(ZONE_JOBS.Queens), sub: fmt(ALL_MN_JOBS.Queens) + ' anywhere in Manhattan' },
    { label: 'Bronx residents', val: fmt(ZONE_JOBS.Bronx), sub: fmt(ALL_MN_JOBS.Bronx) + ' anywhere in Manhattan' }
  ]);
  renderChart('bar', {
    labels: Object.keys(CAR_TRIPS),
    datasets: [{ label: 'Car-driver trips a day', data: Object.values(CAR_TRIPS),
      backgroundColor: Object.keys(CAR_TRIPS).map(b => b === 'Bronx' ? C.orange : C.grey) }]
  }, 'Car-driver trips into all of Manhattan a day', 'NYC DOT survey, 2024');
  setPolicyNote('Jobs show where workers live, not how they travel. Car trips cover all of Manhattan, not only the tolled zone, so the two cannot be combined into "drivers into the zone".');
}

function setOriginMetric(metric) {
  state.originMetric = metric;
  buildOriginsLayer();
}

// MODULE 5: Car Dependence
function renderOpportunityModule() {
  const tracts = state.data.carOpportunity.features.map(f => f.properties);
  const shares = tracts.map(p => p.acs_drive_alone_share_pct).filter(v => v != null).sort((a, b) => a - b);
  const median = shares[Math.floor(shares.length / 2)];
  const screened = tracts.filter(p => p.is_screened_tract).length;
  const bins = [0, 0, 0, 0, 0];
  shares.forEach(v => { bins[v < 10 ? 0 : v < 25 ? 1 : v < 40 ? 2 : v <= 60 ? 3 : 4]++; });

  updateToolbar(`
    ${toolbarTitle('Car dependence')}
    <label class="flex items-center gap-1.5 text-slate-700 cursor-pointer whitespace-nowrap">
      <input type="checkbox" id="screened-toggle" ${state.screenedOnlyOpportunity ? 'checked' : ''} onchange="toggleScreenedOpportunity(this.checked)" class="accent-[#c8532a]">
      <span>Show only shortlisted tracts (${screened})</span>
    </label>
  `);
  const ramp = [['#5f2713', 'More than 60%'], ['#a8441f', '46 – 60%'], ['#d6754f', '31 – 45%'], ['#efbfa8', '21 – 30%'], ['#f8e6dc', '20% or less']];
  updateLegend(legendBox('Commuters who drive alone', ramp.map(r => legendRow(box(r[0]), r[1])), 'Dark outline: shortlisted tract'));
  updateDrawerHeader('Where people still drive to work', 'Share of commuters who drive alone, by census tract (ACS 2018–2022)', 'Car dependence');
  updateKPIs([
    { label: 'Typical tract', val: median.toFixed(1) + '%', sub: 'median share driving alone' },
    { label: 'Shortlisted tracts', val: fmt(screened), sub: 'far from the subway, high drive-alone share' },
    { label: 'East Bronx areas', val: '~57%', sub: 'drive alone (worker-weighted)' },
    { label: 'Eastern Queens areas', val: '~42%', sub: 'drive alone (worker-weighted)' }
  ]);
  renderChart('bar', {
    labels: ['Under 10%', '10–25%', '25–40%', '40–60%', 'Over 60%'],
    datasets: [{ label: 'Census tracts', data: bins, backgroundColor: ['#f8e6dc', '#efbfa8', '#d6754f', '#a8441f', '#5f2713'] }]
  }, 'Census tracts by share driving alone', 'US Census, 2018–2022');
  setPolicyNote('The shortlist is a first screen using modelled car times. It points to places worth studying, not final decisions.');
}

function toggleScreenedOpportunity(val) {
  state.screenedOnlyOpportunity = val;
  buildOpportunityLayer();
  renderOpportunityModule();
}

// MODULE 6: Transit Network
function renderTransitModule() {
  updateToolbar(toolbarTitle('Subway network', '496 stations; few in eastern Queens and the east Bronx'));
  updateLegend(legendBox('On the map', [legendRow(dot(C.mid), 'Subway station')], 'Each station counted once (platforms merged).'));
  updateDrawerHeader('Subway stations thin out at the edges', 'MTA subway stations, counted by borough', 'Subway network');
  updateKPIs([
    { label: 'Subway stations', val: '496', sub: 'each counted once' },
    { label: 'Manhattan', val: '153', sub: '31% of all stations' },
    { label: 'Queens', val: '83', sub: 'the largest borough by area' },
    { label: 'Staten Island', val: '21', sub: 'Staten Island Railway' }
  ]);
  renderChart('bar', {
    labels: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    datasets: [{ label: 'Stations', data: [153, 169, 83, 70, 21], backgroundColor: [C.grey, C.grey, C.orange, C.orange, C.grey] }]
  }, 'Subway stations by borough', 'MTA');
  setPolicyNote('Where the subway is far away, people rely on feeder buses or drive. That is why the feeder buses matter.');
}

// MODULE 7: Bus Operations
function renderBusesModule() {
  const routes = (state.data.busRoutes || []).filter(r => r.speed_mph);
  const avg = routes.reduce((a, r) => a + r.speed_mph, 0) / routes.length;
  const slowest = routes.slice().sort((a, b) => a.speed_mph - b.speed_mph);
  updateToolbar(toolbarTitle('Bus speeds', `7 example routes shown as dots; all ${routes.length} measured routes are in the chart`));
  updateLegend(legendBox('On the map', [
    legendRow(dot(C.dark), 'Measured, 7 mph or faster'),
    legendRow(dot(C.orange), 'Measured, slower than 7 mph'),
    legendRow(box('#fff', `border:2px dashed ${C.steel};border-radius:50%`), 'Not measured: Q30 and Bx8')
  ], 'Each dot marks one point on a route, not the full route line.'));
  updateDrawerHeader('The feeder buses that matter most are not measured', 'MTA bus speeds and wait assessment, weekday mornings', 'Bus speeds');
  updateKPIs([
    { label: 'Routes measured', val: String(routes.length), sub: 'in the MTA speed data' },
    { label: 'Average speed', val: avg.toFixed(1) + ' mph', sub: 'across measured routes' },
    { label: 'Slowest route', val: slowest[0].speed_mph.toFixed(1) + ' mph', sub: slowest[0].route_id + ' (' + slowest[0].borough + ')' },
    { label: 'Q30 and Bx8', val: 'Not measured', sub: 'speed and reliability unknown' }
  ]);
  const ten = slowest.slice(0, 10);
  renderChart('bar', {
    labels: ten.map(r => r.route_id),
    datasets: [{ label: 'Morning speed (mph)', data: ten.map(r => r.speed_mph), backgroundColor: ten.map(r => r.speed_mph < 7 ? C.orange : C.grey) }]
  }, 'The 10 slowest measured routes (mph)', 'MTA, Aug 2026', { indexAxis: 'y' });
  setPolicyNote('The Q30 and Bx8 are not in the MTA data. Other routes\' numbers cannot stand in for them, so measure them first.');
}

// MODULE 8: Journeys
function renderJourneysModule() {
  const js = state.data.otpJourneys.features.map(f => f.properties);
  const mean = k => js.reduce((a, p) => a + p[k], 0) / js.length;
  updateToolbar(toolbarTitle('Door-to-door trips', '10 modelled transit trips; lines are schematic'));
  updateLegend(legendBox('Trips', [
    legendRow(line(C.orange), 'Fresh Meadows → Midtown East (55.6 min)'),
    legendRow(line(C.brown), 'Rosedale → Lower Manhattan (61.9 min)'),
    legendRow(line(C.dark), 'Throggs Neck → Grand Central (71.2 min)'),
    legendRow(line(C.steel), 'Seven other trips')
  ], 'Straight lines join start and end. They are schematic, not the actual bus, subway or rail routes.'));
  updateDrawerHeader('Walking and waiting add about 13–22 minutes', 'Modelled trips on the fall 2026 schedule, not observed commutes', 'Journeys');
  updateKPIs([
    { label: 'Trips modelled', val: String(js.length), sub: 'across the outer boroughs' },
    { label: 'Average trip', val: mean('total_min').toFixed(1) + ' min', sub: 'door to door' },
    { label: 'Average walking', val: mean('walk_min').toFixed(1) + ' min', sub: (100 * mean('walk_min') / mean('total_min')).toFixed(0) + '% of the trip' },
    { label: 'Average riding', val: mean('in_vehicle_min').toFixed(1) + ' min', sub: 'on buses, trains and subway' }
  ]);
  renderChart('bar', {
    labels: ['Fresh Meadows', 'Rosedale', 'Throggs Neck'],
    datasets: [
      { label: 'Walk', data: [17.7, 18.9, 8.4], backgroundColor: C.orange },
      { label: 'Wait', data: [2.5, 3.5, 4.3], backgroundColor: C.brown },
      { label: 'Bus', data: [6.9, 0, 16.0], backgroundColor: C.steel },
      { label: 'Train / subway', data: [28.5, 39.5, 42.5], backgroundColor: C.dark }
    ]
  }, 'Where the time goes (minutes)', 'Trip planner model', { indexAxis: 'y', stacked: true });
  setPolicyNote('In Fresh Meadows, walking is 17.7 of 55.6 minutes and the Q30 ride only 6.9. Bus lanes alone would save little there; shorter walks and easier transfers matter more.');
}

// MODULE 9: Model test on Union Turnpike
function centroidOfTract(geoid) {
  const all = state.data.commuterLodes.features;
  const f = all.find(x => x.properties.GEOID === String(geoid)) || all.find(x => x.properties.GEOID.startsWith(String(geoid).slice(0, 10)));
  return f ? L.geoJSON(f).getBounds().getCenter() : null;
}

function renderScenariosModule() {
  const rows = state.data.stage5Matrix;
  const uniq = (key, label) => [...new Map(rows.map(r => [r[key], r[label]])).entries()];
  const origins = uniq('origin_id', 'origin_name');
  const dests = uniq('dest_id', 'dest_name');
  const times = [...new Set(rows.map(r => r.departure_window))];
  const opt = (pairs, cur) => pairs.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`).join('');
  const short = t => t.split(' (')[0];

  updateToolbar(`
    ${toolbarTitle('Model test')}
    <label class="flex items-center gap-1 text-slate-700 whitespace-nowrap"><span>From</span>
      <select id="scenario-origin" onchange="updateScenarioSelection()" class="bg-white border border-slate-300 px-1.5 py-1 text-xs">${opt(origins.map(([v, t]) => [v, short(t)]), state.selectedOD.origin)}</select></label>
    <label class="flex items-center gap-1 text-slate-700 whitespace-nowrap"><span>To</span>
      <select id="scenario-dest" onchange="updateScenarioSelection()" class="bg-white border border-slate-300 px-1.5 py-1 text-xs">${opt(dests.map(([v, t]) => [v, short(t)]), state.selectedOD.destination)}</select></label>
    <label class="flex items-center gap-1 text-slate-700 whitespace-nowrap"><span>Leaving</span>
      <select id="scenario-time" onchange="updateScenarioSelection()" class="bg-white border border-slate-300 px-1.5 py-1 text-xs">${opt(times.map(t => [t, ({'AM Peak Early (07:30 AM)': '7:30 a.m.', 'AM Peak Core (08:00 AM)': '8:00 a.m.', 'AM Peak Late (08:30 AM)': '8:30 a.m.', 'Midday Off-Peak (12:00 PM)': 'Noon'})[t] || t]), state.selectedOD.time)}</select></label>
  `);
  updateLegend(legendBox('Union Turnpike model test', [
    legendRow(dot(C.orange), 'Selected starting point'),
    legendRow(dot(C.grey), 'Other starting points (6 in all)'),
    legendRow(dot(C.dark), 'Manhattan destination'),
    legendRow(line(C.orange, true), 'Trip shown in the panel (schematic line)')
  ], '6 starting points × 3 destinations × 4 departure times = 72 trips.'));
  updateDrawerHeader('Model test: faster buses and an easier transfer', 'From six Union Turnpike origins to Midtown East at 8 a.m., trips are 6.2–12.5 minutes shorter. Other destinations and times differ; pick them above. A what-if model, not observed results.', 'Model test');

  // map: starting points and destinations from census tract centres
  lgScenarios.clearLayers();
  state.scenarioPts = {};
  origins.concat(dests).forEach(([id, name]) => {
    const r = rows.find(x => x.origin_id === id) ? rows.find(x => x.origin_id === id) : rows.find(x => x.dest_id === id);
    const tract = r.origin_id === id ? r.origin_tract : r.dest_tract;
    const c = centroidOfTract(tract);
    if (c) state.scenarioPts[id] = { c, name };
  });
  map.addLayer(lgScenarios);
  updateScenarioSelection();
}

function updateScenarioSelection() {
  const oSelect = document.getElementById('scenario-origin');
  const dSelect = document.getElementById('scenario-dest');
  const tSelect = document.getElementById('scenario-time');
  if (oSelect) state.selectedOD.origin = oSelect.value;
  if (dSelect) state.selectedOD.destination = dSelect.value;
  if (tSelect) state.selectedOD.time = tSelect.value;

  const match = state.data.stage5Matrix.find(r =>
    r.origin_id === state.selectedOD.origin &&
    r.dest_id === state.selectedOD.destination &&
    r.departure_window === state.selectedOD.time
  ) || state.data.stage5Matrix[0];

  // redraw points and the selected trip
  lgScenarios.clearLayers();
  Object.entries(state.scenarioPts || {}).forEach(([id, pt]) => {
    const isDest = id.startsWith('D');
    const sel = id === match.origin_id || id === match.dest_id;
    L.circleMarker(pt.c, { radius: sel ? 8 : 6, fillColor: isDest ? C.dark : (sel ? C.orange : C.grey), color: '#fff', weight: 2, fillOpacity: 1 })
      .bindTooltip(`<strong>${pt.name}</strong>`, { sticky: true }).addTo(lgScenarios);
  });
  const a = state.scenarioPts[match.origin_id], b = state.scenarioPts[match.dest_id];
  if (a && b) {
    L.polyline([a.c, b.c], { color: C.orange, weight: 3, dashArray: '6, 6', opacity: 0.9, interactive: false }).addTo(lgScenarios);
    map.flyToBounds(L.latLngBounds([a.c, b.c]).pad(0.25), { duration: 0.6 });
  }

  updateKPIs([
    { label: 'Today (modelled)', val: `${match.s0_total_journey_min.toFixed(1)} min`, sub: 'door to door' },
    { label: 'Faster buses only', val: `${match.s1_total_journey_min.toFixed(1)} min`, sub: `saves ${match.s1_feeder_saving_min.toFixed(1)} min` },
    { label: 'Easier transfer only', val: `${match.s2_total_journey_min.toFixed(1)} min`, sub: `saves ${match.s2_transfer_saving_min.toFixed(1)} min` },
    { label: 'Both together', val: `${match.s3_total_journey_min.toFixed(1)} min`, sub: `saves ${match.s3_total_time_saving_min.toFixed(1)} min (${match.s3_pct_improvement.toFixed(1)}%)` }
  ]);
  renderChart('bar', {
    labels: ['Today', 'Faster buses', 'Easier transfer', 'Both'],
    datasets: [{ label: 'Door-to-door minutes', data: [match.s0_total_journey_min, match.s1_total_journey_min, match.s2_total_journey_min, match.s3_total_journey_min],
      backgroundColor: [C.grey, C.steel, C.steel, C.orange] }]
  }, `${match.origin_name.split(' (')[0]} → ${match.dest_name.split(' (')[0]}`, 'Model test');
  setPolicyNote('To Grand Central in the 8 a.m. peak, savings run from 6.2 to 12.5 minutes (average 8.7 minutes, 13.5%). Across all 72 trips the range is 10.3% to 16.5%. This is a model, not a forecast of ridership.');
}

// MODULE 10: Solutions
function renderSolutionsModule() {
  updateToolbar(toolbarTitle('What to do first', 'Four candidate corridors, each to be tested first'));
  updateLegend(legendBox('Candidate corridors', [
    legendRow(line(C.orange), 'C04 Union Turnpike buses + Kew Gardens (start here)'),
    legendRow(line(C.brick), 'C01 Fresh Meadows → Midtown'),
    legendRow(line(C.dark), 'C02 Throggs Neck → Midtown'),
    legendRow(line(C.steel), 'C03 Rosedale → Lower Manhattan')
  ], 'Straight schematic lines from start to end, not actual routes. Click one for the problem, the fix and what still needs measuring.'));
  updateDrawerHeader('Start in Eastern Queens, then measure the Q30 and Bx8', 'Proposals to test; none approved yet', 'What to do first');
  updateKPIs([
    { label: 'Candidate corridors', val: '4', sub: 'all proposed for testing' },
    { label: 'Modelled so far', val: '1', sub: 'Union Tpke → Midtown East, 8 a.m.: 8.7 min average' },
    { label: 'First pilot', val: 'Union Tpke', sub: 'Q46 bus lanes + Kew Gardens transfer' },
    { label: 'Measure first', val: 'Q30, Bx8', sub: 'speed and reliability' }
  ]);
  renderChart('bar', {
    labels: ['Eastern Queens', 'East Bronx', 'Southeast Queens'],
    datasets: [{ label: 'Residents working in the zone', data: [2649, 1454, 651], backgroundColor: [C.orange, C.grey, C.grey] }]
  }, 'Zone jobs held by residents of each candidate area', 'US Census, 2023');
  setPolicyNote('');
}

// Feature Inspectors
function inspectBorough(p) {
  document.getElementById('inspect-type').innerText = 'Borough';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${p.borough_name || 'NYC borough'}</div>
    <div class="text-[11px] text-slate-600 mt-1">Click a tract, road, station or route for its numbers.</div>
  `;
}

function inspectCRZGeofence() {
  document.getElementById('inspect-type').innerText = 'Zone';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-purple-900 text-sm">Congestion pricing zone</div>
    <div class="text-[11px] text-slate-700 mt-1">Manhattan south of 60th Street. The FDR Drive, West Side Highway and Hugh L. Carey Tunnel connections are not tolled.</div>
    <div class="text-[11px] text-slate-700 mt-1">First six months: <strong>~67,000 fewer daily entries (-11%)</strong> compared to baseline.</div>
    <div class="text-[11px] text-slate-700 mt-1">Crossing counts, 2025 weekday total: <strong>511,829</strong>.</div>
  `;
}

function inspectGateway(p) {
  document.getElementById('inspect-type').innerText = 'Crossing';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-purple-900 text-sm">${p.name} </div>
    <div class="text-[11px] text-slate-700 mt-1">Vehicles a weekday: <strong>${p.weekday_entries.toLocaleString()}</strong> (${p.share_pct}% of all crossings)</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-0.5">
      <div>Cars, pickups and vans: <strong>${p.cars_pickups_vans.toLocaleString()}</strong></div>
      <div>Taxis and ride-hail: <strong>${p.tlc_taxi_fhv.toLocaleString()}</strong></div>
      <div>Trucks (single unit): <strong>${p.single_unit_trucks.toLocaleString()}</strong></div>
      <div>Buses: <strong>${p.buses.toLocaleString()}</strong></div>
      <div>Trucks (multi unit): <strong>${p.multi_unit_trucks.toLocaleString()}</strong></div>
      <div>Motorcycles: <strong>${p.motorcycles.toLocaleString()}</strong></div>
    </div>
  `;
}

function inspectTrafficLink(p, tb) {
  const s24 = tb ? tb.speed_2024 : p.am_speed_2024;
  const s25 = tb ? tb.speed_2025 : p.am_speed_2025;
  const diff = tb ? tb.diff_mph : p.am_diff_mph;
  const cov = tb ? tb.coverage : p.am_coverage;
  const days24 = tb ? tb.days_2024 : p.am_days_2024;
  const days25 = tb ? tb.days_2025 : p.am_days_2025;

  document.getElementById('inspect-type').innerText = 'Highway road';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${p.link_name}</div>
    <div class="text-[11px] text-slate-600">Link ID: ${p.link_id} | Borough: ${p.borough}</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
      <div>2024 speed: <strong>${s24 !== null ? s24.toFixed(2) + ' mph' : 'N/A'}</strong> (${days24} days)</div>
      <div>2025 speed: <strong>${s25 !== null ? s25.toFixed(2) + ' mph' : 'N/A'}</strong> (${days25} days)</div>
      <div class="font-semibold ${diff > 2 ? 'text-blue-700' : diff < -2 ? 'text-red-700' : 'text-slate-700'}">
        Change: ${diff !== null ? (diff > 0 ? '+' : '') + diff.toFixed(2) + ' mph' : 'N/A'}
      </div>
      <div>Data quality: <strong>${cov}</strong> (${p.is_robust ? 'used in the analysis' : 'left out: too few days of data'})</div>
      ${p.is_bqe_deck_repair ? '<div class="text-[11px] text-amber-700 font-semibold mt-1">Deck repairs were under way in 2025. This data cannot say what caused the change.</div>' : ''}
    </div>
  `;
}

function inspectOriginTract(p) {
  document.getElementById('inspect-type').innerText = 'Census tract';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">Census tract ${p.GEOID} &middot; ${p.borough}</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
      <div>Residents working in the zone: <strong>${p.to_manhattan_crz.toLocaleString()}</strong> (${p.to_crz_share_pct}% of those working in Manhattan)</div>
      <div>Working anywhere in Manhattan: <strong>${p.to_manhattan.toLocaleString()}</strong></div>
      <div>All working residents: <strong>${p.total_resident_workers.toLocaleString()}</strong></div>
      <div>Drive alone to work: <strong>${p.acs_drive_alone_share_pct != null ? p.acs_drive_alone_share_pct.toFixed(1) + '%' : 'n/a'}</strong></div>
      <div>Take transit: <strong>${p.acs_public_transit_share_pct != null ? p.acs_public_transit_share_pct.toFixed(1) + '%' : 'n/a'}</strong></div>
      <div class="text-slate-500 text-[10px] pt-1">Whole borough: ${p.cms_borough_driver_trips.toLocaleString()} car-driver trips a day into Manhattan (NYC DOT survey)</div>
    </div>
  `;
}

function inspectOpportunityTract(p) {
  document.getElementById('inspect-type').innerText = 'Census tract';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">Census Tract ${p.GEOID} (${p.borough})</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
      <div>Drive alone to work: <strong>${p.acs_drive_alone_share_pct != null ? p.acs_drive_alone_share_pct.toFixed(1) + '%' : 'n/a'}</strong></div>
      <div>Take transit: <strong>${p.acs_public_transit_share_pct != null ? p.acs_public_transit_share_pct.toFixed(1) + '%' : 'n/a'}</strong></div>
      <div>Residents working in the zone: <strong>${p.to_manhattan_crz.toLocaleString()}</strong></div>
      <div>Main problem: <strong>${p.primary_problem_type || 'Not shortlisted'}</strong></div>
      <div>Possible fix: <strong>${p.candidate_intervention_type || '–'}</strong></div>
      <div>Priority: <span class="font-semibold text-indigo-700">${p.priority_class || 'General'}</span></div>
      ${p.priority_cluster_id ? `<div>Cluster: <strong>${p.priority_cluster_id}</strong></div>` : ''}
    </div>
  `;
}

function inspectSubwayStation(p) {
  document.getElementById('inspect-type').innerText = 'Station';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-sky-900 text-sm">${p.name}</div>
    <div class="text-[11px] text-slate-600 mt-1">Subway station (MTA station ID ${p.station_id})</div>
  `;
}

function inspectBusRoute(b) {
  document.getElementById('inspect-type').innerText = 'Bus route';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${b.name}</div>
    <div class="text-[11px] text-slate-600 mt-1">Borough: ${b.borough}</div>
    ${b.isGap ? `
      <div class="p-2 bg-amber-50 border border-amber-200 rounded text-amber-900 text-[11px] mt-2 space-y-1">
        <div class="font-bold">Not measured yet</div>
        <div>Route ${b.id} is <strong>not monitored</strong> in the MTA August 2026 29-route speed file.</div>
        <div>There are no speed or reliability figures for this route, so measure it before planning fixes.</div>
      </div>
    ` : `
      <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
        <div>Morning peak speed: <strong>${b.speed.toFixed(2)} mph</strong></div>
        <div>Buses evenly spaced (wait assessment): <strong>${b.wait.toFixed(1)}%</strong></div>
        <div class="text-slate-500 text-[10px]">Source: MTA bus speeds and wait assessment, August 2026. Route line is approximate.</div>
      </div>
    `}
  `;
}

function inspectJourney(p) {
  document.getElementById('inspect-type').innerText = 'Trip';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${p.market_id}: ${p.market_name}</div>
    <div class="text-[11px] text-slate-700 mt-1">Door to door: <strong>${p.total_min} minutes</strong></div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
      <div>Walking: <strong>${p.walk_min} min</strong> (${((p.walk_min / p.total_min) * 100).toFixed(1)}%)</div>
      <div>Waiting: <strong>${p.wait_min} min</strong></div>
      <div>Riding: <strong>${p.in_vehicle_min} min</strong></div>
      <div class="text-[10px] text-slate-500 pt-1 leading-normal">
        <strong>Legs:</strong><br>${p.legs_summary}
      </div>
    </div>
  `;
}

function inspectSolution(p) {
  document.getElementById('inspect-type').innerText = 'Corridor';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${p.corridor_id}: ${p.name}</div>
    <div class="text-[11px] text-slate-600 mt-0.5"><strong>Origin:</strong> ${p.origin}</div>
    <div class="text-[11px] text-slate-600"><strong>Destination:</strong> ${p.destination}</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1.5">
      <div><strong>The problem:</strong><br><span class="text-slate-700">${p.difficulty}</span></div>
      <div><strong>What to build:</strong><br><span class="text-slate-800 font-medium">${p.proposed_response}</span></div>
      <div><strong>Why it helps:</strong><br><span class="text-slate-700">${p.why_helps}</span></div>
      <div class="text-amber-800 bg-amber-50 p-1.5 rounded border border-amber-200">
        <strong>Still to measure:</strong><br>${p.missing_evidence}
      </div>
      <div class="text-[10px] uppercase font-bold text-slate-500">Status: proposed for testing, not approved</div>
    </div>
  `;
}

// Global UI Updaters
function updateToolbar(html) {
  document.getElementById('map-toolbar').innerHTML = html;
}

function updateLegend(html) {
  document.getElementById('map-legend').innerHTML = html;
}

function updateDrawerHeader(title, subtitle, badge) {
  document.getElementById('drawer-title').innerText = title;
  document.getElementById('drawer-subtitle').innerText = subtitle;
  document.getElementById('drawer-module-badge').innerText = badge;
}

function updateKPIs(items) {
  const container = document.getElementById('drawer-kpis');
  container.innerHTML = items.map(item => `
    <div class="bg-[#f5f5f5] p-3">
      <div class="text-[11px] text-slate-500 leading-tight">${item.label}</div>
      <div class="text-[20px] font-bold text-slate-900 mt-1 leading-none">${item.val}</div>
      <div class="text-[11px] text-slate-500 mt-1 leading-snug">${item.sub}</div>
    </div>
  `).join('');
}

function renderChart(type, data, title, source, opts) {
  opts = opts || {};
  document.getElementById('chart-title').innerText = title;
  const badge = document.getElementById('chart-badge');
  if (badge) badge.innerText = source || '';
  const ctx = document.getElementById('drawer-chart').getContext('2d');
  if (state.chart) state.chart.destroy();
  const horizontal = opts.indexAxis === 'y';
  const n = data.labels ? data.labels.length : 0;
  document.getElementById('drawer-chart').parentElement.style.height = horizontal ? Math.max(176, n * 22 + 40) + 'px' : '176px';
  state.chart = new Chart(ctx, {
    type: type,
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: opts.indexAxis || 'x',
      animation: { duration: 450 },
      plugins: {
        legend: {
          display: type === 'doughnut' || (data.datasets && data.datasets.length > 1),
          position: 'bottom',
          labels: { boxWidth: 10, font: { size: 11 } }
        },
        tooltip: {
          backgroundColor: '#1a1a1a', cornerRadius: 0, padding: 8, displayColors: data.datasets.length > 1,
          callbacks: { label: c => ' ' + (data.datasets.length > 1 ? c.dataset.label + ': ' : '') + Number(horizontal ? c.parsed.x : c.parsed.y).toLocaleString('en-US') }
        }
      },
      scales: type === 'bar' ? {
        x: { stacked: !!opts.stacked, beginAtZero: true, grid: { display: horizontal, color: '#ececec' }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: false } },
        y: { stacked: !!opts.stacked, beginAtZero: true, grid: { display: !horizontal, color: '#ececec' }, ticks: { font: { size: 10 } } }
      } : {}
    }
  });
}

function setPolicyNote(text) {
  const el = document.getElementById('policy-note-text');
  if (el) el.innerText = text;
}

// Global Search
function handleSearch(query) {
  if (!query || query.trim().length < 2) return;
  const q = query.trim().toLowerCase();

  // Search in subway stations
  if (state.data.subwayStations) {
    const stMatch = state.data.subwayStations.features.find(f => 
      f.properties.name.toLowerCase().includes(q) || f.properties.station_id.toLowerCase() === q
    );
    if (stMatch) {
      map.flyTo([stMatch.geometry.coordinates[1], stMatch.geometry.coordinates[0]], 15);
      inspectSubwayStation(stMatch.properties);
      return;
    }
  }

  // Search in Census Tracts (GEOID)
  if (state.data.commuterLodes) {
    const trMatch = state.data.commuterLodes.features.find(f => 
      f.properties.GEOID.toLowerCase().includes(q)
    );
    if (trMatch) {
      map.flyToBounds(L.geoJSON(trMatch).getBounds(), { maxZoom: 15 });
      inspectOriginTract(trMatch.properties);
      return;
    }
  }

  // Search in Gateways
  if (state.data.gateways) {
    const gwMatch = state.data.gateways.features.find(f => 
      f.properties.name.toLowerCase().includes(q)
    );
    if (gwMatch) {
      map.flyTo([gwMatch.geometry.coordinates[1], gwMatch.geometry.coordinates[0]], 14);
      inspectGateway(gwMatch.properties);
      return;
    }
  }

  // Search in Solutions
  if (state.data.locationSolutions) {
    const solMatch = state.data.locationSolutions.features.find(f => 
      f.properties.name.toLowerCase().includes(q) || f.properties.corridor_id.toLowerCase() === q
    );
    if (solMatch) {
      map.flyToBounds(L.geoJSON(solMatch).getBounds().pad(0.2));
      inspectSolution(solMatch.properties);
      return;
    }
  }
}

// Borough Zoom Controller
function zoomToBorough(boro) {
  const views = {
    NYC: { center: [40.7128, -73.9352], zoom: 11 },
    Manhattan: { center: [40.7580, -73.9855], zoom: 13 },
    Brooklyn: { center: [40.6500, -73.9500], zoom: 12 },
    Queens: { center: [40.7282, -73.7949], zoom: 12 },
    Bronx: { center: [40.8448, -73.8648], zoom: 12 },
    'Staten Island': { center: [40.5795, -74.1502], zoom: 12 }
  };

  const target = views[boro] || views.NYC;
  map.flyTo(target.center, target.zoom);
}

// Drawer Collapse Toggle
function toggleDrawer() {
  const drawer = document.getElementById('intel-drawer');
  state.drawerOpen = !state.drawerOpen;
  drawer.classList.toggle('collapsed', !state.drawerOpen);
  document.getElementById('drawer-toggle-text').innerText = state.drawerOpen ? 'Hide panel' : 'Show panel';
  setTimeout(() => map.invalidateSize(), 320);
}

// Step-by-step navigation through the ten views
const STEPS = [['overview', 'Overview'], ['congestion', 'Congestion pricing'], ['traffic', 'Highway speeds'], ['origins', 'Who travels'],
  ['buses', 'Bus speeds'], ['journeys', 'Door-to-door trips'],
  ['scenarios', 'Model test'], ['solutions', 'What to do first']];
function renderStepNav(modId) {
  const el = document.getElementById('step-nav');
  if (!el) return;
  const i = STEPS.findIndex(s => s[0] === modId);
  const prev = STEPS[i - 1], next = STEPS[i + 1];
  el.innerHTML = `
    ${prev ? `<button onclick="setModule('${prev[0]}')" class="step-btn text-left"><small>&larr; Step ${i}</small><b>${prev[1]}</b></button>` : '<span></span>'}
    <span class="text-[11px] text-slate-500 self-center whitespace-nowrap">${i + 1} of ${STEPS.length}</span>
    ${next ? `<button onclick="setModule('${next[0]}')" class="step-btn text-right"><small>Step ${i + 2} &rarr;</small><b>${next[1]}</b></button>` : '<span></span>'}`;
  const reco = document.getElementById('reco');
  if (reco) reco.style.display = modId === 'solutions' ? 'none' : '';
  const tab = document.getElementById('btn-' + modId);
  if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  const body = document.getElementById('drawer-body');
  if (body) body.scrollTop = 0;
  const ic = document.getElementById('inspect-content');
  if (ic) ic.innerHTML = '<p class="text-slate-500">Hover over the map to preview. Click a shape to show its numbers here.</p>';
  const it = document.getElementById('inspect-type');
  if (it) it.innerText = '';
}

// Start Application on Load
window.addEventListener('DOMContentLoaded', () => {
  loadAtlasData();
});
