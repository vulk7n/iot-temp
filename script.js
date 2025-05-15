// --- Supabase Client Initialization ---
const SUPABASE_URL = 'https://qrhkkeworjtpnznfwtne.supabase.co';    // << REPLACE
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyaGtrZXdvcmp0cG56bmZ3dG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU3NTIzOTEsImV4cCI6MjA2MTMyODM5MX0.r91yGy0MJu1-e884Qbk89S8U1Riyjn4le6fuQz7Rs3E'; // << REPLACE

let supabase = null;
try {
    if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL') {
        supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase client initialized.");
    } else {
        console.warn("Supabase URL or Anon Key not provided. Historical data will be fetched via Flask (if implemented there).");
    }
} catch (error) {
    console.error("Error initializing Supabase client:", error);
}

// --- Global Variables ---
const FLASK_SERVER_URL = 'https://flask.vlkn.in'; // e.g., http://localhost:5000 or leave empty if same domain
let tempHumidityChart;
let lastFetchedConfig = {};
const NUM_SIMULATED_LEDS = 12;
let currentSimulatedLedAnimation = { mode: 'NONE', step: 0, color: {r:0,g:0,b:0}, targetColor: {r:0,g:0,b:0}, blinkCount: 0, blinkState: false };


// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    createSimulatedRgbRing();
    initChart();
    fetchLatestDataAndUpdateUI(); // Initial fetch for status and config
    fetchHistoricalData();      // Initial fetch for chart

    setInterval(fetchLatestDataAndUpdateUI, 3000); // Fetch status/config more often
    setInterval(fetchHistoricalData, 60000); 

    document.getElementById('update-base-config-btn').addEventListener('click', updateBaseConfiguration);
    
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    manualModeToggle.addEventListener('change', handleManualModeToggle);
    document.getElementById('manual-fan-on-btn').addEventListener('click', () => sendManualFanSettings(true, true));
    document.getElementById('manual-fan-off-btn').addEventListener('click', () => sendManualFanSettings(true, false));

    document.getElementById('scroll-to-graph-btn').addEventListener('click', () => {
        document.getElementById('chart-section').scrollIntoView({ behavior: 'smooth' });
    });

    // Initial and on resize diagram arrow updates
    updatePyramidArrowPositions();
    window.addEventListener('resize', updatePyramidArrowPositions);
});


// --- API URL Helper ---
function getApiUrl(endpoint) {
    return FLASK_SERVER_URL ? `${FLASK_SERVER_URL}${endpoint}` : endpoint;
}

// --- Message Display Helper ---
function displayMessage(elementId, text, type = 'success') {
    // ... (Keep this function as is from previous version) ...
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = text;
    el.className = 'message'; 
    if (type === 'success') el.classList.add('message-success');
    else el.classList.add('message-error');
    setTimeout(() => { el.textContent = ''; el.className = 'message'; }, 4000);
}

