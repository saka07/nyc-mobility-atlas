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
  minZoom: 10,
  maxZoom: 18,
  zoomControl: false
});

// Add Zoom Control to Top-Left below title
L.control.zoom({ position: 'topleft' }).addTo(map);

// Add Clean Executive CartoDB Positron Basemap Tiles
const basemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);

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
  if (diffMph === null || diffMph === undefined) return '#94a3b8';
  if (diffMph > 2.0) return '#2563eb'; // Faster (Blue)
  if (diffMph < -2.0) return '#dc2626'; // Slower (Red)
  return '#64748b'; // Stable (Gray)
}

function getLODESChoroplethColor(val) {
  return val > 2000 ? '#7c2d12' :
         val > 1200 ? '#c2410c' :
         val > 600  ? '#ea580c' :
         val > 250  ? '#f97316' :
         val > 100  ? '#fdba74' :
         val > 0    ? '#ffedd5' : '#f8fafc';
}

function getDriveAloneChoroplethColor(pct) {
  return pct > 60 ? '#991b1b' :
         pct > 45 ? '#dc2626' :
         pct > 30 ? '#ea580c' :
         pct > 20 ? '#f59e0b' :
         pct > 10 ? '#eab308' :
         pct > 0  ? '#fef08a' : '#f8fafc';
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

    console.log('All 11 atlas spatial datasets loaded successfully.');
    initMapLayers();
    setModule('overview');
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

// Layer Initializers
function initMapLayers() {
  // 1. Boroughs Layer
  L.geoJSON(state.data.boroughs, {
    style: (feature) => ({
      color: '#334155',
      weight: 1.5,
      opacity: 0.8,
      fillColor: '#94a3b8',
      fillOpacity: 0.08
    }),
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(`<strong>${feature.properties.BoroName || 'Borough'}</strong>`, { sticky: true });
      layer.on('click', () => inspectBorough(feature.properties));
    }
  }).addTo(lgBoroughs);

  // 2. CRZ Geofence
  L.geoJSON(state.data.crzGeofence, {
    style: {
      color: '#7c3aed',
      weight: 3,
      opacity: 0.9,
      fillColor: '#8b5cf6',
      fillOpacity: 0.18,
      dashArray: '4, 4'
    },
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(`<strong>Manhattan CBD Tolling Zone (South of 60th St)</strong>`, { sticky: true });
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
      fillColor: '#9333ea',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    });

    marker.bindTooltip(`
      <div class="font-bold text-xs text-purple-900">${p.name}</div>
      <div class="text-[11px] text-slate-700">Entries: <strong>${p.weekday_entries.toLocaleString()}</strong> (${p.share_pct}%)</div>
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
      radius: 3.5,
      fillColor: '#0284c7',
      color: '#ffffff',
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.85
    });

    marker.bindTooltip(`<strong>${p.name}</strong><br><span class="text-[10px] text-slate-500">Parent Station #${p.station_id}</span>`, { sticky: true });
    marker.on('click', () => inspectSubwayStation(p));
    marker.addTo(lgTransit);
  });

  // 8. Monitored Bus Corridors (29 Routes)
  // Representative corridor alignments linking borough hubs
  buildBusCorridorLayer();

  // 9. Multimodal Journeys (M01 - M10)
  L.geoJSON(state.data.otpJourneys, {
    style: (feature) => ({
      color: feature.properties.market_id === 'M01' ? '#0284c7' :
             feature.properties.market_id === 'M02' ? '#10b981' :
             feature.properties.market_id === 'M03' ? '#f59e0b' : '#6366f1',
      weight: 4,
      opacity: 0.85
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`<strong>${p.market_id}: ${p.market_name}</strong><br>Total Time: ${p.total_min} min (Walk: ${p.walk_min} min)`, { sticky: true });
      layer.on('click', () => inspectJourney(p));
    }
  }).addTo(lgJourneys);

  // 10. Targeted Solutions (C01 - C04)
  L.geoJSON(state.data.locationSolutions, {
    style: (feature) => ({
      color: feature.properties.corridor_id === 'C01' ? '#0284c7' :
             feature.properties.corridor_id === 'C02' ? '#dc2626' :
             feature.properties.corridor_id === 'C03' ? '#16a34a' : '#d97706',
      weight: 6,
      opacity: 0.9
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`<strong>${p.corridor_id}: ${p.name}</strong><br>${p.origin}`, { sticky: true });
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
        color: isBQE ? '#f59e0b' : getTrafficSpeedColor(diff),
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
        <div class="font-bold text-xs text-slate-900">${p.link_name}</div>
        <div class="text-[11px] text-slate-600">Borough: ${p.borough} | Link: ${p.link_id}</div>
        <div class="text-[11px] mt-1">2024: <strong>${s24 !== null ? s24.toFixed(1) + ' mph' : 'N/A'}</strong> &rarr; 2025: <strong>${s25 !== null ? s25.toFixed(1) + ' mph' : 'N/A'}</strong></div>
        <div class="text-[11px] font-semibold ${diff > 2 ? 'text-blue-700' : diff < -2 ? 'text-red-700' : 'text-slate-700'}">Change: ${diff !== null ? (diff > 0 ? '+' : '') + diff.toFixed(2) + ' mph' : 'N/A'} (${cov})</div>
        ${p.is_bqe_deck_repair ? '<div class="text-[10px] text-amber-700 font-bold mt-1">Planned BQE Deck Repair Link</div>' : ''}
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
        fillOpacity: 0.65,
        weight: 0.5,
        color: '#94a3b8',
        opacity: 0.5
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`
        <div class="font-bold text-xs">Tract ${p.GEOID} (${p.borough})</div>
        <div class="text-[11px] text-slate-700">CRZ Jobs: <strong>${p.to_manhattan_crz.toLocaleString()}</strong> (${p.to_crz_share_pct}%)</div>
        <div class="text-[11px] text-slate-700">Total Manhattan Jobs: <strong>${p.to_manhattan.toLocaleString()}</strong></div>
        <div class="text-[11px] text-slate-500 mt-0.5">Borough Driver Trips to Manhattan: ${p.cms_borough_driver_trips.toLocaleString()} (CMS)</div>
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
        fillOpacity: p.is_screened_tract ? 0.85 : 0.5,
        weight: p.is_screened_tract ? 1.5 : 0.4,
        color: p.is_screened_tract ? '#1e293b' : '#cbd5e1',
        opacity: 0.7
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(`
        <div class="font-bold text-xs">Tract ${p.GEOID} (${p.borough})</div>
        <div class="text-[11px] text-slate-800">Drive-Alone Share: <strong>${p.acs_drive_alone_share_pct.toFixed(1)}%</strong></div>
        <div class="text-[11px] text-slate-700">Transit Share: ${p.acs_public_transit_share_pct.toFixed(1)}%</div>
        <div class="text-[11px] text-slate-700">CRZ Jobs: ${p.to_manhattan_crz.toLocaleString()}</div>
        ${p.is_screened_tract ? `<div class="text-[10px] font-bold text-indigo-800 mt-1">Screened Priority: ${p.priority_class || 'Candidate'}</div>` : ''}
      `, { sticky: true });

      layer.on('click', () => inspectOpportunityTract(p));
    }
  }).addTo(lgOpportunity);
}

function buildBusCorridorLayer() {
  lgBuses.clearLayers();

  // Representative corridor routes across boroughs
  const busNodes = [
    { id: 'B46', name: 'B46 / B46-SBS (Utica Ave)', borough: 'Brooklyn', coords: [[40.612, -73.931], [40.670, -73.932], [40.697, -73.987]], speed: 7.43, wait: 57.3 },
    { id: 'B41', name: 'B41 (Flatbush Ave)', borough: 'Brooklyn', coords: [[40.615, -73.928], [40.655, -73.959], [40.694, -73.989]], speed: 7.50, wait: 59.0 },
    { id: 'Bx12', name: 'Bx12 / Bx12-SBS (Pelham Pkwy / Fordham Rd)', borough: 'Bronx', coords: [[40.865, -73.921], [40.858, -73.890], [40.853, -73.828]], speed: 6.80, wait: 64.2 },
    { id: 'Q44', name: 'Q44-SBS (Main St / Parsons Blvd)', borough: 'Queens', coords: [[40.702, -73.801], [40.760, -73.830], [40.842, -73.878]], speed: 7.20, wait: 66.8 },
    { id: 'M15', name: 'M15 / M15-SBS (First/Second Aves)', borough: 'Manhattan', coords: [[40.702, -74.013], [40.758, -73.965], [40.803, -73.935]], speed: 6.10, wait: 68.5 },
    // EXPLICIT UNMEASURED / DATA GAP CALLOUTS FOR Q30 and Bx8
    { id: 'Q30', name: 'Q30 (Utopia Pkwy / Fresh Meadows)', borough: 'Queens', coords: [[40.708, -73.799], [40.725, -73.793], [40.755, -73.778]], speed: null, wait: null, isGap: true },
    { id: 'Bx8', name: 'Bx8 (Williamsbridge Rd / Throggs Neck)', borough: 'Bronx', coords: [[40.825, -73.815], [40.840, -73.832], [40.880, -73.855]], speed: null, wait: null, isGap: true }
  ];

  busNodes.forEach(b => {
    const poly = L.polyline(b.coords, {
      color: b.isGap ? '#d97706' : (b.speed < 7.0 ? '#dc2626' : '#2563eb'),
      weight: b.isGap ? 4 : 5,
      opacity: 0.85,
      dashArray: b.isGap ? '5, 5' : null
    });

    poly.bindTooltip(`
      <div class="font-bold text-xs">${b.name}</div>
      <div class="text-[11px] text-slate-700">Borough: ${b.borough}</div>
      ${b.isGap ? 
        '<div class="text-[10px] text-amber-700 font-bold mt-1">DATA GAP: Not included in MTA 29-route monitored speed file. Route reliability unmeasured.</div>' :
        `<div class="text-[11px] mt-1">AM Peak Speed: <strong>${b.speed.toFixed(1)} mph</strong> | Peak Wait Assessment: <strong>${b.wait.toFixed(1)}%</strong></div>`
      }
    `, { sticky: true });

    poly.on('click', () => inspectBusRoute(b));
    poly.addTo(lgBuses);
  });
}

// Module Switcher Logic
function setModule(modId) {
  state.currentModule = modId;

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

  // Re-render icons if Lucide is loaded
  if (window.lucide) lucide.createIcons();
}

// MODULE 1: Citywide Overview
function renderOverviewModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">1. Citywide Overview:</span>
    <span class="text-slate-600">All 5 NYC Boroughs, CBD Tolling Geofence, and 496 Parent Subway Stations</span>
    <span class="bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded text-[11px]">8.34M Residents</span>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Citywide Geometry</div>
    <div class="space-y-1.5 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-3.5 h-3.5 rounded-sm bg-slate-400 opacity-30 border border-slate-600"></span> 5 NYC Borough Boundaries</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3.5 rounded-sm bg-purple-500 opacity-40 border border-purple-700"></span> Manhattan CBD Tolling Zone (&lt;60th St)</div>
      <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-sky-600 border border-white"></span> 496 Parent Subway Stations</div>
    </div>
  `);

  updateDrawerHeader('Citywide Diagnostic Baseline', 'Overview across five boroughs and core Manhattan tolling zone', 'Overview');

  updateKPIs([
    { label: 'Total NYC Population', val: '8.34M', sub: '2020-2023 Census estimate' },
    { label: 'CBD Tolling Entries', val: '511,829', sub: '2025 weekday gateway total' },
    { label: 'Manhattan Payroll Jobs', val: '1.29M', sub: 'LODES 2023 CRZ destination' },
    { label: 'Subway Parent Stations', val: '496', sub: 'GTFS deduplicated nodes' }
  ]);

  renderChart('bar', {
    labels: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    datasets: [{
      label: 'Resident Commuters to CRZ Jobs (LODES 2023)',
      data: [454500, 376200, 268400, 154200, 39100],
      backgroundColor: '#0284c7'
    }]
  }, 'Commuter Jobs Destined for CBD Tolling Zone by Borough');

  setPolicyNote('LODES measures formal wage/salary jobs by employer filings, not commuter modal choice or car trips. Tolling impacts must be verified empirically before capital commitments.');
}

// MODULE 2: Congestion Pricing
function renderCongestionModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">2. Congestion Pricing Toll Zone:</span>
    <span class="text-slate-600">60th St Cordon &amp; 12 Gateway Monitoring Portals</span>
    <span class="bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded text-[11px]">-67,000 Daily Entries (-11%)</span>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Congestion Pricing Cordon</div>
    <div class="space-y-1.5 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-3.5 h-3.5 rounded-sm bg-purple-500 opacity-40 border border-purple-700"></span> CBD Tolling Zone (MTA Geofence)</div>
      <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-purple-600 border border-white"></span> 12 Entry Gateways (Sized by Volume)</div>
      <div class="text-[10px] text-slate-500 pt-1">Total: 511,829 observed 2025 weekday entries</div>
    </div>
  `);

  updateDrawerHeader('Congestion Relief Zone Performance', 'Authoritative MTA 6-month tolling results and gateway breakdown', 'Congestion Pricing');

  updateKPIs([
    { label: 'Official 6-Mo Net Impact', val: '-67,000', sub: 'entries/day (-11% vs baseline)' },
    { label: 'Observed Weekday Gateway Sum', val: '511,829', sub: '12 monitored gateways' },
    { label: 'Passenger Car & FHV Share', val: '88.4%', sub: '452,456 daily crossings' },
    { label: 'Commercial Truck & Bus Share', val: '10.9%', sub: '55,934 daily crossings' }
  ]);

  renderChart('doughnut', {
    labels: ['Passenger Cars / Pickups / Vans', 'TLC FHV & Yellow Cabs', 'Single-Unit Trucks', 'Buses', 'Multi-Unit Trucks', 'Motorcycles'],
    datasets: [{
      data: [255280, 197176, 38148, 14210, 3576, 3439],
      backgroundColor: ['#0284c7', '#38bdf8', '#f59e0b', '#10b981', '#ef4444', '#a855f7']
    }]
  }, 'Vehicle Classification Share Across 12 Monitored Gateways');

  setPolicyNote('Official MTA reporting measures approximately 67,000 fewer daily entries (-11%) during the first six months. Do not equate the local 511,829 weekday gateway sum to historical whole-cordon averages.');
}

// MODULE 3: Highway Speeds
function renderTrafficModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">3. Highway Traffic Speeds:</span>
    <label class="flex items-center gap-1.5 font-medium text-slate-700">
      <span>Timeband:</span>
      <select id="timeband-select" onchange="setTimeband(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-0.5 text-xs font-semibold">
        <option value="AM_PEAK" ${state.activeTimeband === 'AM_PEAK' ? 'selected' : ''}>AM Peak (07:00-09:00)</option>
        <option value="MIDDAY" ${state.activeTimeband === 'MIDDAY' ? 'selected' : ''}>Midday (11:00-14:00)</option>
        <option value="PM_PEAK" ${state.activeTimeband === 'PM_PEAK' ? 'selected' : ''}>PM Peak (16:00-19:00)</option>
        <option value="WEEKDAY_DAYTIME" ${state.activeTimeband === 'WEEKDAY_DAYTIME' ? 'selected' : ''}>Weekday Daytime (06:00-20:00)</option>
        <option value="ALL_WEEKDAY" ${state.activeTimeband === 'ALL_WEEKDAY' ? 'selected' : ''}>All Weekday (00:00-24:00)</option>
      </select>
    </label>
    <label class="flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
      <input type="checkbox" id="robust-toggle" ${state.robustOnlyTraffic ? 'checked' : ''} onchange="toggleRobustTraffic(this.checked)" class="rounded text-sky-600">
      <span>Robust Links Only (80/122)</span>
    </label>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Speed Change (2024 vs 2025)</div>
    <div class="space-y-1.5 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-3.5 h-1 bg-blue-600"></span> Faster (&gt; +2.0 mph) &mdash; 13 links</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1 bg-slate-500"></span> Stable (&plusmn;2.0 mph) &mdash; 45 links</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1 bg-red-600"></span> Slower (&lt; -2.0 mph) &mdash; 22 links</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1 bg-amber-500 border-dashed"></span> Planned BQE Deck Repair Link 4616229</div>
    </div>
  `);

  updateDrawerHeader('NYC Highway Traffic Performance', 'March-June 2024 vs March-June 2025 validated ATMS sensor records', 'Traffic Performance');

  updateKPIs([
    { label: 'Robust Monitored Links', val: '80', sub: 'of 122 total sensor links' },
    { label: 'Faster Corridors (>+2mph)', val: '13', sub: '16.3% of robust links' },
    { label: 'Stable Corridors (±2mph)', val: '45', sub: '56.3% of robust links' },
    { label: 'Slower Corridors (<-2mph)', val: '22', sub: '27.5% of robust links' }
  ]);

  renderChart('bar', {
    labels: ['Faster (>+2mph)', 'Stable (±2mph)', 'Slower (<-2mph)'],
    datasets: [{
      label: 'AM Peak Robust Links (80 total)',
      data: [13, 45, 22],
      backgroundColor: ['#2563eb', '#64748b', '#dc2626']
    }]
  }, 'AM Peak Monitored Highway Speed Trajectory (2024 vs 2025)');

  setPolicyNote('BQE Link 4616229 observed speed decline is primarily attributable to scheduled city DOT deck repair work, not regional toll diversion. Speeds do not prove absence of regional traffic displacement.');
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
    <span class="font-bold text-slate-800">4. Commuter Origins &amp; Jobs:</span>
    <label class="flex items-center gap-1.5 font-medium text-slate-700">
      <span>Choropleth Metric:</span>
      <select id="origin-metric-select" onchange="setOriginMetric(this.value)" class="bg-slate-100 border border-slate-300 rounded px-2 py-0.5 text-xs font-semibold">
        <option value="to_manhattan_crz" ${state.originMetric === 'to_manhattan_crz' ? 'selected' : ''}>CRZ Jobs (South of 60th St)</option>
        <option value="to_manhattan" ${state.originMetric === 'to_manhattan' ? 'selected' : ''}>All Manhattan Jobs</option>
      </select>
    </label>
    <span class="bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded text-[11px]">2,327 Census Tracts</span>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Resident Commuter Jobs (LODES)</div>
    <div class="space-y-1 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#7c2d12]"></span> &gt; 2,000 jobs</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#c2410c]"></span> 1,201 &ndash; 2,000 jobs</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#ea580c]"></span> 601 &ndash; 1,200 jobs</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#f97316]"></span> 251 &ndash; 600 jobs</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#fdba74]"></span> 101 &ndash; 250 jobs</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#ffedd5]"></span> 1 &ndash; 100 jobs</div>
    </div>
  `);

  updateDrawerHeader('Commuter Origins & Employment Flows', 'Formal LEHD LODES 2023 employer reporting at census tract resolution', 'Origins & Demand');

  updateKPIs([
    { label: 'Total NYC Payroll Jobs', val: '3.86M', sub: 'LODES 2023 JT00 baseline' },
    { label: 'Manhattan CRZ Jobs', val: '1.29M', sub: 'destined south of 60th St' },
    { label: 'Queens CRZ Jobs', val: '268,400', sub: '343,646 to all Manhattan' },
    { label: 'Bronx CRZ Jobs', val: '154,200', sub: '206,562 to all Manhattan' }
  ]);

  renderChart('bar', {
    labels: ['Queens', 'Bronx', 'Brooklyn', 'Staten Island', 'Manhattan'],
    datasets: [
      {
        label: 'CRZ Destination Jobs (LODES)',
        data: [268400, 154200, 376200, 39100, 454500],
        backgroundColor: '#ea580c'
      },
      {
        label: 'Daily Car Trips to Manhattan (CMS 2024)',
        data: [36439, 102489, 42408, 45951, 67613],
        backgroundColor: '#64748b'
      }
    ]
  }, 'Commuter Jobs vs Boroughwide CMS Driver Trips to Manhattan');

  setPolicyNote('Strictly separate LODES payroll jobs from CMS car trips. LODES counts jobs, not individual commuters or vehicle trips. CMS car trips represent all-Manhattan travel, not CBD-only tolled entries.');
}

function setOriginMetric(metric) {
  state.originMetric = metric;
  buildOriginsLayer();
}

// MODULE 5: Car Dependence & Opportunity
function renderOpportunityModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">5. Car Dependence &amp; Transit Gaps:</span>
    <label class="flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
      <input type="checkbox" id="screened-toggle" ${state.screenedOnlyOpportunity ? 'checked' : ''} onchange="toggleScreenedOpportunity(this.checked)" class="rounded text-sky-600">
      <span>Screened Candidate Tracts Only (310/2,327)</span>
    </label>
    <span class="bg-red-100 text-red-800 font-semibold px-2 py-0.5 rounded text-[11px]">ACS 5-Yr Drive Alone: 0% - 81.4%</span>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Drive-Alone Commuting Share (ACS)</div>
    <div class="space-y-1 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#991b1b]"></span> &gt; 60% Drive-Alone</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#dc2626]"></span> 45% &ndash; 60%</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#ea580c]"></span> 30% &ndash; 45%</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#f59e0b]"></span> 20% &ndash; 30%</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-3 rounded-sm bg-[#fef08a]"></span> &lt; 20%</div>
      <div class="text-[10px] text-indigo-900 font-bold pt-1">Dark borders: 310 Screened Diagnostic Tracts</div>
    </div>
  `);

  updateDrawerHeader('Car Dependence & Priority Screening', 'ACS 2018-2022 modal shares cross-tabulated with outer-borough transit deserts', 'Car Dependence');

  updateKPIs([
    { label: 'Screened Candidate Tracts', val: '310', sub: 'outer-borough priority subset' },
    { label: 'Max Drive-Alone Rate', val: '81.4%', sub: 'Fresh Meadows / SE Queens' },
    { label: 'Median Drive-Alone Rate', val: '26.8%', sub: 'citywide census tract median' },
    { label: 'Target Priority Clusters', val: '5', sub: 'Eastern Queens, Bronx, S. Brooklyn' }
  ]);

  renderChart('bar', {
    labels: ['0-10%', '10-25%', '25-40%', '40-60%', '>60%'],
    datasets: [{
      label: 'Census Tracts by Drive-Alone Share',
      data: [642, 814, 510, 281, 80],
      backgroundColor: ['#fef08a', '#f59e0b', '#ea580c', '#dc2626', '#991b1b']
    }]
  }, 'Citywide Census Tract Drive-Alone Commuter Distribution');

  setPolicyNote('The 310 screened tracts represent candidate priority zones based on uncalibrated free-flow car times and subset criteria. They are candidates for further study, not final investment commitments.');
}

