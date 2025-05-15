// --- Supabase Client Initialization ---
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';    // << REPLACE
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // << REPLACE

let supabase = null;
try {
    if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL') {
        supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase client initialized.");
    } else {
        console.warn("Supabase URL or Anon Key not provided. Historical data might fail or fallback.");
    }
} catch (error) {
    console.error("Error initializing Supabase client:", error);
}

// --- Global Variables ---
const FLASK_SERVER_URL = ''; 
let tempHumidityChart;
let lastFetchedConfig = {};
const NUM_SIMULATED_LEDS = 12;
let simRingState = { targetMode: 'NONE', targetColor: { r:0, g:0, b:0 }, wipeCounter: 0, blinkCounter: 0, blinkState: false, animationStep: 0, statusText: 'Initializing...' };
const SIM_NEOPIXEL_ANIMATION_INTERVAL = 60;


// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    createSimulatedRgbRing();
    initChart();
    fetchLatestDataAndUpdateUI(); 
    fetchHistoricalData();      

    setInterval(fetchLatestDataAndUpdateUI, 3000); 
    setInterval(fetchHistoricalData, 60000); 

    document.getElementById('update-base-config-btn').addEventListener('click', updateBaseConfiguration);
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    manualModeToggle.addEventListener('change', handleManualModeToggle);
    document.getElementById('manual-fan-on-btn').addEventListener('click', () => sendManualFanSettings(true, true));
    document.getElementById('manual-fan-off-btn').addEventListener('click', () => sendManualFanSettings(true, false));
    document.getElementById('scroll-to-graph-btn').addEventListener('click', () => {
        document.getElementById('chart-section').scrollIntoView({ behavior: 'smooth' });
    });

    updatePyramidArrowPositions(); // Initial call
    window.addEventListener('resize', debounce(updatePyramidArrowPositions, 100)); // Debounced resize
    setInterval(renderSimulatedLedsV2, SIM_NEOPIXEL_ANIMATION_INTERVAL);
});

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}


// --- API URL Helper ---
function getApiUrl(endpoint) { /* ... Keep as is ... */ }
// --- Message Display Helper ---
function displayMessage(elementId, text, type = 'success') { /* ... Keep as is ... */ }

// --- Data Fetching & UI Updates ---
async function fetchLatestDataAndUpdateUI() { /* ... Keep as is, including simulated RGB logic ... */
    try {
        const response = await fetch(getApiUrl('/api/latest_data'));
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const data = await response.json();
        const reading = data.latest_reading;
        const espIsOnline = data.esp_status === 'online';
        const currentConfig = data.current_config;

        document.getElementById('temp-value').textContent = espIsOnline && reading.temperature !== null ? `${parseFloat(reading.temperature).toFixed(1)} °C` : '-- °C';
        document.getElementById('humidity-value').textContent = espIsOnline && reading.humidity !== null ? `${parseFloat(reading.humidity).toFixed(1)} %` : '-- %';
        document.getElementById('fan-actual-status').textContent = espIsOnline && reading.fan_on !== null ? (reading.fan_on ? 'ON' : 'OFF') : '--';
        document.getElementById('last-update').textContent = espIsOnline && reading.created_at ? new Date(reading.created_at).toLocaleString() : '--';
        document.getElementById('fan-control-mode').textContent = currentConfig.manual_fan_control_active ? `MANUAL (${currentConfig.manual_fan_target_state ? 'ON' : 'OFF'})` : 'AUTO';
        if (JSON.stringify(currentConfig) !== JSON.stringify(lastFetchedConfig)) { updateControlInputs(currentConfig); lastFetchedConfig = { ...currentConfig }; }
        
        updateDiagramStatusDots(data.esp_status, data.flask_status, data.supabase_status);
        updatePyramidArrowActiveStates(data.esp_status, data.flask_status, data.supabase_status, espIsOnline && reading.created_at);

        if (espIsOnline) {
            const fanIsOn = reading.fan_on; const isManual = currentConfig.manual_fan_control_active;
            let derivedEspStatus = 'OPERATIONAL_IDLE'; // Default if connected and fine
            if (data.esp_internal_state) { // Ideal: Flask forwards ESP's actual OpState
                derivedEspStatus = data.esp_internal_state; // e.g. "S_WIFI_CONNECTING", "S_OPERATIONAL_FAN_ON_AUTO"
            } else { // Fallback: Infer from data
                if (fanIsOn) derivedEspStatus = isManual ? 'S_OPERATIONAL_FAN_ON_MANUAL' : 'S_OPERATIONAL_FAN_ON_AUTO';
                else if (reading.temperature > currentConfig.fan_threshold_temp + 2.0 && !isManual) derivedEspStatus = 'S_OPERATIONAL_TEMP_HIGH';
                else derivedEspStatus = 'S_OPERATIONAL_FAN_OFF';
            }
            updateSimulatedRgbTarget(derivedEspStatus);
        } else { updateSimulatedRgbTarget('ESP_OFFLINE'); }
        document.getElementById('rgb-status-text').textContent = simRingState.statusText;
    } catch (error) {
        console.error("Error fetching latest data:", error);
        document.getElementById('temp-value').textContent = '-- °C'; document.getElementById('humidity-value').textContent = '-- %';
        document.getElementById('fan-actual-status').textContent = '--'; document.getElementById('last-update').textContent = 'Error';
        updateDiagramStatusDots('offline', 'offline', 'unknown'); updatePyramidArrowActiveStates('offline', 'offline', 'unknown', null);
        updateSimulatedRgbTarget('ESP_OFFLINE_ERROR');
    }
}

