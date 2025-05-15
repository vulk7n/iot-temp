const FLASK_SERVER_URL = 'https://flask.vlkn.in/'; // e.g., http://flask.vlkn.in or http://localhost:5000 for local dev
                             // If served from same domain, can be relative: /api/...

let tempHumidityChart;

document.addEventListener('DOMContentLoaded', () => {
    initChart();
    fetchLatestData();
    fetchHistoricalData(); // Initial fetch for chart

    // Fetch data periodically
    setInterval(fetchLatestData, 10000); // Every 10 seconds for live data
    setInterval(fetchHistoricalData, 60000); // Every 1 minute for chart data

    document.getElementById('update-config-btn').addEventListener('click', updateConfiguration);
});

function getApiUrl(endpoint) {
    // If FLASK_SERVER_URL is empty, assume API is on the same origin
    return FLASK_SERVER_URL ? `${FLASK_SERVER_URL}${endpoint}` : endpoint;
}


async function fetchLatestData() {
    try {
        const response = await fetch(getApiUrl('/api/latest_data'));
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        const reading = data.latest_reading;
        document.getElementById('temp-value').textContent = reading.temperature !== null ? parseFloat(reading.temperature).toFixed(1) : '--';
        document.getElementById('humidity-value').textContent = reading.humidity !== null ? parseFloat(reading.humidity).toFixed(1) : '--';
        document.getElementById('fan-status').textContent = reading.fan_on ? 'ON' : 'OFF';
        document.getElementById('last-update').textContent = reading.created_at ? new Date(reading.created_at).toLocaleString() : '--';

        // Update current config values in the input fields
        document.getElementById('fan-threshold').value = parseFloat(data.current_config.fan_threshold_temp).toFixed(1);
        document.getElementById('rgb-brightness').value = parseInt(data.current_config.rgb_brightness);

        // Update live diagram status
        updateDiagramStatus(data.esp_status, data.flask_status, data.supabase_status, reading.created_at);

    } catch (error) {
        console.error("Error fetching latest data:", error);
        document.getElementById('temp-value').textContent = 'Error';
        document.getElementById('humidity-value').textContent = 'Error';
        // Update diagram to show error for Flask or connection
        updateDiagramStatus('offline', 'offline', 'unknown', null); // Or specific error state
    }
}

async function fetchHistoricalData() {
    try {
        const response = await fetch(getApiUrl('/api/historical_data'));
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json(); // Expects an array of {temperature, humidity, created_at}

        const labels = data.map(d => new Date(d.created_at).toLocaleTimeString());
        const tempData = data.map(d => d.temperature);
        const humidityData = data.map(d => d.humidity);

        tempHumidityChart.data.labels = labels;
        tempHumidityChart.data.datasets[0].data = tempData;
        tempHumidityChart.data.datasets[1].data = humidityData;
        tempHumidityChart.update();

    } catch (error) {
        console.error("Error fetching historical data:", error);
    }
}

async function updateConfiguration() {
    const threshold = document.getElementById('fan-threshold').value;
    const brightness = document.getElementById('rgb-brightness').value;
    const messageEl = document.getElementById('config-message');

    messageEl.textContent = 'Updating...';

    try {
        const response = await fetch(getApiUrl('/api/update_config'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fan_threshold_temp: parseFloat(threshold),
                rgb_brightness: parseInt(brightness),
            }),
        });

        const result = await response.json();

        if (response.ok) {
            messageEl.textContent = 'Configuration updated successfully!';
            messageEl.style.color = 'green';
        } else {
            messageEl.textContent = `Error: ${result.error || 'Unknown error'}`;
            messageEl.style.color = 'red';
        }
    } catch (error) {
        console.error("Error updating configuration:", error);
        messageEl.textContent = 'Network error while updating configuration.';
        messageEl.style.color = 'red';
    }

    setTimeout(() => { messageEl.textContent = ''; }, 5000);
}


function initChart() {
    const ctx = document.getElementById('tempHumidityChart').getContext('2d');
    tempHumidityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Temperature (°C)',
                    data: [],
                    borderColor: 'rgb(255, 99, 132)',
                    tension: 0.1,
                    yAxisID: 'yTemp',
                },
                {
                    label: 'Humidity (%)',
                    data: [],
                    borderColor: 'rgb(54, 162, 235)',
                    tension: 0.1,
                    yAxisID: 'yHumidity',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                yTemp: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Temperature (°C)' }
                },
                yHumidity: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: 'Humidity (%)' },
                    grid: { drawOnChartArea: false } // Only show grid for one axis
                },
                x: {
                    title: { display: true, text: 'Time' }
                }
            }
        }
    });
}

function updateDiagramStatus(espStatus, flaskStatus, supabaseStatus, lastEspDataTimestamp) {
    const espDot = document.getElementById('esp-dot');
    const flaskDot = document.getElementById('flask-dot');
    const supabaseDot = document.getElementById('supabase-dot');
    const webDot = document.getElementById('web-dot'); // Website is always "online" from its own perspective

    const arrowEspFlask = document.getElementById('arrow-esp-flask');
    const arrowFlaskSupabase = document.getElementById('arrow-flask-supabase');
    const arrowFlaskWeb = document.getElementById('arrow-flask-web');

    // Helper to set dot status
    const setDot = (dotEl, status) => {
        dotEl.className = 'status-dot'; // Reset
        if (status === 'online') dotEl.classList.add('online');
        else if (status === 'offline') dotEl.classList.add('offline');
        else dotEl.classList.add('degraded'); // For 'unknown' or other states
    };

    setDot(espDot, espStatus);
    setDot(flaskDot, flaskStatus);
    setDot(supabaseDot, supabaseStatus);
    setDot(webDot, 'online');

    // Arrow animations based on data flow
    // If ESP sent data recently and Flask is online, animate ESP -> Flask
    let isEspDataFlowing = false;
    if (espStatus === 'online' && flaskStatus === 'online' && lastEspDataTimestamp) {
        const dataAgeSeconds = (new Date() - new Date(lastEspDataTimestamp)) / 1000;
        if (dataAgeSeconds < 120) { // Data received within last 2 minutes
            isEspDataFlowing = true;
        }
    }
    
    arrowEspFlask.classList.toggle('active', isEspDataFlowing);
    // If Flask is online and Supabase is online, assume data flows (harder to track actual DB write from frontend)
    arrowFlaskSupabase.classList.toggle('active', flaskStatus === 'online' && supabaseStatus === 'online' && isEspDataFlowing);
    // If Flask is online, assume data can flow to web
    arrowFlaskWeb.classList.toggle('active', flaskStatus === 'online');
}