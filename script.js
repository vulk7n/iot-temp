// --- Global Error Catcher for Debugging ---
console.log("script.js loading...");
window.onerror = function(message, source, lineno, colno, error) {
  console.error("Global JS Error:", {
    message: message,
    source: source,
    lineno: lineno,
    colno: colno,
    errorObject: error
  });
  return false; 
};

// --- Supabase Client Initialization ---
const SUPABASE_URL = 'https://qrhkkeworjtpnznfwtne.supabase.co';    // << REPLACE WITH YOUR ACTUAL URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyaGtrZXdvcmp0cG56bmZ3dG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU3NTIzOTEsImV4cCI6MjA2MTMyODM5MX0.r91yGy0MJu1-e884Qbk89S8U1Riyjn4le6fuQz7Rs3E'; // << REPLACE WITH YOUR ACTUAL ANON KEY

let supabaseClient = null; // Our variable to hold the initialized client

// --- Global Variables ---
const FLASK_SERVER_URL = 'https://flask.vlkn.in'; // e.g., http://localhost:5000 or leave empty if same domain
let tempHumidityChart;
let lastFetchedConfig = {};
const NUM_SIMULATED_LEDS = 12;
let simRingState = { 
    targetMode: 'NONE', 
    targetColor: { r: 0, g: 0, b: 0 }, 
    wipeCounter: 0, 
    blinkCounter: 0, 
    blinkState: false, 
    animationStep: 0, 
    statusText: 'Initializing...' 
};
const SIM_NEOPIXEL_ANIMATION_INTERVAL = 60; 


// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded. Initializing application...");

    try {
        if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function' && 
            SUPABASE_URL && SUPABASE_ANON_KEY && 
            SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log("Supabase client initialized successfully via DOMContentLoaded.");
        } else if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL' || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
            console.warn("Supabase URL or Anon Key NOT CONFIGURED in script.js. Direct Supabase features (like historical chart) will be disabled.");
        } else if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
            console.error("Supabase library (supabase object or createClient method) not loaded. Check script order in HTML or network. Ensure Supabase CDN script is loaded BEFORE script.js.");
        }
    } catch (error) {
        console.error("Error initializing Supabase client in DOMContentLoaded:", error);
    }

    createSimulatedRgbRing();
    
    const chartCanvas = document.getElementById('tempHumidityChart');
    if (chartCanvas) {
        initChart(); 
        console.log("Chart initialized.");
    } else {
        console.error("Chart canvas element 'tempHumidityChart' not found!");
    }

    fetchLatestDataAndUpdateUI().catch(err => console.error("Initial fetchLatestData error:", err)); 
    setTimeout(() => { 
        fetchHistoricalData().catch(err => console.error("Initial fetchHistoricalData error:", err)); 
    }, 500);     

    setInterval(fetchLatestDataAndUpdateUI, 3000); 
    setInterval(fetchHistoricalData, 60000); 

    const updateBaseConfigBtn = document.getElementById('update-base-config-btn');
    if (updateBaseConfigBtn) updateBaseConfigBtn.addEventListener('click', updateBaseConfiguration);
    else console.warn("Button 'update-base-config-btn' not found");
    
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    if(manualModeToggle) manualModeToggle.addEventListener('change', handleManualModeToggle);
    else console.warn("Toggle 'manual-fan-mode-toggle' not found");
    
    const manualFanOnBtn = document.getElementById('manual-fan-on-btn');
    if(manualFanOnBtn) manualFanOnBtn.addEventListener('click', () => sendManualFanSettings(true, true));
    else console.warn("Button 'manual-fan-on-btn' not found");
    
    const manualFanOffBtn = document.getElementById('manual-fan-off-btn');
    if(manualFanOffBtn) manualFanOffBtn.addEventListener('click', () => sendManualFanSettings(true, false));
    else console.warn("Button 'manual-fan-off-btn' not found");
    
    const scrollToGraphBtn = document.getElementById('scroll-to-graph-btn');
    if(scrollToGraphBtn) scrollToGraphBtn.addEventListener('click', () => {
        const chartSection = document.getElementById('chart-section');
        if(chartSection) chartSection.scrollIntoView({ behavior: 'smooth' });
        else console.warn("Chart section 'chart-section' not found for scroll");
    });
    else console.warn("Button 'scroll-to-graph-btn' not found");

    updatePyramidArrowPositions(); 
    window.addEventListener('resize', debounce(updatePyramidArrowPositions, 100)); 
    setInterval(renderSimulatedLedsV2, SIM_NEOPIXEL_ANIMATION_INTERVAL);
    console.log("Application setup complete.");
});

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout); timeout = setTimeout(later, wait);
    };
}
function getApiUrl(endpoint) { return FLASK_SERVER_URL ? `${FLASK_SERVER_URL}${endpoint}` : endpoint; }
function displayMessage(elementId, text, type = 'success') {
    const el = document.getElementById(elementId); if (!el) { console.warn("Msg el not found:", elementId); return; }
    el.textContent = text; el.className = 'message'; 
    if (type === 'success') el.classList.add('message-success'); else el.classList.add('message-error');
    setTimeout(() => { if(el) {el.textContent = ''; el.className = 'message';} }, 4000);
}