function toggleScreenedOpportunity(val) {
  state.screenedOnlyOpportunity = val;
  buildOpportunityLayer();
}

// MODULE 6: Transit Network
function renderTransitModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">6. Public Transport Network:</span>
    <span class="text-slate-600">496 GTFS Parent Stations (Platform Duplicates Removed)</span>
    <span class="bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded text-[11px]">0.5-Mile Catchments</span>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Subway Infrastructure</div>
    <div class="space-y-1.5 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-sky-600 border border-white"></span> 496 Parent Subway Stations</div>
      <div class="text-[10px] text-slate-500 pt-1">Parent stations deduplicated from 1,488 GTFS platform stop records.</div>
    </div>
  `);

  updateDrawerHeader('Subway Network & Physical Reach', 'MTA GTFS parent station locations and outer-borough rapid transit coverage', 'Transit Network');

  updateKPIs([
    { label: 'Parent Subway Stations', val: '496', sub: 'deduplicated parent nodes' },
    { label: 'Subway Lines Operated', val: '25', sub: 'trunk & express services' },
    { label: 'Manhattan Stations', val: '151', sub: '30.4% of system' },
    { label: 'Outer-Borough Deserts', val: '42%', sub: 'land area >0.5mi from station' }
  ]);

  renderChart('bar', {
    labels: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    datasets: [{
      label: 'Parent Subway Stations by Borough',
      data: [151, 170, 81, 70, 24],
      backgroundColor: '#0284c7'
    }]
  }, 'MTA Parent Subway Stations Distribution by Borough');

  setPolicyNote('Subway access drops dramatically in Eastern Queens and the East Bronx, forcing high dependence on feeder buses or highway commuting.');
}

// MODULE 7: Bus Operations
function renderBusesModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">7. Bus Corridors &amp; Reliability:</span>
    <span class="text-slate-600">29 Monitored Corridors (August 2026 Peak Speeds)</span>
    <span class="bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded text-[11px]">Data Gap Disclosed</span>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Bus Corridors &amp; Gaps</div>
    <div class="space-y-1.5 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-4 h-1 bg-blue-600"></span> Monitored Route (&gt;7.0 mph)</div>
      <div class="flex items-center gap-2"><span class="w-4 h-1 bg-red-600"></span> Monitored Route (&lt;7.0 mph)</div>
      <div class="flex items-center gap-2"><span class="w-4 h-1 bg-amber-600 border-dashed"></span> DATA GAP: Q30 &amp; Bx8 (Unmeasured)</div>
    </div>
  `);

  updateDrawerHeader('Bus Operations & Speed Gaps', 'MTA bus speed performance file (29 routes) and unmonitored route disclosures', 'Bus Operations');

  updateKPIs([
    { label: 'Monitored Corridors', val: '29', sub: 'in official MTA speed file' },
    { label: 'Average Peak Speed', val: '7.8 mph', sub: 'across 29 monitored routes' },
    { label: 'Slowest Corridor', val: '5.4 mph', sub: 'M15 Local in Manhattan' },
    { label: 'Q30 & Bx8 Coverage', val: '0%', sub: 'DATA GAP: Not monitored' }
  ]);

  renderChart('bar', {
    labels: ['B46-SBS', 'B100', 'B41', 'B46', 'Q44-SBS', 'B38', 'B57', 'M15'],
    datasets: [{
      label: 'AM Peak Monitored Speed (mph)',
      data: [9.72, 8.64, 7.50, 7.43, 7.20, 6.48, 6.44, 6.10],
      backgroundColor: '#0284c7'
    }]
  }, 'Monitored Bus Corridor Speeds (MTA August 2026)');

  setPolicyNote('CRITICAL DATA GAP: Routes Q30 and Bx8 are 100% absent from the 29-route monitored bus speed dataset. Do not use B46 or B41 reliability numbers to justify interventions on Q30 or Bx8.');
}

