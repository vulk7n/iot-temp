// --- Supabase Client Initialization ---
const SUPABASE_URL = 'https://qrhkkeworjtpnznfwtne.supabase.co';    // << REPLACE WITH YOUR ACTUAL URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyaGtrZXdvcmp0cG56bmZ3dG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU3NTIzOTEsImV4cCI6MjA2MTMyODM5MX0.r91yGy0MJu1-e884Qbk89S8U1Riyjn4le6fuQz7Rs3E'; // << REPLACE WITH YOUR ACTUAL ANON KEY

let supabaseClient = null; // Our variable to hold the initialized client

// --- Global Variables ---
const FLASK_SERVER_URL = 'https://flask.vlkn.in'; // e.g., http://localhost:5000 or leave empty if same domain
let tempHumidityChart;
let lastFetchedConfig = {}; // To avoid unnecessary UI updates if data hasn't changed
const NUM_SIMULATED_LEDS = 12;
let simRingState = { // New object to hold the state for the simulated ring
    targetMode: 'NONE', // e.g., 'WIPE', 'BLINK', 'SOLID', 'SPIN', 'PULSE', 'CHASE'
    targetColor: { r: 0, g: 0, b: 0 },
    wipeCounter: 0,
    blinkCounter: 0, 
    blinkState: false, 
    animationStep: 0, 
    statusText: 'Initializing...' 
};
const SIM_NEOPIXEL_ANIMATION_INTERVAL = 60; // ms, for simulated ring update rate


// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded. Initializing application...");

    // Attempt to Initialize Supabase client
    try {
        // 'supabase' is the global object from the CDN <script> tag
        if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function' && 
            SUPABASE_URL && SUPABASE_ANON_KEY && 
            SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log("Supabase client initialized successfully via DOMContentLoaded.");
        } else if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL' || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
            console.warn("Supabase URL or Anon Key NOT CONFIGURED in script.js. Direct Supabase features (like historical chart) will be disabled.");
            // alert("Supabase not configured. Chart data may not load."); // Optional: For hard mobile debugging
        } else if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
            console.error("Supabase library (supabase object or createClient method) not loaded. Check script order in HTML or network. Ensure Supabase CDN script is loaded BEFORE script.js.");
            // alert("Critical error: Supabase library not found. Page may not work correctly."); // Optional
        }
    } catch (error) {
        console.error("Error initializing Supabase client in DOMContentLoaded:", error);
        // alert("Error initializing Supabase: " + error.message); // Optional
    }

    createSimulatedRgbRing();
    initChart(); // Initialize chart structure

    // Initial data fetches
    fetchLatestDataAndUpdateUI().catch(err => console.error("Initial fetchLatestData error:", err)); 
    fetchHistoricalData().catch(err => console.error("Initial fetchHistoricalData error:", err));      

    // Periodic updates
    setInterval(fetchLatestDataAndUpdateUI, 3000); 
    setInterval(fetchHistoricalData, 60000); 

    // Event Listeners
    const updateBaseConfigBtn = document.getElementById('update-base-config-btn');
    if (updateBaseConfigBtn) updateBaseConfigBtn.addEventListener('click', updateBaseConfiguration);
    
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    if(manualModeToggle) manualModeToggle.addEventListener('change', handleManualModeToggle);
    
    const manualFanOnBtn = document.getElementById('manual-fan-on-btn');
    if(manualFanOnBtn) manualFanOnBtn.addEventListener('click', () => sendManualFanSettings(true, true));
    
    const manualFanOffBtn = document.getElementById('manual-fan-off-btn');
    if(manualFanOffBtn) manualFanOffBtn.addEventListener('click', () => sendManualFanSettings(true, false));
    
    const scrollToGraphBtn = document.getElementById('scroll-to-graph-btn');
    if(scrollToGraphBtn) scrollToGraphBtn.addEventListener('click', () => {
        const chartSection = document.getElementById('chart-section');
        if(chartSection) chartSection.scrollIntoView({ behavior: 'smooth' });
    });

    updatePyramidArrowPositions(); 
    window.addEventListener('resize', debounce(updatePyramidArrowPositions, 100)); 
    setInterval(renderSimulatedLedsV2, SIM_NEOPIXEL_ANIMATION_INTERVAL);
    console.log("Application setup complete.");
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
function getApiUrl(endpoint) { return FLASK_SERVER_URL ? `${FLASK_SERVER_URL}${endpoint}` : endpoint; }