async function fetchLatestDataAndUpdateUI() {
    try {
        const response = await fetch(getApiUrl('/api/latest_data'));
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const data = await response.json();
        const reading = data.latest_reading || {}; const espIsOnline = data.esp_status === 'online';
        const currentConfig = data.current_config || {}; 
        const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

        setText('temp-value', espIsOnline && reading.temperature !== null && reading.temperature !== undefined ? `${parseFloat(reading.temperature).toFixed(1)} °C` : '-- °C');
        setText('humidity-value', espIsOnline && reading.humidity !== null && reading.humidity !== undefined ? `${parseFloat(reading.humidity).toFixed(1)} %` : '-- %');
        setText('fan-actual-status', espIsOnline && reading.fan_on !== null && reading.fan_on !== undefined ? (reading.fan_on ? 'ON' : 'OFF') : '--');
        setText('last-update', espIsOnline && reading.created_at ? new Date(reading.created_at).toLocaleString() : '--');
        if (currentConfig.manual_fan_control_active !== undefined) setText('fan-control-mode', currentConfig.manual_fan_control_active ? `MANUAL (${currentConfig.manual_fan_target_state ? 'ON' : 'OFF'})` : 'AUTO');
        else setText('fan-control-mode', 'AUTO'); 
        if (JSON.stringify(currentConfig) !== JSON.stringify(lastFetchedConfig)) { updateControlInputs(currentConfig); lastFetchedConfig = { ...currentConfig }; }
        updateDiagramStatusDots(data.esp_status, data.flask_status, data.supabase_status);
        updatePyramidArrowActiveStates(data.esp_status, data.flask_status, data.supabase_status, espIsOnline && reading.created_at);

        if (espIsOnline) {
            let derivedEspStatus = currentConfig?.esp_internal_state || 'S_OPERATIONAL_IDLE'; 
             if (!currentConfig?.esp_internal_state) { 
                const fanIsOn = reading.fan_on; const isManual = currentConfig.manual_fan_control_active;
                if (fanIsOn) derivedEspStatus = isManual ? 'S_OPERATIONAL_FAN_ON_MANUAL' : 'S_OPERATIONAL_FAN_ON_AUTO';
                else if (reading.temperature !== null && reading.temperature !== undefined && currentConfig.fan_threshold_temp !== undefined && reading.temperature > currentConfig.fan_threshold_temp + 2.0 && !isManual) derivedEspStatus = 'S_OPERATIONAL_TEMP_HIGH';
                else derivedEspStatus = 'S_OPERATIONAL_FAN_OFF';
            }
            updateSimulatedRgbTarget(derivedEspStatus);
        } else { updateSimulatedRgbTarget('ESP_OFFLINE'); }
    } catch (error) {
        console.error("Error in fetchLatestDataAndUpdateUI:", error);
        const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        setText('temp-value', '-- °C'); setText('humidity-value', '-- %'); setText('fan-actual-status', '--'); setText('last-update', 'Error');
        updateDiagramStatusDots('offline', 'offline', 'unknown'); updatePyramidArrowActiveStates('offline', 'offline', 'unknown', null);
        updateSimulatedRgbTarget('ESP_OFFLINE_ERROR');
    }
}