// MODULE 8: Door-to-Door Multimodal Journeys
function renderJourneysModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">8. Door-to-Door Multimodal Journeys:</span>
    <span class="text-slate-600">All 10 Audited Itineraries (M01 - M10)</span>
    <span class="bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded text-[11px]">OTP Verified</span>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Audited Journeys</div>
    <div class="space-y-1.5 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-3.5 h-1 bg-[#0284c7]"></span> M01: Fresh Meadows to Midtown (55.6 min)</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1 bg-[#10b981]"></span> M02: Rosedale to Lower Manhattan (61.9 min)</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1 bg-[#f59e0b]"></span> M03: Throggs Neck to Midtown (71.3 min)</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1 bg-[#6366f1]"></span> M04-M10: Outer-Borough Corridors</div>
    </div>
  `);

  updateDrawerHeader('Door-to-Door Journey Breakdown', 'Audited multimodal OTP itineraries isolating walking, waiting, and transit running times', 'Journey Analysis');

  updateKPIs([
    { label: 'Audited Corridors', val: '10', sub: 'M01 through M10' },
    { label: 'Mean Journey Time', val: '62.4 min', sub: 'door-to-door transit trip' },
    { label: 'Average Walking Time', val: '15.8 min', sub: '25.3% of total commute' },
    { label: 'Average In-Vehicle Time', val: '41.2 min', sub: 'bus + rail/subway legs' }
  ]);

  renderChart('bar', {
    labels: ['M01 Fresh Meadows', 'M02 Rosedale', 'M03 Throggs Neck'],
    datasets: [
      { label: 'Walking & Transfer (min)', data: [17.7, 18.9, 12.8], backgroundColor: '#f97316' },
      { label: 'Feeder Bus (min)', data: [6.9, 0, 16.0], backgroundColor: '#0284c7' },
      { label: 'Subway / Rail (min)', data: [28.5, 39.5, 42.5], backgroundColor: '#6366f1' },
      { label: 'Waiting Time (min)', data: [2.5, 3.5, 0], backgroundColor: '#94a3b8' }
    ]
  }, 'Door-to-Door Commute Time Breakdown (Minutes)');

  setPolicyNote('On journey M01 (Fresh Meadows), walking and transfers consume 17.7 minutes (31.8% of the trip), while the bus ride is only 6.9 minutes. Bus priority cannot resolve walking burdens without better connections.');
}

// MODULE 9: Intervention Scenarios
function renderScenariosModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">9. Simulation Matrix (72 Cells):</span>
    <label class="flex items-center gap-1 font-medium text-slate-700">
      <span>Origin:</span>
      <select id="scenario-origin" onchange="updateScenarioSelection()" class="bg-slate-100 border border-slate-300 rounded px-1.5 py-0.5 text-xs font-semibold">
        <option value="O1_FRESH_MEADOWS_188">O1 Fresh Meadows (188th St)</option>
        <option value="O2_FRESH_MEADOWS_UTOPIA">O2 Fresh Meadows (Utopia)</option>
        <option value="O3_OAKLAND_GARDENS_SPRINGFIELD">O3 Oakland Gardens</option>
        <option value="O4_BELL_BLVD_UNION_TPKE">O4 Bell Blvd</option>
        <option value="O5_CUNNINGHAM_PARK_193">O5 Cunningham Park</option>
        <option value="O6_HOLLIS_HILLS_SPRINGFIELD">O6 Hollis Hills</option>
      </select>
    </label>
    <label class="flex items-center gap-1 font-medium text-slate-700">
      <span>Dest:</span>
      <select id="scenario-dest" onchange="updateScenarioSelection()" class="bg-slate-100 border border-slate-300 rounded px-1.5 py-0.5 text-xs font-semibold">
        <option value="D1_MIDTOWN_EAST_GCT">D1 Midtown East (GCT)</option>
        <option value="D2_MIDTOWN_WEST_PENN">D2 Midtown West (Penn)</option>
        <option value="D3_LOWER_MANHATTAN_FULTON">D3 Lower Manhattan (Fulton)</option>
      </select>
    </label>
    <label class="flex items-center gap-1 font-medium text-slate-700">
      <span>Time:</span>
      <select id="scenario-time" onchange="updateScenarioSelection()" class="bg-slate-100 border border-slate-300 rounded px-1.5 py-0.5 text-xs font-semibold">
        <option value="AM Peak Core (08:00 AM)">AM Peak Core (08:00 AM)</option>
        <option value="AM Peak Early (07:30 AM)">AM Peak Early (07:30 AM)</option>
        <option value="AM Peak Late (08:30 AM)">AM Peak Late (08:30 AM)</option>
        <option value="Off-Peak Midday (12:00 PM)">Off-Peak Midday (12:00 PM)</option>
      </select>
    </label>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Stage 5 Policy Scenarios</div>
    <div class="space-y-1.5 text-slate-600">
      <div><strong>S0:</strong> Baseline Transit (No Intervention)</div>
      <div><strong>S1:</strong> Feeder Bus Priority (+20-30% Feeder Speed)</div>
      <div><strong>S2:</strong> Intermodal Transfer Hub (-3 min Transfer Dwell)</div>
      <div><strong>S3:</strong> Combined Feeder + Transfer Priority</div>
      <div class="text-[10px] text-slate-500 pt-1">Matrix: 6 Origins &times; 3 Destinations &times; 4 Departure Windows</div>
    </div>
  `);

  updateDrawerHeader('Stage 5 Multimodal Simulation Explorer', 'Deterministic schedule-based evaluation of arterial feeder and transfer upgrades', 'Intervention Scenarios');

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

  updateKPIs([
    { label: 'S0 Baseline Journey', val: `${match.s0_total_journey_min.toFixed(1)} min`, sub: 'Current scheduled transit time' },
    { label: 'S1 Feeder Priority', val: `${match.s1_total_journey_min.toFixed(1)} min`, sub: `-${match.s1_feeder_saving_min.toFixed(1)} min savings` },
    { label: 'S2 Transfer Hub', val: `${match.s2_total_journey_min.toFixed(1)} min`, sub: `-${match.s2_transfer_saving_min.toFixed(1)} min savings` },
    { label: 'S3 Combined Savings', val: `-${match.s3_total_time_saving_min.toFixed(1)} min`, sub: `${match.s3_pct_improvement.toFixed(1)}% improvement` }
  ]);

  renderChart('bar', {
    labels: ['S0 Baseline', 'S1 Feeder Bus Priority', 'S2 Intermodal Transfer Hub', 'S3 Combined S1+S2'],
    datasets: [{
      label: 'Total Door-to-Door Journey Time (Minutes)',
      data: [
        match.s0_total_journey_min,
        match.s1_total_journey_min,
        match.s2_total_journey_min,
        match.s3_total_journey_min
      ],
      backgroundColor: ['#64748b', '#0284c7', '#8b5cf6', '#10b981']
    }]
  }, `${match.origin_name} &rarr; ${match.dest_name}`);

  setPolicyNote('Midtown East AM Core savings range from 6.2 to 12.5 minutes (11.9% to 15.2%; average 8.7 min / 13.5%). The broader 10.3% to 16.5% range encompasses all 72 cells across all destinations and time bands.');
}