async function fetchHistoricalData() { /* ... Keep Supabase direct fetch as is ... */ }

// --- Control Input & Manual Mode Handling ---
function updateControlInputs(config) { /* ... Keep as is ... */ }
function handleManualModeToggle() { /* ... Keep as is ... */ }
function updateManualFanButtonActiveState(isManualMode, targetState) { /* ... Keep as is ... */ }
async function updateBaseConfiguration() { /* ... Keep as is ... */ }
async function sendManualFanSettings(manualControlActive, manualFanTargetState) { /* ... Keep as is ... */ }

// --- Chart Initialization ---
function initChart() { /* ... Keep as is, with dark theme options ... */ }

// --- Simulated RGB Ring ---
function createSimulatedRgbRing() { /* ... Keep as is ... */ }

function updateSimulatedRgbTarget(espEquivalentStatus) { // Sets the *target* state
    // This function now ONLY sets simRingState.targetMode and simRingState.targetColor
    // The renderSimulatedLedsV2 function will handle the animation based on these targets.
    // This mapping needs to be robust.
    switch(espEquivalentStatus) {
        case 'S_WIFI_CONNECTING': case 'S_WIFI_CONNECTION_FAILED_RETRY':
            simRingState.targetMode = 'SPIN'; simRingState.targetColor = { r: 0, g: 0, b: 200 }; simRingState.statusText = 'WiFi Connecting...';
            break;
        case 'S_WIFI_CONNECTED_INIT_ANIM': // This state on ESP means wipe then blink blue
            simRingState.targetMode = 'WIPE'; simRingState.targetColor = { r: 0, g: 0, b: 220 }; simRingState.wipeCounter = 0; simRingState.statusText = 'WiFi Connected!';
            // renderSimulatedLedsV2 will handle transition to BLINK
            break;
        // S_OPERATIONAL_FAN_ON_AUTO, S_OPERATIONAL_FAN_ON_MANUAL will be just 'FAN_ON' for sim
        case 'S_OPERATIONAL_FAN_ON_AUTO': case 'S_OPERATIONAL_FAN_ON_MANUAL':
            simRingState.targetMode = 'SOLID'; simRingState.targetColor = { r: 220, g: 0, b: 0 }; simRingState.statusText = `Fan ON (${espEquivalentStatus.includes('MANUAL') ? 'Manual' : 'Auto'})`;
            break;
        case 'S_OPERATIONAL_FAN_OFF':
            simRingState.targetMode = 'SOLID'; simRingState.targetColor = { r: 0, g: 200, b: 0 }; simRingState.statusText = 'Fan OFF - Nominal';
            break;
        case 'S_OPERATIONAL_TEMP_HIGH':
            simRingState.targetMode = 'PULSE'; simRingState.targetColor = { r: 255, g: 100, b: 0 }; simRingState.statusText = 'Temp High!';
            break;
        case 'S_SENSOR_ERROR':
            simRingState.targetMode = 'SOLID'; simRingState.targetColor = { r: 200, g: 200, b: 0 }; simRingState.statusText = 'Sensor Error!';
            break;
        case 'ESP_OFFLINE': case 'S_WIFI_DISCONNECTED_OPERATIONAL': case 'S_HTTP_REQUEST_FAILED':
            simRingState.targetMode = 'PULSE'; simRingState.targetColor = { r: 100, g: 0, b: 0 }; simRingState.statusText = 'ESP Offline/Error';
            break;
        case 'S_HTTP_ACTIVE':
             simRingState.targetMode = 'CHASE'; simRingState.targetColor = {r:100, g:100, b:100}; simRingState.statusText = "Communicating...";
             break;
        default: // S_OPERATIONAL_IDLE, S_BOOTING, etc.
            simRingState.targetMode = 'SOLID'; simRingState.targetColor = { r: 30, g: 30, b: 30 }; simRingState.statusText = 'System Idle';
            break;
    }
    document.getElementById('rgb-status-text').textContent = simRingState.statusText;
}

