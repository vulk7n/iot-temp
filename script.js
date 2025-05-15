const FLASK_SERVER_URL = 'https://flask.vlkn.in'; // Leave empty if served from same domain as Flask, or e.g. http://localhost:5000
let tempHumidityChart;
let lastFetchedConfig = {}; // To avoid unnecessary UI updates if data hasn't changed

document.addEventListener('DOMContentLoaded', () => {
    initChart();
    fetchLatestDataAndUpdateUI(); // Initial fetch

    setInterval(fetchLatestDataAndUpdateUI, 5000); // Fetch status every 5 seconds
    setInterval(fetchHistoricalData, 45000); // Fetch chart data every 45 seconds

    document.getElementById('update-base-config-btn').addEventListener('click', updateBaseConfiguration);
    
    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    const manualFanButtonsDiv = document.getElementById('manual-fan-buttons');

    manualModeToggle.addEventListener('change', () => {
        const isManualModeActive = manualModeToggle.checked;
        manualFanButtonsDiv.style.display = isManualModeActive ? 'flex' : 'none'; // Use flex for button layout
        // When toggling manual mode, send current intended fan state if activating, or just deactivate
        let targetFanState = null; 
        if (isManualModeActive) {
            // When turning manual ON, default to current *actual* fan state if known, else OFF
            const fanActualElement = document.getElementById('fan-actual-status');
            targetFanState = fanActualElement.textContent.toUpperCase().includes('ON');
        }
        sendManualFanSettings(isManualModeActive, targetFanState);
    });

    document.getElementById('manual-fan-on-btn').addEventListener('click', () => {
        sendManualFanSettings(true, true); // Manual active, fan ON
    });
    document.getElementById('manual-fan-off-btn').addEventListener('click', () => {
        sendManualFanSettings(true, false); // Manual active, fan OFF
    });
});

function getApiUrl(endpoint) {
    return FLASK_SERVER_URL ? `${FLASK_SERVER_URL}${endpoint}` : endpoint;
}

function displayMessage(elementId, text, type = 'success') {
    const el = document.getElementById(elementId);
    el.textContent = text;
    el.className = type === 'success' ? 'message-success' : 'message-error';
    setTimeout(() => { el.textContent = ''; el.className = ''; }, 4000);
}

async function fetchLatestDataAndUpdateUI() {
    try {
        const response = await fetch(getApiUrl('/api/latest_data'));
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();

        // Update sensor readings
        const reading = data.latest_reading;
        document.getElementById('temp-value').textContent = reading.temperature !== null ? parseFloat(reading.temperature).toFixed(1) : '--';
        document.getElementById('humidity-value').textContent = reading.humidity !== null ? parseFloat(reading.humidity).toFixed(1) : '--';
        document.getElementById('fan-actual-status').textContent = reading.fan_on ? 'ON' : 'OFF';
        document.getElementById('last-update').textContent = reading.timestamp ? new Date(reading.timestamp).toLocaleString() : '--';

        // Update control inputs only if they haven't changed or are not focused
        const currentConfig = data.current_config;
        if (JSON.stringify(currentConfig) !== JSON.stringify(lastFetchedConfig)) {
            updateControlInputs(currentConfig);
            lastFetchedConfig = { ...currentConfig };
        }
        
        // Update fan control mode display
        document.getElementById('fan-control-mode').textContent = currentConfig.manual_fan_control_active ? `MANUAL (${currentConfig.manual_fan_target_state ? 'ON' : 'OFF'})` : 'AUTO';

        // Update live diagram
        updateDiagramStatus(data.esp_status, data.flask_status, data.supabase_status, reading.timestamp);

    } catch (error) {
        console.error("Error fetching latest data:", error);
        document.getElementById('temp-value').textContent = 'Err';
        // Potentially update diagram to show server/connection error
        updateDiagramStatus('unknown', 'offline', 'unknown', null);
    }
}

function updateControlInputs(config) {
    const fanThresholdInput = document.getElementById('fan-threshold');
    if (document.activeElement !== fanThresholdInput) {
        fanThresholdInput.value = parseFloat(config.fan_threshold_temp).toFixed(1);
    }

    const rgbBrightnessInput = document.getElementById('rgb-brightness');
    if (document.activeElement !== rgbBrightnessInput) {
        rgbBrightnessInput.value = parseInt(config.rgb_brightness);
    }

    const manualModeToggle = document.getElementById('manual-fan-mode-toggle');
    if (document.activeElement !== manualModeToggle) {
        manualModeToggle.checked = config.manual_fan_control_active;
    }
    document.getElementById('manual-fan-buttons').style.display = config.manual_fan_control_active ? 'flex' : 'none';
    
    updateManualFanButtonActiveState(config.manual_fan_control_active, config.manual_fan_target_state);
}

function updateManualFanButtonActiveState(isManualMode, targetState) {
    const onBtn = document.getElementById('manual-fan-on-btn');
    const offBtn = document.getElementById('manual-fan-off-btn');
    onBtn.classList.remove('active');
    offBtn.classList.remove('active');

    if (isManualMode) {
        if (targetState === true) onBtn.classList.add('active');
        else if (targetState === false) offBtn.classList.add('active');
    }
}