// MODULE 10: Location-Specific Solutions
function renderSolutionsModule() {
  updateToolbar(`
    <span class="font-bold text-slate-800">10. Location-Specific Solutions:</span>
    <span class="text-slate-600">4 Candidate Investment Corridors Proposed for Feasibility Testing</span>
    <span class="bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded text-[11px]">Proposed for Testing</span>
  `);

  updateLegend(`
    <div class="font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">Targeted Corridors</div>
    <div class="space-y-1.5 text-slate-600">
      <div class="flex items-center gap-2"><span class="w-3.5 h-1.5 bg-[#0284c7]"></span> C01: Fresh Meadows to Midtown</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1.5 bg-[#dc2626]"></span> C02: Throggs Neck to Midtown</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1.5 bg-[#16a34a]"></span> C03: Rosedale to Lower Manhattan</div>
      <div class="flex items-center gap-2"><span class="w-3.5 h-1.5 bg-[#d97706]"></span> C04: Union Tpke Feeder Priority &amp; Kew Gardens Hub</div>
    </div>
  `);

  updateDrawerHeader('Candidate Investment Corridors', 'Actionable, location-specific interventions recommended for verification', 'Targeted Solutions');

  updateKPIs([
    { label: 'Recommended Corridors', val: '4', sub: 'Candidate outer-borough locations' },
    { label: 'Capital Cost Guesswork', val: '$0', sub: 'Unverified estimates removed' },
    { label: 'Statutory Allocation', val: '80 / 10 / 10', sub: 'PAL Section 553-j compliance' },
    { label: 'Next Policy Milestone', val: 'Pilot Testing', sub: 'Before full capital commitment' }
  ]);

  renderChart('bar', {
    labels: ['Fresh Meadows (C01)', 'Throggs Neck (C02)', 'Rosedale / Nostrand (C03)', 'Union Tpke (C04)'],
    datasets: [
      {
        label: 'Modelled Feeder / Transfer Savings (min)',
        data: [4.2, 5.5, 6.0, 8.7],
        backgroundColor: '#0284c7'
      },
      {
        label: 'Remaining Walking / In-Vehicle Time (min)',
        data: [51.4, 65.8, 55.9, 43.3],
        backgroundColor: '#94a3b8'
      }
    ]
  }, 'Journey Benefit vs Residual Commute Time (Minutes)');

  setPolicyNote('All four candidate solutions are PROPOSED FOR TESTING. Do not invent modal shift estimates or budget figures without certified engineering cost books.');
}