async function fetchHistoricalData() { 
    const chartErrorMessageEl = document.getElementById('chart-error-message');
    const chartCanvas = document.getElementById('tempHumidityChart');
    if (!supabaseClient) { 
        if (chartErrorMessageEl) { chartErrorMessageEl.textContent = "Chart data unavailable (Supabase not connected)."; chartErrorMessageEl.style.display = 'block'; }
        if (chartCanvas) chartCanvas.style.display = 'none'; return; 
    }
    if (chartErrorMessageEl) chartErrorMessageEl.style.display = 'none';
    if (chartCanvas && chartCanvas.style.display === 'none') chartCanvas.style.display = 'block';

    try {
        const pointsToFetch = 150; 
        const { data, error } = await supabaseClient.from('sensor_readings').select('created_at, temperature, humidity').order('created_at', { ascending: false }).limit(pointsToFetch);                      
        if (error) { if (chartErrorMessageEl) { chartErrorMessageEl.textContent = "Error loading chart data: " + error.message; chartErrorMessageEl.style.display = 'block'; } return; }
        if (data && data.length > 0) {
            const sortedData = data.reverse(); 
            const labels = sortedData.map(d => new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            const tempData = sortedData.map(d => d.temperature === null || d.temperature === undefined ? null : parseFloat(d.temperature)); 
            const humidityData = sortedData.map(d => d.humidity === null || d.humidity === undefined ? null : parseFloat(d.humidity)); 
            if (tempHumidityChart) { tempHumidityChart.data.labels = labels; tempHumidityChart.data.datasets[0].data = tempData; tempHumidityChart.data.datasets[1].data = humidityData; tempHumidityChart.update('none'); }
        } else { if (tempHumidityChart) { tempHumidityChart.data.labels = []; tempHumidityChart.data.datasets[0].data = []; tempHumidityChart.data.datasets[1].data = []; tempHumidityChart.update('none'); } }
    } catch (error) { if (chartErrorMessageEl) { chartErrorMessageEl.textContent = "Failed to process chart data: " + error.message; chartErrorMessageEl.style.display = 'block';} }
}

function updateControlInputs(config) { /* ... Identical to previous version ... */ }
function handleManualModeToggle() { /* ... Identical to previous version ... */ }
function updateManualFanButtonActiveState(isManualMode, targetState) { /* ... Identical to previous version ... */ }
async function updateBaseConfiguration() { /* ... Identical to previous version ... */ }
async function sendManualFanSettings(manualControlActive, manualFanTargetState) { /* ... Identical to previous version ... */ }
function initChart() { /* ... Identical to previous version ... */ }
function createSimulatedRgbRing() { /* ... Identical to previous version ... */ }

function updateSimulatedRgbTarget(espEquivalentStatus) { 
    const statusTextEl = document.getElementById('rgb-status-text');
    switch(espEquivalentStatus) { 
        case 'S_WIFI_CONNECTING': case 'S_WIFI_CONNECTION_FAILED_RETRY':
            simRingState.targetMode = 'SPIN'; simRingState.targetColor = { r: 0, g: 0, b: 200 }; simRingState.statusText = 'WiFi Connecting...';
            break;
        case 'S_WIFI_CONNECTED_INIT_ANIM': 
            if (simRingState.targetMode !== 'WIPE' && simRingState.targetMode !== 'BLINK') { // Start wipe only if not already in init sequence
                simRingState.targetMode = 'WIPE'; 
                simRingState.targetColor = { r: 0, g: 0, b: 220 }; 
                simRingState.wipeCounter = 0; 
            }
            simRingState.statusText = 'WiFi Connected!';
            break;
        case 'S_OPERATIONAL_FAN_ON_AUTO': case 'S_OPERATIONAL_FAN_ON_MANUAL':
             if (simRingState.targetMode !== 'WIPE' || simRingState.targetColor.r !== 220) { // Only start new wipe if not already doing it or for this color
                simRingState.targetMode = 'WIPE';
                simRingState.targetColor = { r: 220, g: 0, b: 0 };
                simRingState.wipeCounter = 0;
            } else if (simRingState.targetMode === 'WIPE' && simRingState.wipeCounter >= NUM_SIMULATED_LEDS) { // If wipe finished, go solid
                simRingState.targetMode = 'SOLID';
            }
            simRingState.statusText = `Fan ON (${espEquivalentStatus.includes('MANUAL') ? 'Manual' : 'Auto'})`;
            break;
        case 'S_OPERATIONAL_FAN_OFF': case 'S_OPERATIONAL_IDLE': 
            if (simRingState.targetMode !== 'WIPE' || simRingState.targetColor.g !== 200) {
                simRingState.targetMode = 'WIPE';
                simRingState.targetColor = { r: 0, g: 200, b: 0 };
                simRingState.wipeCounter = 0;
            } else if (simRingState.targetMode === 'WIPE' && simRingState.wipeCounter >= NUM_SIMULATED_LEDS) {
                simRingState.targetMode = 'SOLID';
            }
            simRingState.statusText = 'Fan OFF - Nominal';
            if(espEquivalentStatus === 'S_OPERATIONAL_IDLE') simRingState.statusText = 'System Nominal';
            break;
        case 'S_OPERATIONAL_TEMP_HIGH':
            simRingState.targetMode = 'PULSE'; simRingState.targetColor = { r: 255, g: 100, b: 0 }; simRingState.statusText = 'Temp High!';
            break;
        case 'S_SENSOR_ERROR':
            simRingState.targetMode = 'SOLID'; simRingState.targetColor = { r: 200, g: 200, b: 0 }; simRingState.statusText = 'Sensor Error!';
            break;
        case 'ESP_OFFLINE': case 'S_WIFI_DISCONNECTED_OPERATIONAL': case 'S_HTTP_REQUEST_FAILED': case 'ESP_OFFLINE_ERROR':
            simRingState.targetMode = 'PULSE'; simRingState.targetColor = { r: 100, g: 0, b: 0 }; simRingState.statusText = 'ESP Offline/Error';
            break;
        case 'S_HTTP_ACTIVE':
             simRingState.targetMode = 'CHASE'; simRingState.targetColor = {r:100, g:100, b:100}; simRingState.statusText = "Communicating...";
             break;
        default: 
            simRingState.targetMode = 'SOLID'; simRingState.targetColor = { r: 30, g: 30, b: 30 }; simRingState.statusText = 'System Idle';
            break;
    }
    if (statusTextEl) statusTextEl.textContent = simRingState.statusText;
}

function renderSimulatedLedsV2() { /* ... Identical to previous version ... */ }
function updateDiagramStatusDots(espStatus, flaskStatus, supabaseStatus) { /* ... Identical to previous version ... */ }
function getElementConnectionPoint(elementId, svgRect, side = 'center', offsetX = 0, offsetY = 0) { /* ... Identical to previous version ... */ }
function updatePyramidArrowPositions() { /* ... Identical to previous version ... */ }
function updatePyramidArrowActiveStates(espStatus, flaskStatus, supabaseStatus, lastEspDataTimestamp) { /* ... Identical to previous version ... */ }