function renderSimulatedLedsV2() { // This function *renders* the animation based on simRingState
    const anim = simRingState; anim.animationStep++;
    for (let i = 0; i < NUM_SIMULATED_LEDS; i++) {
        const ledEl = document.getElementById(`sim-led-${i}`); if (!ledEl) continue;
        let r = 10, g = 10, b = 10; // Default dim off

        switch(anim.targetMode) { // Changed from anim.mode to anim.targetMode
            case 'SOLID': r = anim.targetColor.r; g = anim.targetColor.g; b = anim.targetColor.b; break;
            case 'WIPE':
                if (anim.wipeCounter === undefined) anim.wipeCounter = 0;
                if (i <= anim.wipeCounter) { r = anim.targetColor.r; g = anim.targetColor.g; b = anim.targetColor.b; }
                if (anim.animationStep % 3 === 0 && anim.wipeCounter < NUM_SIMULATED_LEDS) anim.wipeCounter++; // Control wipe speed
                if (anim.wipeCounter >= NUM_SIMULATED_LEDS) { // Wipe done
                    if (simRingState.statusText === 'WiFi Connected!') { // Specific transition after blue wipe
                        anim.targetMode = 'BLINK'; anim.blinkCounter = NEOPIXEL_MAX_BLINKS; anim.blinkState = true; anim.wipeCounter = 0; // Reset wipe counter
                    } else { anim.targetMode = 'SOLID'; }
                }
                break;
            case 'BLINK':
                if (anim.blinkCounter === undefined || anim.blinkCounter <= 0) {
                    anim.targetMode = 'SOLID'; // Default to solid green after blink for WiFi
                    anim.targetColor = { r: 0, g: 180, b: 0 }; 
                } else {
                    if (anim.animationStep % (Math.floor(NEOPIXEL_BLINK_INTERVAL / SIM_NEOPIXEL_ANIMATION_INTERVAL) * 2) < Math.floor(NEOPIXEL_BLINK_INTERVAL / SIM_NEOPIXEL_ANIMATION_INTERVAL) ) {
                         r = anim.targetColor.r; g = anim.targetColor.g; b = anim.targetColor.b;
                    } /* else stays dim off */
                     if (anim.animationStep % Math.floor(NEOPIXEL_BLINK_INTERVAL / SIM_NEOPIXEL_ANIMATION_INTERVAL) === 0) anim.blinkCounter--;
                }
                break;
            case 'SPIN':
                const spinLed = Math.floor(anim.animationStep / 2) % NUM_SIMULATED_LEDS;
                if (i === spinLed) { r = anim.targetColor.r; g = anim.targetColor.g; b = anim.targetColor.b; }
                else if (i === (spinLed + NUM_SIMULATED_LEDS - 1) % NUM_SIMULATED_LEDS) { r = anim.targetColor.r/2; g = anim.targetColor.g/2; b = anim.targetColor.b/2; }
                else if (i === (spinLed + NUM_SIMULATED_LEDS - 2) % NUM_SIMULATED_LEDS) { r = anim.targetColor.r/4; g = anim.targetColor.g/4; b = anim.targetColor.b/4; }
                break;
            case 'PULSE':
                const factor = (Math.sin(anim.animationStep * 0.05) + 1) / 2;
                r = Math.floor(anim.targetColor.r * factor); g = Math.floor(anim.targetColor.g * factor); b = Math.floor(anim.targetColor.b * factor);
                break;
            case 'CHASE': // For HTTP Active
                if (i === anim.animationStep % NUM_SIMULATED_LEDS) { r=anim.targetColor.r; g=anim.targetColor.g; b=anim.targetColor.b; }
                break;
        }
        ledEl.style.backgroundColor = `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
        if (r > 100 || g > 100 || b > 100) ledEl.style.boxShadow = `0 0 7px 2px rgba(${r},${g},${b},0.6)`;
        else ledEl.style.boxShadow = '0 0 3px rgba(0,0,0,0.3)';
    }
}


// --- Pyramid Diagram Status & Arrows ---
function updateDiagramStatusDots(espStatus, flaskStatus, supabaseStatus) { /* ... Keep as is ... */ }

function getElementCenter(elementId, svgRect) {
    const el = document.getElementById(elementId);
    if (!el) return { x: 0, y: 0, valid: false };
    const rect = el.getBoundingClientRect();
    return {
        x: rect.left + rect.width / 2 - svgRect.left,
        y: rect.top + rect.height / 2 - svgRect.top,
        top: rect.top - svgRect.top,
        bottom: rect.bottom - svgRect.top,
        left: rect.left - svgRect.left,
        right: rect.right - svgRect.left,
        width: rect.width,
        height: rect.height,
        valid: true
    };
}

function updatePyramidArrowPositions() {
    const svg = document.getElementById('pyramid-arrows-svg');
    if (!svg) return;
    const svgRect = svg.getBoundingClientRect();

    const nodes = {
        flask: getElementCenter('node-flask', svgRect),
        esp: getElementCenter('node-esp', svgRect),
        supabase: getElementCenter('node-supabase', svgRect),
        web: getElementCenter('node-web', svgRect)
    };

    // Check if all nodes were found
    if (!nodes.flask.valid || !nodes.esp.valid || !nodes.supabase.valid || !nodes.web.valid) {
        // console.warn("One or more diagram nodes not found, arrows not updated.");
        return;
    }
    
    const lineEspFlaskData = document.getElementById('line-esp-flask-data');
    const lineFlaskEspConfig = document.getElementById('line-flask-esp-config');
    const lineFlaskDbData = document.getElementById('line-flask-db-data');
    const lineFlaskWebData = document.getElementById('line-flask-web-data');
    const lineWebFlaskControl = document.getElementById('line-web-flask-control');

    // ESP <-> Flask (Vertical or angled based on layout)
    if (lineEspFlaskData) {
        lineEspFlaskData.setAttribute('x1', nodes.esp.x);
        lineEspFlaskData.setAttribute('y1', nodes.esp.top); // From top of ESP
        lineEspFlaskData.setAttribute('x2', nodes.flask.x);
        lineEspFlaskData.setAttribute('y2', nodes.flask.bottom); // To bottom of Flask
    }
    if (lineFlaskEspConfig) {
        lineFlaskEspConfig.setAttribute('x1', nodes.flask.x);
        lineFlaskEspConfig.setAttribute('y1', nodes.flask.bottom); 
        lineFlaskEspConfig.setAttribute('x2', nodes.esp.x);
        lineFlaskEspConfig.setAttribute('y2', nodes.esp.top);
    }

    // Flask -> Supabase DB (More horizontal on desktop, more vertical on mobile if layout changes)
    if (lineFlaskDbData) {
        lineFlaskDbData.setAttribute('x1', nodes.flask.x); 
        lineFlaskDbData.setAttribute('y1', nodes.flask.bottom);
        lineFlaskDbData.setAttribute('x2', nodes.supabase.x);
        lineFlaskDbData.setAttribute('y2', nodes.supabase.top);
    }
    
    // Flask <-> Web UI
    if (lineFlaskWebData) {
        lineFlaskWebData.setAttribute('x1', nodes.flask.right);
        lineFlaskWebData.setAttribute('y1', nodes.flask.y);
        lineFlaskWebData.setAttribute('x2', nodes.web.left);
        lineFlaskWebData.setAttribute('y2', nodes.web.y);
    }
    if (lineWebFlaskControl) {
        lineWebFlaskControl.setAttribute('x1', nodes.web.left);
        lineWebFlaskControl.setAttribute('y1', nodes.web.y + 5); // Offset slightly to avoid overlap
        lineWebFlaskControl.setAttribute('x2', nodes.flask.right);
        lineWebFlaskControl.setAttribute('y2', nodes.flask.y + 5);
    }
}


function updatePyramidArrowActiveStates(espStatus, flaskStatus, supabaseStatus, lastEspDataTimestamp) {
    const setArrowActive = (id, active) => { 
        const arrowEl = document.getElementById(id); if (!arrowEl) return;
        arrowEl.classList.toggle('active', active);
        // Toggle marker based on active state
        arrowEl.setAttribute('marker-end', active ? 'url(#arrowhead-active)' : 'url(#arrowhead-default)');
    };
    let isEspDataFlowing = false;
    if (espStatus === 'online' && flaskStatus === 'online' && lastEspDataTimestamp) {
        const dataAgeSeconds = (new Date() - new Date(lastEspDataTimestamp)) / 1000;
        if (dataAgeSeconds < 120) isEspDataFlowing = true; 
    }
    const isFlaskAbleToProcess = flaskStatus === 'online';

    setArrowActive('line-esp-flask-data', isEspDataFlowing);
    setArrowActive('line-flask-esp-config', isFlaskAbleToProcess && espStatus === 'online'); 
    setArrowActive('line-flask-db-data', isEspDataFlowing && supabaseStatus === 'online');
    setArrowActive('line-flask-web-data', isFlaskAbleToProcess);
    setArrowActive('line-web-flask-control', isFlaskAbleToProcess);
}