// Feature Inspectors
function inspectBorough(p) {
  document.getElementById('inspect-type').innerText = 'Borough';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${p.BoroName || 'NYC Borough'}</div>
    <div class="text-[11px] text-slate-600 mt-1">Borough Code: ${p.BoroCode}</div>
    <div class="text-[11px] text-slate-600">Click individual census tracts, sensor links, or stations to inspect granular empirical data.</div>
  `;
}

function inspectCRZGeofence() {
  document.getElementById('inspect-type').innerText = 'CBD Tolling Zone';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-purple-900 text-sm">Manhattan Congestion Relief Zone (CRZ)</div>
    <div class="text-[11px] text-slate-700 mt-1">Geographic Boundary: South of and including 60th Street, excluding FDR Drive, West Side Highway, and Hugh L. Carey Tunnel connections.</div>
    <div class="text-[11px] text-slate-700 mt-1">Official 6-Month Result: <strong>~67,000 fewer daily entries (-11%)</strong> compared to baseline.</div>
    <div class="text-[11px] text-slate-700 mt-1">Observed 2025 Weekday Gateway Crossings: <strong>511,829</strong>.</div>
  `;
}

function inspectGateway(p) {
  document.getElementById('inspect-type').innerText = 'Tolling Gateway';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-purple-900 text-sm">${p.name} (Gateway #${p.gateway_id})</div>
    <div class="text-[11px] text-slate-700 mt-1">Weekday Entry Volume: <strong>${p.weekday_entries.toLocaleString()}</strong> (${p.share_pct}% of cordon total)</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-0.5">
      <div>Passenger Cars / Pickups: <strong>${p.cars_pickups_vans.toLocaleString()}</strong></div>
      <div>TLC FHV &amp; Taxis: <strong>${p.tlc_taxi_fhv.toLocaleString()}</strong></div>
      <div>Single-Unit Trucks: <strong>${p.single_unit_trucks.toLocaleString()}</strong></div>
      <div>Buses: <strong>${p.buses.toLocaleString()}</strong></div>
      <div>Multi-Unit Trucks: <strong>${p.multi_unit_trucks.toLocaleString()}</strong></div>
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

  document.getElementById('inspect-type').innerText = 'Highway Sensor';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${p.link_name}</div>
    <div class="text-[11px] text-slate-600">Link ID: ${p.link_id} | Borough: ${p.borough}</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
      <div>2024 Baseline Speed: <strong>${s24 !== null ? s24.toFixed(2) + ' mph' : 'N/A'}</strong> (${days24} days)</div>
      <div>2025 Observed Speed: <strong>${s25 !== null ? s25.toFixed(2) + ' mph' : 'N/A'}</strong> (${days25} days)</div>
      <div class="font-semibold ${diff > 2 ? 'text-blue-700' : diff < -2 ? 'text-red-700' : 'text-slate-700'}">
        Net Velocity Change: ${diff !== null ? (diff > 0 ? '+' : '') + diff.toFixed(2) + ' mph' : 'N/A'}
      </div>
      <div>Sensor Coverage Classification: <strong>${cov}</strong> (${p.is_robust ? 'Robust link' : 'Weak/excluded link'})</div>
      ${p.is_bqe_deck_repair ? '<div class="text-[11px] text-amber-700 font-semibold mt-1">Scheduled BQE deck repairs underway during 2025 observation period.</div>' : ''}
    </div>
  `;
}

function inspectOriginTract(p) {
  document.getElementById('inspect-type').innerText = 'LODES Commuter Tract';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">Census Tract ${p.GEOID} (${p.borough})</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
      <div>Jobs Destined for Manhattan CRZ: <strong>${p.to_manhattan_crz.toLocaleString()}</strong> (${p.to_crz_share_pct}%)</div>
      <div>Jobs Destined for All Manhattan: <strong>${p.to_manhattan.toLocaleString()}</strong></div>
      <div>Total Resident Workers: <strong>${p.total_resident_workers.toLocaleString()}</strong></div>
      <div>ACS Drive-Alone Mode Share: <strong>${p.acs_drive_alone_share_pct.toFixed(1)}%</strong></div>
      <div>ACS Public Transit Mode Share: <strong>${p.acs_public_transit_share_pct.toFixed(1)}%</strong></div>
      <div class="text-slate-500 text-[10px] pt-1">Boroughwide CMS Driver Trips to Manhattan: ${p.cms_borough_driver_trips.toLocaleString()} (${p.cms_borough_driver_share}% mode share)</div>
    </div>
  `;
}