// --- Data Fetching & UI Updates ---
async function fetchLatestDataAndUpdateUI() {
    try {
        const response = await fetch(getApiUrl('/api/latest_data'));
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const data = await response.json();

        const reading = data.latest_reading;
        const espIsOnline = data.esp_status === 'online';

        document.getElementById('temp-value').textContent = espIsOnline && reading.temperature !== null ? `${parseFloat(reading.temperature).toFixed(1)} °C` : '-- °C';
        document.getElementById('humidity-value').textContent = espIsOnline && reading.humidity !== null ? `${parseFloat(reading.humidity).toFixed(1)} %` : '-- %';
        document.getElementById('fan-actual-status').textContent = espIsOnline && reading.fan_on !== null ? (reading.fan_on ? 'ON' : 'OFF') : '--';
        document.getElementById('last-update').textContent = espIsOnline && reading.created_at ? new Date(reading.created_at).toLocaleString() : '--';
        
        const currentConfig = data.current_config;
        document.getElementById('fan-control-mode').textContent = currentConfig.manual_fan_control_active ? `MANUAL (${currentConfig.manual_fan_target_state ? 'ON' : 'OFF'})` : 'AUTO';
        
        if (JSON.stringify(currentConfig) !== JSON.stringify(lastFetchedConfig)) {
            updateControlInputs(currentConfig);
            lastFetchedConfig = { ...currentConfig };
        }
        
        updateDiagramStatusDots(data.esp_status, data.flask_status, data.supabase_status);
        updatePyramidArrowActiveStates(data.esp_status, data.flask_status, data.supabase_status, espIsOnline && reading.created_at);

        // Update simulated RGB ring based on ESP status and data
        if (espIsOnline) {
            // Determine simulated LED state based on Flask data (which mirrors ESP logic)
            // This is a simplified mapping; ESP has more detailed internal LED states
            let espSystemStatus; // This needs to be derived from the data Flask provides
            const fanIsOn = reading.fan_on; // Actual fan state from ESP
            const isManual = currentConfig.manual_fan_control_active;

            if (!data.flask_status || data.flask_status === 'offline') { // Assuming flask_status reflects general connectivity
                 espSystemStatus = 'WIFI_CONNECTING'; // Or a general error
            } else if (fanIsOn) {
                 espSystemStatus = isManual ? 'FAN_ON_MANUAL' : 'FAN_ON_AUTO';
            } else if (reading.temperature > currentConfig.fan_threshold_temp + 1.0 && !isManual) { // Approx high temp
                 espSystemStatus = 'TEMP_HIGH';
            } else {
                 espSystemStatus = 'FAN_OFF'; // Or 'NORMAL'
            }
            updateSimulatedRgbRing(espSystemStatus, fanIsOn);
        } else {
            updateSimulatedRgbRing('ESP_OFFLINE', false);
        }


    } catch (error) {
        console.error("Error fetching latest data:", error);
        document.getElementById('temp-value').textContent = '-- °C';
        document.getElementById('humidity-value').textContent = '-- %';
        document.getElementById('fan-actual-status').textContent = '--';
        document.getElementById('last-update').textContent = 'Error';
        updateDiagramStatusDots('offline', 'offline', 'unknown');
        updatePyramidArrowActiveStates('offline', 'offline', 'unknown', null);
        updateSimulatedRgbRing('ESP_OFFLINE', false);
    }
}

async function fetchHistoricalData() {
    if (!supabase) { // Fallback to Flask if Supabase client isn't initialized
        console.warn("Supabase client not available, trying Flask for historical data (not implemented in this example).");
        // TODO: Implement Flask fallback or display error
        return; 
    }
    try {
        // console.log("Fetching historical data directly from Supabase...");
        const { data, error } = await supabase
            .from('sensor_readings')
            .select('created_at, temperature, humidity')
            .order('created_at', { ascending: true })
            .limit(150); // Fetch a bit more for better initial view

        if (error) throw error;

        if (data) {
            const labels = data.map(d => new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            const tempData = data.map(d => d.temperature);
            const humidityData = data.map(d => d.humidity);

            if (tempHumidityChart) {
                tempHumidityChart.data.labels = labels;
                tempHumidityChart.data.datasets[0].data = tempData;
                tempHumidityChart.data.datasets[1].data = humidityData;
                tempHumidityChart.update('none');
            }
        }
    } catch (error) {
        console.error("Error fetching historical data (Supabase direct):", error);
    }
}

// --- Control Input & Manual Mode Handling ---
function updateControlInputs(config) { /* ... Keep as is ... */ 
    const fanThresholdInput = document.getElementById('fan-threshold');
    if (document.activeElement !== fanThresholdInput) fanThresholdInput.value = parseFloat(config.fan_threshold_temp).toFixed(1);
    const rgbBrightnessInput = document.getElementById('rgb-brightness');
    if (document.activeElement !== rgbBrightnessInput) rgbBrightnessInput.value = parseInt(config.rgb_brightness);
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    if (document.activeElement !== manualModeToggle && manualModeToggle.checked !== config.manual_fan_control_active) manualModeToggle.checked = config.manual_fan_control_active;
    document.getElementById('manual-fan-buttons').style.display = config.manual_fan_control_active ? 'flex' : 'none';
    updateManualFanButtonActiveState(config.manual_fan_control_active, config.manual_fan_target_state);
}

function handleManualModeToggle() { /* ... Keep as is ... */ 
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    const manualFanButtonsDiv = document.getElementById('manual-fan-buttons');
    const isManualModeActive = manualModeToggle.checked;
    manualFanButtonsDiv.style.display = isManualModeActive ? 'flex' : 'none';
    let targetFanState = null; 
    if (isManualModeActive) {
        const fanActualElement = document.getElementById('fan-actual-status');
        targetFanState = fanActualElement.textContent.toUpperCase().includes('ON');
    }
    sendManualFanSettings(isManualModeActive, targetFanState);
}

function updateManualFanButtonActiveState(isManualMode, targetState) { /* ... Keep as is ... */ 
    const onBtn = document.getElementById('manual-fan-on-btn');
    const offBtn = document.getElementById('manual-fan-off-btn');
    onBtn.classList.remove('active'); offBtn.classList.remove('active');
    if (isManualMode) { if (targetState === true) onBtn.classList.add('active'); else if (targetState === false) offBtn.classList.add('active'); }
}

async function updateBaseConfiguration() { /* ... Keep as is ... */ 
    const threshold = document.getElementById('fan-threshold').value;
    const brightness = document.getElementById('rgb-brightness').value;
    displayMessage('base-config-message', 'Updating...', 'success');
    try {
        const response = await fetch(getApiUrl('/api/update_config'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fan_threshold_temp: parseFloat(threshold), rgb_brightness: parseInt(brightness) }),
        });
        const result = await response.json();
        if (response.ok && result.current_config) { displayMessage('base-config-message', 'Auto/RGB Config updated!', 'success'); lastFetchedConfig = { ...lastFetchedConfig, ...result.current_config }; updateControlInputs(result.current_config);
        } else { displayMessage('base-config-message', `Error: ${result.error || 'Unknown error'}`, 'error'); }
    } catch (error) { displayMessage('base-config-message', 'Network error.', 'error'); }
}