// --- Message Display Helper ---
function displayMessage(elementId, text, type = 'success') {
    const el = document.getElementById(elementId);
    if (!el) { console.warn("Display message element not found:", elementId); return; }
    el.textContent = text;
    el.className = 'message'; 
    if (type === 'success') el.classList.add('message-success');
    else el.classList.add('message-error');
    setTimeout(() => { if(el) {el.textContent = ''; el.className = 'message';} }, 4000);
}

// --- Data Fetching & UI Updates ---
async function fetchLatestDataAndUpdateUI() {
    try {
        const response = await fetch(getApiUrl('/api/latest_data'));
        if (!response.ok) {
            console.error(`HTTP error ${response.status} fetching latest data.`);
            throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        
        const reading = data.latest_reading || {}; 
        const espIsOnline = data.esp_status === 'online';
        const currentConfig = data.current_config || {}; 

        const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

        setText('temp-value', espIsOnline && reading.temperature !== null && reading.temperature !== undefined ? `${parseFloat(reading.temperature).toFixed(1)} °C` : '-- °C');
        setText('humidity-value', espIsOnline && reading.humidity !== null && reading.humidity !== undefined ? `${parseFloat(reading.humidity).toFixed(1)} %` : '-- %');
        setText('fan-actual-status', espIsOnline && reading.fan_on !== null && reading.fan_on !== undefined ? (reading.fan_on ? 'ON' : 'OFF') : '--');
        setText('last-update', espIsOnline && reading.created_at ? new Date(reading.created_at).toLocaleString() : '--');
        
        if (currentConfig.manual_fan_control_active !== undefined) {
            setText('fan-control-mode', currentConfig.manual_fan_control_active ? `MANUAL (${currentConfig.manual_fan_target_state ? 'ON' : 'OFF'})` : 'AUTO');
        } else {
            setText('fan-control-mode', 'AUTO'); 
        }
        
        if (JSON.stringify(currentConfig) !== JSON.stringify(lastFetchedConfig)) {
            updateControlInputs(currentConfig);
            lastFetchedConfig = { ...currentConfig };
        }
        
        updateDiagramStatusDots(data.esp_status, data.flask_status, data.supabase_status);
        updatePyramidArrowActiveStates(data.esp_status, data.flask_status, data.supabase_status, espIsOnline && reading.created_at);

        if (espIsOnline) {
            let derivedEspStatus = currentConfig?.esp_internal_state || 'S_OPERATIONAL_IDLE'; 
             if (!currentConfig?.esp_internal_state) { 
                const fanIsOn = reading.fan_on; 
                const isManual = currentConfig.manual_fan_control_active;
                if (fanIsOn) derivedEspStatus = isManual ? 'S_OPERATIONAL_FAN_ON_MANUAL' : 'S_OPERATIONAL_FAN_ON_AUTO';
                else if (reading.temperature > currentConfig.fan_threshold_temp + 2.0 && !isManual) derivedEspStatus = 'S_OPERATIONAL_TEMP_HIGH';
                else derivedEspStatus = 'S_OPERATIONAL_FAN_OFF';
            }
            updateSimulatedRgbTarget(derivedEspStatus);
        } else { 
            updateSimulatedRgbTarget('ESP_OFFLINE');
        }
        // const statusTextEl = document.getElementById('rgb-status-text'); // Moved into updateSimulatedRgbTarget
        // if (statusTextEl) statusTextEl.textContent = simRingState.statusText;

    } catch (error) {
        console.error("Error in fetchLatestDataAndUpdateUI:", error);
        const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        setText('temp-value', '-- °C'); setText('humidity-value', '-- %');
        setText('fan-actual-status', '--'); setText('last-update', 'Error');
        updateDiagramStatusDots('offline', 'offline', 'unknown'); 
        updatePyramidArrowActiveStates('offline', 'offline', 'unknown', null);
        updateSimulatedRgbTarget('ESP_OFFLINE_ERROR');
    }
}

async function fetchHistoricalData() { 
    const chartErrorMessageEl = document.getElementById('chart-error-message');
    const chartCanvas = document.getElementById('tempHumidityChart');

    if (!supabaseClient) { 
        console.warn("Supabase client not available for historical data.");
        if (chartErrorMessageEl) {
            chartErrorMessageEl.textContent = "Chart data unavailable (Supabase not connected).";
            chartErrorMessageEl.style.display = 'block';
        }
        if (chartCanvas) chartCanvas.style.display = 'none';
        return; 
    }
    // If Supabase client is available, ensure chart is visible and error message is hidden
    if (chartErrorMessageEl) chartErrorMessageEl.style.display = 'none';
    if (chartCanvas && chartCanvas.style.display === 'none') chartCanvas.style.display = 'block';


    try {
        const pointsToFetch = 150; 
        
        const { data, error } = await supabaseClient
            .from('sensor_readings')
            .select('created_at, temperature, humidity')
            .order('created_at', { ascending: false }) 
            .limit(pointsToFetch);                      

        if (error) {
            console.error("Error fetching historical data from Supabase:", error);
            if (chartErrorMessageEl) { chartErrorMessageEl.textContent = "Error loading chart data."; chartErrorMessageEl.style.display = 'block'; }
            return;
        }

        if (data && data.length > 0) {
            const sortedData = data.reverse(); 
            const labels = sortedData.map(d => new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            const tempData = sortedData.map(d => d.temperature === null || d.temperature === undefined ? null : parseFloat(d.temperature)); // Handle nulls
            const humidityData = sortedData.map(d => d.humidity === null || d.humidity === undefined ? null : parseFloat(d.humidity)); // Handle nulls


            if (tempHumidityChart) {
                tempHumidityChart.data.labels = labels;
                tempHumidityChart.data.datasets[0].data = tempData;
                tempHumidityChart.data.datasets[1].data = humidityData;
                tempHumidityChart.update('none'); 
            }
        } else {
            console.log("No historical data received from Supabase or data is empty.");
            if (tempHumidityChart) { 
                tempHumidityChart.data.labels = [];
                tempHumidityChart.data.datasets[0].data = [];
                tempHumidityChart.data.datasets[1].data = [];
                tempHumidityChart.update('none');
            }
        }
    } catch (error) {
        console.error("Exception during fetchHistoricalData (Supabase direct):", error);
        if (chartErrorMessageEl) { chartErrorMessageEl.textContent = "Failed to process chart data."; chartErrorMessageEl.style.display = 'block';}
    }
}

// --- Control Input & Manual Mode Handling ---
function updateControlInputs(config) { 
    const fanThresholdInput = document.getElementById('fan-threshold');
    if (fanThresholdInput && document.activeElement !== fanThresholdInput && config.fan_threshold_temp !== undefined) {
        fanThresholdInput.value = parseFloat(config.fan_threshold_temp).toFixed(1);
    }
    const rgbBrightnessInput = document.getElementById('rgb-brightness');
    if (rgbBrightnessInput && document.activeElement !== rgbBrightnessInput && config.rgb_brightness !== undefined) {
        rgbBrightnessInput.value = parseInt(config.rgb_brightness);
    }
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    if (manualModeToggle && document.activeElement !== manualModeToggle && config.manual_fan_control_active !== undefined && manualModeToggle.checked !== config.manual_fan_control_active) {
        manualModeToggle.checked = config.manual_fan_control_active;
    }
    const manualFanButtons = document.getElementById('manual-fan-buttons');
    if (manualFanButtons && config.manual_fan_control_active !== undefined) {
        manualFanButtons.style.display = config.manual_fan_control_active ? 'flex' : 'none';
    }
    if (config.manual_fan_control_active !== undefined && config.manual_fan_target_state !== undefined) {
        updateManualFanButtonActiveState(config.manual_fan_control_active, config.manual_fan_target_state);
    }
}

function handleManualModeToggle() { 
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    const manualFanButtonsDiv = document.getElementById('manual-fan-buttons');
    if(!manualModeToggle || !manualFanButtonsDiv) return;

    const isManualModeActive = manualModeToggle.checked;
    manualFanButtonsDiv.style.display = isManualModeActive ? 'flex' : 'none';
    let targetFanState = null; 
    if (isManualModeActive) {
        const fanActualElement = document.getElementById('fan-actual-status');
        if (fanActualElement) targetFanState = fanActualElement.textContent.toUpperCase().includes('ON');
    }
    sendManualFanSettings(isManualModeActive, targetFanState);
}

function updateManualFanButtonActiveState(isManualMode, targetState) { 
    const onBtn = document.getElementById('manual-fan-on-btn');
    const offBtn = document.getElementById('manual-fan-off-btn');
    if(!onBtn || !offBtn) return;
    onBtn.classList.remove('active'); offBtn.classList.remove('active');
    if (isManualMode) { if (targetState === true) onBtn.classList.add('active'); else if (targetState === false) offBtn.classList.add('active'); }
}

async function updateBaseConfiguration() { 
    const thresholdInput = document.getElementById('fan-threshold');
    const brightnessInput = document.getElementById('rgb-brightness');
    if(!thresholdInput || !brightnessInput) return;

    const threshold = thresholdInput.value;
    const brightness = brightnessInput.value;
    displayMessage('base-config-message', 'Updating...', 'success');
    try {
        const response = await fetch(getApiUrl('/api/update_config'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fan_threshold_temp: parseFloat(threshold), rgb_brightness: parseInt(brightness) }),
        });
        const result = await response.json();
        if (response.ok && result.current_config) { 
            displayMessage('base-config-message', 'Auto/RGB Config updated!', 'success'); 
            lastFetchedConfig = { ...lastFetchedConfig, ...result.current_config }; 
            updateControlInputs(result.current_config);
        } else { displayMessage('base-config-message', `Error: ${result.error || 'Unknown error'}`, 'error'); }
    } catch (error) { displayMessage('base-config-message', 'Network error.', 'error'); }
}