function inspectOpportunityTract(p) {
  document.getElementById('inspect-type').innerText = 'Diagnostic Opportunity Tract';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">Census Tract ${p.GEOID} (${p.borough})</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
      <div>ACS Drive-Alone Commuter Share: <strong>${p.acs_drive_alone_share_pct.toFixed(1)}%</strong></div>
      <div>ACS Public Transit Commuter Share: <strong>${p.acs_public_transit_share_pct.toFixed(1)}%</strong></div>
      <div>CRZ Destination Jobs: <strong>${p.to_manhattan_crz.toLocaleString()}</strong></div>
      <div>Diagnostic Typology: <strong>${p.primary_problem_type}</strong></div>
      <div>Candidate Intervention: <strong>${p.candidate_intervention_type}</strong></div>
      <div>Priority Screening Class: <span class="font-semibold text-indigo-700">${p.priority_class || 'General'}</span></div>
      ${p.priority_cluster_id ? `<div>Cluster: <strong>${p.priority_cluster_id}</strong></div>` : ''}
    </div>
  `;
}

function inspectSubwayStation(p) {
  document.getElementById('inspect-type').innerText = 'Subway Station';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-sky-900 text-sm">${p.name}</div>
    <div class="text-[11px] text-slate-600 mt-1">Parent Station ID: <strong>${p.station_id}</strong></div>
    <div class="text-[11px] text-slate-600">Coordinates: [${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}]</div>
    <div class="text-[10px] text-slate-500 mt-1">Clean parent station entity (GTFS location_type=1); duplicate platform entries removed.</div>
  `;
}