async function sendManualFanSettings(manualControlActive, manualFanTargetState) { /* ... Keep as is ... */ 
    displayMessage('manual-fan-message', 'Sending fan command...', 'success');
    const payload = { manual_control_active: manualControlActive, manual_fan_state: manualFanTargetState === null ? false : manualFanTargetState };
    try {
        const response = await fetch(getApiUrl('/api/set_fan_manual'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (response.ok) { displayMessage('manual-fan-message', 'Fan command sent!', 'success'); updateManualFanButtonActiveState(result.manual_fan_control_active, result.manual_fan_target_state);
            document.getElementById('fan-control-mode').textContent = result.manual_fan_control_active ? `MANUAL (${result.manual_fan_target_state ? 'ON' : 'OFF'})` : 'AUTO';
            lastFetchedConfig.manual_fan_control_active = result.manual_fan_control_active; lastFetchedConfig.manual_fan_target_state = result.manual_fan_target_state;
        } else { displayMessage('manual-fan-message', `Error: ${result.error || 'Unknown error'}`, 'error'); }
    } catch (error) { displayMessage('manual-fan-message', 'Network error setting fan.', 'error'); }
}

// --- Chart Initialization ---
function initChart() { /* ... Keep as is, with dark theme options ... */ 
    const ctx = document.getElementById('tempHumidityChart').getContext('2d');
    Chart.defaults.color = '#b0bec5'; Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
    tempHumidityChart = new Chart(ctx, { type: 'line',
        data: { labels: [], datasets: [
            { label: 'Temp (°C)', data: [], borderColor: '#ef5350', backgroundColor: 'rgba(239, 83, 80, 0.2)', tension: 0.3, yAxisID: 'yTemp', pointRadius: 2, pointBackgroundColor: '#ef5350', borderWidth: 1.5 },
            { label: 'Humidity (%)', data: [], borderColor: '#42a5f5', backgroundColor: 'rgba(66, 165, 245, 0.2)', tension: 0.3, yAxisID: 'yHumidity', pointRadius: 2, pointBackgroundColor: '#42a5f5', borderWidth: 1.5 }
        ]},
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#e0e0e0', font: { size: 13 } } }, tooltip: { backgroundColor: 'rgba(10,10,10,0.85)', titleFont: {size:13}, bodyFont:{size:12}, padding:10, borderColor:'#2c2c2c', borderWidth:1 } },
            scales: {
                yTemp: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Temp (°C)', color: '#b0bec5', font:{size:12} }, ticks: { color: '#90a4ae', font:{size:11} }, grid: { color: 'rgba(255,255,255,0.06)' } },
                yHumidity: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Humidity (%)', color: '#b0bec5', font:{size:12} }, ticks: { color: '#90a4ae', font:{size:11} }, grid: { drawOnChartArea: false } },
                x: { title: { display: true, text: 'Time', color: '#b0bec5', font:{size:12} }, ticks: { color: '#90a4ae', font:{size:11}, maxRotation: 0, autoSkipPadding: 25 }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });
}

// --- Simulated RGB Ring ---
function createSimulatedRgbRing() {
    const ring = document.getElementById('simulated-rgb-ring');
    if (!ring) return;
    const radius = 32; // px, half of ring width/height - border
    for (let i = 0; i < NUM_SIMULATED_LEDS; i++) {
        const led = document.createElement('div');
        led.classList.add('simulated-led');
        led.id = `sim-led-${i}`;
        const angle = (i / NUM_SIMULATED_LEDS) * 2 * Math.PI - (Math.PI / 2); // Start at top
        led.style.left = `${radius + radius * Math.cos(angle) - 6}px`; // -6 for half led width
        led.style.top = `${radius + radius * Math.sin(angle) - 6}px`;  // -6 for half led height
        ring.appendChild(led);
    }
}

function updateSimulatedRgbRing(espSystemStatus, fanIsOn) {
    const statusTextEl = document.getElementById('rgb-status-text');
    let text = 'Status Unknown';
    currentSimulatedLedAnimation.step++;

    // Simplified mapping from ESP system status to LED animations
    // This needs to closely mirror your ESP's LED logic for accuracy.
    // This is an APPROXIMATION. ESP has more detailed internal state.
    switch(espSystemStatus) {
        case 'WIFI_CONNECTING':
            currentSimulatedLedAnimation.mode = 'SPIN';
            currentSimulatedLedAnimation.color = { r: 0, g: 0, b: 200 }; // Blue
            text = 'WiFi Connecting...';
            break;
        case 'WIFI_CONNECTED_INDICATION': // After initial connect, before blink
            currentSimulatedLedAnimation.mode = 'WIPE';
            currentSimulatedLedAnimation.color = { r: 0, g: 0, b: 220 }; // Bright Blue
            currentSimulatedLedAnimation.wipeCounter = currentSimulatedLedAnimation.wipeCounter === undefined ? 0 : currentSimulatedLedAnimation.wipeCounter;
            text = 'WiFi Connected!';
            break;
        case 'WIFI_CONNECTED_BLINKING': // Actual blinking state on ESP
            currentSimulatedLedAnimation.mode = 'BLINK';
            currentSimulatedLedAnimation.color = { r: 0, g: 0, b: 220 };
            currentSimulatedLedAnimation.blinkCount = currentSimulatedLedAnimation.blinkCount === undefined ? 4 : currentSimulatedLedAnimation.blinkCount;
            text = 'WiFi Finalizing...';
            break;
        case 'FAN_ON_AUTO':
        case 'FAN_ON_MANUAL':
            currentSimulatedLedAnimation.mode = 'SOLID'; // Or 'WIPE' if you want to re-wipe on every update
            currentSimulatedLedAnimation.color = { r: 220, g: 0, b: 0 }; // Red
            text = fanIsOn ? 'Fan ON' : 'Fan Logic Error?';
            if (espSystemStatus === 'FAN_ON_MANUAL') text += ' (Manual)';
            break;
        case 'FAN_OFF': // Corresponds to S_OPERATIONAL_FAN_OFF
            currentSimulatedLedAnimation.mode = 'SOLID';
            currentSimulatedLedAnimation.color = { r: 0, g: 200, b: 0 }; // Green
            text = 'Fan OFF - Nominal';
            break;
        case 'TEMP_HIGH': // Corresponds to S_OPERATIONAL_TEMP_HIGH
            currentSimulatedLedAnimation.mode = 'PULSE';
            currentSimulatedLedAnimation.color = { r: 255, g: 100, b: 0 }; // Orange
            text = 'Temp High!';
            break;
        case 'SENSOR_ERROR':
            currentSimulatedLedAnimation.mode = 'SOLID';
            currentSimulatedLedAnimation.color = { r: 200, g: 200, b: 0 }; // Yellow
            text = 'Sensor Error!';
            break;
        case 'ESP_OFFLINE':
        case 'HTTP_FAILED':
            currentSimulatedLedAnimation.mode = 'PULSE';
            currentSimulatedLedAnimation.color = { r: 150, g: 0, b: 0 }; // Dim Red Pulse
            text = espSystemStatus === 'ESP_OFFLINE' ? 'ESP Offline' : 'Comms Error';
            break;
        default: // Includes S_OPERATIONAL_IDLE or if ESP is just connected but no specific fan state yet
            currentSimulatedLedAnimation.mode = 'SOLID';
            currentSimulatedLedAnimation.color = { r: 0, g: 180, b: 0 }; // Default to Green (fan off)
            text = 'System Nominal';
            break;
    }
    if(statusTextEl) statusTextEl.textContent = text;
    renderSimulatedLeds();
}

function renderSimulatedLeds() {
    const anim = currentSimulatedLedAnimation;
    const step = anim.step;

    for (let i = 0; i < NUM_SIMULATED_LEDS; i++) {
        const ledEl = document.getElementById(`sim-led-${i}`);
        if (!ledEl) continue;
        let r = 0, g = 0, b = 0;

        switch(anim.mode) {
            case 'SOLID':
                r = anim.color.r; g = anim.color.g; b = anim.color.b;
                break;
            case 'WIPE': // Simplified wipe for simulation
                if (anim.wipeCounter === undefined) anim.wipeCounter = 0;
                if (i <= anim.wipeCounter) { r = anim.color.r; g = anim.color.g; b = anim.color.b; }
                if (step % 5 === 0) anim.wipeCounter = (anim.wipeCounter + 1); // Slower wipe for sim
                if (anim.wipeCounter > NUM_SIMULATED_LEDS) anim.mode = 'SOLID'; // End wipe
                break;
            case 'BLINK': // Simplified blink
                 if (anim.blinkCount === undefined) anim.blinkCount = 4; // 2 ON/OFF
                 if (anim.blinkCount > 0) {
                     if (step % 10 < 5) { // On phase (5 intervals)
                         r = anim.color.r; g = anim.color.g; b = anim.color.b;
                     } else { /* Off phase */ }
                     if (step % 10 === 0) anim.blinkCount--;
                 } else { anim.mode = 'SOLID'; } // Default to solid after blink
                 break;
            case 'SPIN': // Blue spinning for WiFi connect
                const currentSpinLed = Math.floor(step / 3) % NUM_SIMULATED_LEDS;
                if (i === currentSpinLed) { r = 0; g = 0; b = 200;}
                else if (i === (currentSpinLed + NUM_SIMULATED_LEDS - 1) % NUM_SIMULATED_LEDS) { r = 0; g = 0; b = 100;}
                else if (i === (currentSpinLed + NUM_SIMULATED_LEDS - 2) % NUM_SIMULATED_LEDS) { r = 0; g = 0; b = 50;}
                break;
            case 'PULSE':
                const brightnessFactor = (Math.sin(step * 0.1) + 1) / 2; // 0 to 1
                r = Math.floor(anim.color.r * brightnessFactor);
                g = Math.floor(anim.color.g * brightnessFactor);
                b = Math.floor(anim.color.b * brightnessFactor);
                break;
            default: // OFF
                break;
        }
        ledEl.style.backgroundColor = `rgb(${r},${g},${b})`;
        if (r > 150 || g > 150 || b > 150) { // Add a glow for bright LEDs
            ledEl.style.boxShadow = `0 0 8px 2px rgba(${r},${g},${b},0.7)`;
        } else {
            ledEl.style.boxShadow = '0 0 3px rgba(0,0,0,0.3)';
        }
    }
}


// --- Pyramid Diagram Status & Arrows ---
function updateDiagramStatusDots(espStatus, flaskStatus, supabaseStatus) {
    const setDot = (id, status) => { /* ... Keep as is ... */ 
        const dotEl = document.getElementById(id); if (!dotEl) return;
        dotEl.className = 'status-dot'; 
        if (status === 'online') dotEl.classList.add('online');
        else if (status === 'offline') dotEl.classList.add('offline');
        else dotEl.classList.add('degraded'); 
    };
    setDot('esp-dot', espStatus);
    setDot('flask-dot', flaskStatus);
    setDot('supabase-dot', supabaseStatus); // Assuming Flask checks/reports this
    setDot('web-dot', 'online');
}

function updatePyramidArrowPositions() {
    const flaskNode = document.getElementById('node-flask');
    const espNode = document.getElementById('node-esp');
    const supabaseNode = document.getElementById('node-supabase');
    const webNode = document.getElementById('node-web');
    const arrowSvg = document.querySelector('.pyramid-arrows');

    if (!flaskNode || !espNode || !supabaseNode || !webNode || !arrowSvg) return;

    // Get bounding boxes for precise center calculation
    const fr = flaskNode.getBoundingClientRect();
    const er = espNode.getBoundingClientRect();
    const sr = supabaseNode.getBoundingClientRect();
    const wr = webNode.getBoundingClientRect();
    const svgR = arrowSvg.getBoundingClientRect(); // SVG's position relative to viewport

    // Calculate centers relative to the SVG container
    const flaskCenter = { x: fr.left + fr.width / 2 - svgR.left, y: fr.top + fr.height / 2 - svgR.top };
    const espCenter =   { x: er.left + er.width / 2 - svgR.left, y: er.top + er.height / 2 - svgR.top };
    const supCenter =   { x: sr.left + sr.width / 2 - svgR.left, y: sr.top + sr.height / 2 - svgR.top };
    const webCenter =   { x: wr.left + wr.width / 2 - svgR.left, y: wr.top + wr.height / 2 - svgR.top };

    // Adjust arrow endpoints (example, might need fine-tuning for aesthetics)
    // Points for lines should be calculated to connect edges of nodes, not centers, for cleaner look.
    // This is a simplified version just connecting centers for now.
    // A more advanced version would calculate intersection points on the node boundaries.

    // ESP <-> Flask
    document.getElementById('arrow-esp-flask-data')?.setAttribute('x1', espCenter.x);
    document.getElementById('arrow-esp-flask-data')?.setAttribute('y1', er.top - svgR.top); // From top of ESP
    document.getElementById('arrow-esp-flask-data')?.setAttribute('x2', flaskCenter.x);
    document.getElementById('arrow-esp-flask-data')?.setAttribute('y2', fr.bottom - svgR.top); // To bottom of Flask

    document.getElementById('arrow-flask-esp-config')?.setAttribute('x1', flaskCenter.x);
    document.getElementById('arrow-flask-esp-config')?.setAttribute('y1', fr.bottom - svgR.top - 5); // Start a bit above flask bottom edge
    document.getElementById('arrow-flask-esp-config')?.setAttribute('x2', espCenter.x);
    document.getElementById('arrow-flask-esp-config')?.setAttribute('y2', er.top - svgR.top + 5); // End a bit below esp top edge

    // Flask <-> Supabase
    document.getElementById('arrow-flask-db-data')?.setAttribute('x1', fr.right - svgR.left); // From right of Flask
    document.getElementById('arrow-flask-db-data')?.setAttribute('y1', flaskCenter.y);
    document.getElementById('arrow-flask-db-data')?.setAttribute('x2', sr.left - svgR.left);   // To left of Supabase
    document.getElementById('arrow-flask-db-data')?.setAttribute('y2', supCenter.y);

    // Flask <-> Web
    document.getElementById('arrow-flask-web-data')?.setAttribute('x1', fr.right - svgR.left);
    document.getElementById('arrow-flask-web-data')?.setAttribute('y1', flaskCenter.y + 10); // Offset slightly
    document.getElementById('arrow-flask-web-data')?.setAttribute('x2', wr.left - svgR.left);
    document.getElementById('arrow-flask-web-data')?.setAttribute('y2', webCenter.y + 10);

    document.getElementById('arrow-web-flask-control')?.setAttribute('x1', wr.left - svgR.left);
    document.getElementById('arrow-web-flask-control')?.setAttribute('y1', webCenter.y - 10); // Offset slightly
    document.getElementById('arrow-web-flask-control')?.setAttribute('x2', fr.right - svgR.left);
    document.getElementById('arrow-web-flask-control')?.setAttribute('y2', flaskCenter.y - 10);
}


function updatePyramidArrowActiveStates(espStatus, flaskStatus, supabaseStatus, lastEspDataTimestamp) {
    const setArrowActive = (id, active) => { /* ... Keep as is ... */ 
        const arrowEl = document.getElementById(id); if (!arrowEl) return;
        arrowEl.classList.toggle('active', active);
        const markerId = arrowEl.getAttribute('marker-end')?.replace('url(#', '').replace(')', '');
        if(markerId) {
            const marker = document.getElementById(markerId);
            if(marker) marker.style.fill = active ? '#63b3ed' : '#4a5568';
        }
    };
    let isEspDataFlowing = false;
    if (espStatus === 'online' && flaskStatus === 'online' && lastEspDataTimestamp) {
        const dataAgeSeconds = (new Date() - new Date(lastEspDataTimestamp)) / 1000;
        if (dataAgeSeconds < 120) isEspDataFlowing = true; 
    }
    const isFlaskAbleToProcess = flaskStatus === 'online';

    setArrowActive('arrow-esp-flask-data', isEspDataFlowing);
    setArrowActive('arrow-flask-esp-config', isFlaskAbleToProcess); 
    setArrowActive('arrow-flask-db-data', isEspDataFlowing && supabaseStatus === 'online');
    setArrowActive('arrow-flask-web-data', isFlaskAbleToProcess);
    setArrowActive('arrow-web-flask-control', isFlaskAbleToProcess);
}