async function sendManualFanSettings(manualControlActive, manualFanTargetState) { 
    displayMessage('manual-fan-message', 'Sending fan command...', 'success');
    const payload = { manual_control_active: manualControlActive, manual_fan_state: manualFanTargetState === null ? false : manualFanTargetState };
    try {
        const response = await fetch(getApiUrl('/api/set_fan_manual'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        const fanControlModeEl = document.getElementById('fan-control-mode');
        if (response.ok) { 
            displayMessage('manual-fan-message', 'Fan command sent!', 'success'); 
            updateManualFanButtonActiveState(result.manual_fan_control_active, result.manual_fan_target_state);
            if(fanControlModeEl) fanControlModeEl.textContent = result.manual_fan_control_active ? `MANUAL (${result.manual_fan_target_state ? 'ON' : 'OFF'})` : 'AUTO';
            lastFetchedConfig.manual_fan_control_active = result.manual_fan_control_active; 
            lastFetchedConfig.manual_fan_target_state = result.manual_fan_target_state;
        } else { displayMessage('manual-fan-message', `Error: ${result.error || 'Unknown error'}`, 'error'); }
    } catch (error) { displayMessage('manual-fan-message', 'Network error setting fan.', 'error'); }
}

// --- Chart Initialization ---
function initChart() { 
    const ctx = document.getElementById('tempHumidityChart');
    if (!ctx) { console.error("Chart canvas not found!"); return; }
    Chart.defaults.color = '#b0bec5'; Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
    tempHumidityChart = new Chart(ctx.getContext('2d'), { type: 'line',
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
    ring.innerHTML = ''; // Clear previous LEDs if any
    const radius = 32; 
    for (let i = 0; i < NUM_SIMULATED_LEDS; i++) {
        const led = document.createElement('div');
        led.classList.add('simulated-led');
        led.id = `sim-led-${i}`;
        const angle = (i / NUM_SIMULATED_LEDS) * 2 * Math.PI - (Math.PI / 2); 
        led.style.left = `${radius + radius * Math.cos(angle) - 6}px`; 
        led.style.top = `${radius + radius * Math.sin(angle) - 6}px`;  
        ring.appendChild(led);
    }
}

function updateSimulatedRgbTarget(espEquivalentStatus) { 
    const statusTextEl = document.getElementById('rgb-status-text');
    switch(espEquivalentStatus) { // espEquivalentStatus is a string like "S_WIFI_CONNECTING"
        case 'S_WIFI_CONNECTING': case 'S_WIFI_CONNECTION_FAILED_RETRY':
            simRingState.targetMode = 'SPIN'; simRingState.targetColor = { r: 0, g: 0, b: 200 }; simRingState.statusText = 'WiFi Connecting...';
            break;
        case 'S_WIFI_CONNECTED_INIT_ANIM': 
            simRingState.targetMode = 'WIPE'; simRingState.targetColor = { r: 0, g: 0, b: 220 }; simRingState.wipeCounter = 0; simRingState.statusText = 'WiFi Connected!';
            break;
        case 'S_OPERATIONAL_FAN_ON_AUTO': case 'S_OPERATIONAL_FAN_ON_MANUAL':
            simRingState.targetMode = simRingState.targetMode === 'WIPE' && simRingState.wipeCounter < NUM_SIMULATED_LEDS ? 'WIPE' : 'SOLID'; // Continue wipe if in progress
            simRingState.targetColor = { r: 220, g: 0, b: 0 }; 
            simRingState.statusText = `Fan ON (${espEquivalentStatus.includes('MANUAL') ? 'Manual' : 'Auto'})`;
            break;
        case 'S_OPERATIONAL_FAN_OFF': case 'S_OPERATIONAL_IDLE': 
            simRingState.targetMode = simRingState.targetMode === 'WIPE' && simRingState.wipeCounter < NUM_SIMULATED_LEDS ? 'WIPE' : 'SOLID';
            simRingState.targetColor = { r: 0, g: 200, b: 0 }; 
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

function renderSimulatedLedsV2() { 
    const anim = simRingState; anim.animationStep++;
    for (let i = 0; i < NUM_SIMULATED_LEDS; i++) {
        const ledEl = document.getElementById(`sim-led-${i}`); if (!ledEl) continue;
        let r = 10, g = 10, b = 10; 

        switch(anim.targetMode) { 
            case 'SOLID': r = anim.targetColor.r; g = anim.targetColor.g; b = anim.targetColor.b; break;
            case 'WIPE':
                if (anim.wipeCounter === undefined) anim.wipeCounter = 0;
                // Ensure LEDs before wipeCounter are off or dim, current one is target, rest are off/dim
                if (i < anim.wipeCounter) {
                    // Option 1: Keep them lit with target color
                    // r = anim.targetColor.r; g = anim.targetColor.g; b = anim.targetColor.b;
                    // Option 2: Or make them a dim version if you want a "trail" to disappear
                     r = anim.targetColor.r / 3; g = anim.targetColor.g / 3; b = anim.targetColor.b / 3;
                } else if (i === anim.wipeCounter) {
                    r = anim.targetColor.r; g = anim.targetColor.g; b = anim.targetColor.b;
                } // else they remain dim (r=10,g=10,b=10)

                if (anim.animationStep % 2 === 0 && anim.wipeCounter < NUM_SIMULATED_LEDS) anim.wipeCounter++; 
                if (anim.wipeCounter >= NUM_SIMULATED_LEDS) { 
                    if (simRingState.statusText === 'WiFi Connected!') { 
                        anim.targetMode = 'BLINK'; anim.blinkCounter = NEOPIXEL_MAX_BLINKS; anim.blinkState = true; anim.wipeCounter = 0; 
                    } else { anim.targetMode = 'SOLID'; }
                }
                break;
            case 'BLINK':
                if (anim.blinkCounter === undefined || anim.blinkCounter <= 0) {
                    anim.targetMode = 'SOLID'; 
                    anim.targetColor = { r: 0, g: 180, b: 0 }; // Default to green after blink
                } else {
                    // Calculate how many animation frames per blink phase
                    const framesPerBlinkPhase = Math.max(1, Math.floor(NEOPIXEL_BLINK_INTERVAL / SIM_NEOPIXEL_ANIMATION_INTERVAL));
                    if (anim.blinkState) { // ON phase
                         r = anim.targetColor.r; g = anim.targetColor.g; b = anim.targetColor.b;
                    } /* else stays dim off */

                    // Check if it's time to toggle blinkState and decrement blinkCounter
                    if (anim.animationStep % framesPerBlinkPhase === 0) {
                        anim.blinkState = !anim.blinkState;
                        if (!anim.blinkState) { // Just finished an ON phase, now OFF, decrement counter
                           anim.blinkCounter--;
                        }
                    }
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
            case 'CHASE': 
                if (i === anim.animationStep % NUM_SIMULATED_LEDS) { r=anim.targetColor.r; g=anim.targetColor.g; b=anim.targetColor.b; }
                break;
        }
        ledEl.style.backgroundColor = `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
        if (r > 100 || g > 100 || b > 100) ledEl.style.boxShadow = `0 0 7px 2px rgba(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)},0.6)`;
        else ledEl.style.boxShadow = '0 0 3px rgba(0,0,0,0.3)';
    }
}


// --- Pyramid Diagram Status & Arrows ---
function updateDiagramStatusDots(espStatus, flaskStatus, supabaseStatus) { 
    const setDot = (id, status) => { 
        const dotEl = document.getElementById(id); if (!dotEl) return;
        dotEl.className = 'status-dot'; 
        if (status === 'online') dotEl.classList.add('online');
        else if (status === 'offline') dotEl.classList.add('offline');
        else dotEl.classList.add('degraded'); 
    };
    setDot('esp-dot', espStatus);
    setDot('flask-dot', flaskStatus);
    setDot('supabase-dot', supabaseStatus); 
    setDot('web-dot', 'online');
}

function getElementConnectionPoint(elementId, svgRect, side = 'center', offset = 0) {
    const el = document.getElementById(elementId);
    if (!el) return { x: 0, y: 0, valid: false };
    const rect = el.getBoundingClientRect();
    let point = {
        x: rect.left + rect.width / 2 - svgRect.left,
        y: rect.top + rect.height / 2 - svgRect.top,
        valid: true
    };

    switch(side) {
        case 'top':    point.y = rect.top - svgRect.top - offset; break;
        case 'bottom': point.y = rect.bottom - svgRect.top + offset; break;
        case 'left':   point.x = rect.left - svgRect.left - offset; break;
        case 'right':  point.x = rect.right - svgRect.left + offset; break;
    }
    return point;
}


function updatePyramidArrowPositions() {
    const svg = document.getElementById('pyramid-arrows-svg');
    if (!svg) return;
    const svgRect = svg.getBoundingClientRect();

    const arrowOffset = 5; // Offset from node edge

    const points = {
        flask:    getElementConnectionPoint('node-flask', svgRect, 'center'),
        esp:      getElementConnectionPoint('node-esp', svgRect, 'center'),
        supabase: getElementConnectionPoint('node-supabase', svgRect, 'center'),
        web:      getElementConnectionPoint('node-web', svgRect, 'center')
    };

    if (!points.flask.valid || !points.esp.valid || !points.supabase.valid || !points.web.valid) return;

    const setLine = (lineId, p1, p2) => {
        const line = document.getElementById(lineId);
        if (line) {
            line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
            line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
        }
    };

    // ESP data -> Flask (bottom of Flask)
    setLine('line-esp-flask-data', 
        getElementConnectionPoint('node-esp', svgRect, 'top', arrowOffset), 
        getElementConnectionPoint('node-flask', svgRect, 'bottom', arrowOffset)
    );
    // Flask config -> ESP (top of ESP)
    setLine('line-flask-esp-config', 
        getElementConnectionPoint('node-flask', svgRect, 'bottom', arrowOffset), 
        getElementConnectionPoint('node-esp', svgRect, 'top', arrowOffset)
    );

    // Flask data -> Supabase (top of Supabase)
    setLine('line-flask-db-data', 
        getElementConnectionPoint('node-flask', svgRect, 'bottom', arrowOffset), 
        getElementConnectionPoint('node-supabase', svgRect, 'top', arrowOffset)
    );

    // Flask data -> Web UI (left of Web UI)
    setLine('line-flask-web-data', 
        getElementConnectionPoint('node-flask', svgRect, 'right', arrowOffset), 
        getElementConnectionPoint('node-web', svgRect, 'left', arrowOffset)
    );
    // Web UI control -> Flask (right of Flask)
    setLine('line-web-flask-control', 
        getElementConnectionPoint('node-web', svgRect, 'left', arrowOffset), 
        getElementConnectionPoint('node-flask', svgRect, 'right', arrowOffset)
    );
}


function updatePyramidArrowActiveStates(espStatus, flaskStatus, supabaseStatus, lastEspDataTimestamp) {
    const setArrowActive = (id, active) => { 
        const arrowEl = document.getElementById(id); if (!arrowEl) return;
        arrowEl.classList.toggle('active', active);
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