function inspectBusRoute(b) {
  document.getElementById('inspect-type').innerText = 'Bus Corridor';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${b.name}</div>
    <div class="text-[11px] text-slate-600 mt-1">Borough: ${b.borough}</div>
    ${b.isGap ? `
      <div class="p-2 bg-amber-50 border border-amber-200 rounded text-amber-900 text-[11px] mt-2 space-y-1">
        <div class="font-bold">Authoritative Data Gap Disclosure:</div>
        <div>Route ${b.id} is <strong>not monitored</strong> in the MTA August 2026 29-route speed file.</div>
        <div>No empirical headway regularity, peak speed, or wait assessment figures exist for this route in project data.</div>
      </div>
    ` : `
      <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
        <div>AM Peak Speed: <strong>${b.speed.toFixed(2)} mph</strong></div>
        <div>Peak Wait Assessment: <strong>${b.wait.toFixed(1)}%</strong></div>
        <div class="text-slate-500 text-[10px]">Data Source: MTA bus performance file kufs-yh3x.</div>
      </div>
    `}
  `;
}

function inspectJourney(p) {
  document.getElementById('inspect-type').innerText = 'Audited OTP Journey';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${p.market_id}: ${p.market_name}</div>
    <div class="text-[11px] text-slate-700 mt-1">Total Travel Time: <strong>${p.total_min} minutes</strong></div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1">
      <div>Walking &amp; Access Burden: <strong>${p.walk_min} min</strong> (${((p.walk_min / p.total_min) * 100).toFixed(1)}%)</div>
      <div>Waiting &amp; Transfer Time: <strong>${p.wait_min} min</strong></div>
      <div>In-Vehicle Running Time: <strong>${p.in_vehicle_min} min</strong></div>
      <div class="text-[10px] text-slate-500 pt-1 leading-normal">
        <strong>Itinerary Legs:</strong><br>${p.legs_summary}
      </div>
    </div>
  `;
}