async function updateBaseConfiguration() {
    const threshold = document.getElementById('fan-threshold').value;
    const brightness = document.getElementById('rgb-brightness').value;
    displayMessage('base-config-message', 'Updating...', 'success');

    try {
        const response = await fetch(getApiUrl('/api/update_config'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fan_threshold_temp: parseFloat(threshold),
                rgb_brightness: parseInt(brightness),
            }),
        });
        const result = await response.json();
        if (response.ok) {
            displayMessage('base-config-message', 'Auto/RGB Config updated!', 'success');
            lastFetchedConfig = { ...lastFetchedConfig, ...result.current_config }; // Update local cache
        } else {
            displayMessage('base-config-message', `Error: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        displayMessage('base-config-message', 'Network error.', 'error');
    }
}

async function sendManualFanSettings(manualControlActive, manualFanTargetState) {
    // manualFanTargetState is true for ON, false for OFF.
    // If manualControlActive is false, manualFanTargetState's value is less critical for this call but good to send.
    displayMessage('manual-fan-message', 'Sending fan command...', 'success');

    const payload = { 
        manual_control_active: manualControlActive,
        manual_fan_state: manualFanTargetState === null ? false : manualFanTargetState // Send a boolean for state
    };

    try {
        const response = await fetch(getApiUrl('/api/set_fan_manual'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (response.ok) {
            displayMessage('manual-fan-message', 'Fan command sent!', 'success');
            // Update UI based on what was sent, Flask will confirm actual state later
            updateManualFanButtonActiveState(result.manual_fan_control_active, result.manual_fan_target_state);
            document.getElementById('fan-control-mode').textContent = result.manual_fan_control_active ? `MANUAL (${result.manual_fan_target_state ? 'ON' : 'OFF'})` : 'AUTO';
            lastFetchedConfig.manual_fan_control_active = result.manual_fan_control_active;
            lastFetchedConfig.manual_fan_target_state = result.manual_fan_target_state;

        } else {
            displayMessage('manual-fan-message', `Error: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        displayMessage('manual-fan-message', 'Network error setting fan.', 'error');
    }
}

function initChart() {
    const ctx = document.getElementById('tempHumidityChart').getContext('2d');
    Chart.defaults.color = '#bdc3c7'; 
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';

    tempHumidityChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [ /* ... as before ... */ ] },
        options: { /* ... as before, ensure dark theme colors ... */ }
    });
    // Copied from previous detailed JS for chart config:
    tempHumidityChart.data = {
        labels: [],
        datasets: [
            {
                label: 'Temperature (°C)', data: [], borderColor: '#e74c3c', backgroundColor: 'rgba(231, 76, 60, 0.2)',
                tension: 0.2, yAxisID: 'yTemp', pointRadius: 2, pointBackgroundColor: '#e74c3c'
            },
            {
                label: 'Humidity (%)', data: [], borderColor: '#3498db', backgroundColor: 'rgba(52, 152, 219, 0.2)',
                tension: 0.2, yAxisID: 'yHumidity', pointRadius: 2, pointBackgroundColor: '#3498db'
            }
        ]
    };
    tempHumidityChart.options = {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#ecf0f1' } } },
        scales: {
            yTemp: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Temp (°C)', color: '#ecf0f1' }, ticks: { color: '#bdc3c7' }, grid: { color: 'rgba(255,255,255,0.08)' } },
            yHumidity: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Humidity (%)', color: '#ecf0f1' }, ticks: { color: '#bdc3c7' }, grid: { drawOnChartArea: false } },
            x: { title: { display: true, text: 'Time', color: '#ecf0f1' }, ticks: { color: '#bdc3c7', maxRotation: 0, autoSkipPadding: 20 }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
    };
    tempHumidityChart.update();
}

async function fetchHistoricalData() {
    try {
        const response = await fetch(getApiUrl('/api/historical_data?limit=120')); // Fetch more data points
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        const labels = data.map(d => new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        const tempData = data.map(d => d.temperature);
        const humidityData = data.map(d => d.humidity);

        tempHumidityChart.data.labels = labels;
        tempHumidityChart.data.datasets[0].data = tempData;
        tempHumidityChart.data.datasets[1].data = humidityData;
        tempHumidityChart.update('none'); // 'none' for no animation, smoother update for live charts

    } catch (error) {
        console.error("Error fetching historical data:", error);
    }
}

function updateDiagramStatus(espStatus, flaskStatus, supabaseStatus, lastEspDataTimestamp) {
    const setDot = (id, status) => {
        const dotEl = document.getElementById(id);
        if (!dotEl) return;
        dotEl.className = 'status-dot'; // Reset
        if (status === 'online') dotEl.classList.add('online');
        else if (status === 'offline') dotEl.classList.add('offline');
        else dotEl.classList.add('degraded'); // For 'unknown' or error states
    };
    const setArrow = (id, active) => {
        const arrowEl = document.getElementById(id);
        if (!arrowEl) return;
        arrowEl.classList.toggle('active', active);
    };

    setDot('esp-dot', espStatus);
    setDot('flask-dot', flaskStatus);
    setDot('supabase-dot', supabaseStatus);
    setDot('web-dot', 'online'); // Website is always "online" from its own perspective

    let isEspDataFlowing = false;
    if (espStatus === 'online' && flaskStatus === 'online' && lastEspDataTimestamp) {
        const dataAgeSeconds = (new Date() - new Date(lastEspDataTimestamp)) / 1000;
        if (dataAgeSeconds < 60) isEspDataFlowing = true; // Data received within last minute
    }
    
    setArrow('arrow-esp-flask', isEspDataFlowing);
    setArrow('arrow-flask-supabase', flaskStatus === 'online' && supabaseStatus === 'online' && isEspDataFlowing); // If ESP data flows and Supabase is up
    setArrow('arrow-flask-web', flaskStatus === 'online'); // Data from Flask to Web is generally available if Flask is up
    setArrow('arrow-web-flask', flaskStatus === 'online'); // Control from Web to Flask is generally available if Flask is up
}