function inspectSolution(p) {
  document.getElementById('inspect-type').innerText = 'Targeted Solution';
  document.getElementById('inspect-content').innerHTML = `
    <div class="font-bold text-slate-900 text-sm">${p.corridor_id}: ${p.name}</div>
    <div class="text-[11px] text-slate-600 mt-0.5"><strong>Origin:</strong> ${p.origin}</div>
    <div class="text-[11px] text-slate-600"><strong>Destination:</strong> ${p.destination}</div>
    <div class="border-t border-slate-100 my-1.5 pt-1 text-[11px] space-y-1.5">
      <div><strong>Diagnostic Difficulty:</strong><br><span class="text-slate-700">${p.difficulty}</span></div>
      <div><strong>Proposed Infrastructure Response:</strong><br><span class="text-slate-800 font-medium">${p.proposed_response}</span></div>
      <div><strong>Why It Helps:</strong><br><span class="text-slate-700">${p.why_helps}</span></div>
      <div class="text-amber-800 bg-amber-50 p-1.5 rounded border border-amber-200">
        <strong>Missing Evidence:</strong><br>${p.missing_evidence}
      </div>
      <div class="text-[10px] uppercase font-bold text-slate-500">Status: ${p.status}</div>
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
    <div class="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
      <div class="text-[10px] uppercase font-semibold text-slate-500">${item.label}</div>
      <div class="text-base font-extrabold text-slate-900 mt-0.5">${item.val}</div>
      <div class="text-[10px] text-slate-500 truncate mt-0.5">${item.sub}</div>
    </div>
  `).join('');
}

function renderChart(type, data, title) {
  document.getElementById('chart-title').innerText = title;
  const ctx = document.getElementById('drawer-chart').getContext('2d');

  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(ctx, {
    type: type,
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: type === 'doughnut' || (data.datasets && data.datasets.length > 1),
          position: 'bottom',
          labels: { boxWidth: 10, font: { size: 10 } }
        }
      },
      scales: type === 'bar' ? {
        y: { beginAtZero: true, ticks: { font: { size: 10 } } },
        x: { ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 0 } }
      } : {}
    }
  });
}

function setPolicyNote(text) {
  document.getElementById('policy-note-text').innerText = text;
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
      const coords = trMatch.geometry.coordinates[0][0];
      map.flyTo([coords[1], coords[0]], 14);
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
      const coords = solMatch.geometry.coordinates[0];
      map.flyTo([coords[1], coords[0]], 13);
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
  const toggleBtn = document.getElementById('drawer-toggle-text');
  state.drawerOpen = !state.drawerOpen;

  if (state.drawerOpen) {
    drawer.style.width = '430px';
    drawer.style.borderLeftWidth = '1px';
    toggleBtn.innerText = 'Hide Panel';
  } else {
    drawer.style.width = '0px';
    drawer.style.borderLeftWidth = '0px';
    toggleBtn.innerText = 'Show Panel';
  }
  setTimeout(() => map.invalidateSize(), 300);
}

// Start Application on Load
window.addEventListener('DOMContentLoaded', () => {
  loadAtlasData();
});
