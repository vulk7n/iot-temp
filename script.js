document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // Replace with your actual Flask server URL (must be HTTPS if Cloudflare Pages is HTTPS)
    const API_BASE_URL = 'https://flask.vlkn.in/api'; // Use /api prefix for web endpoints
    const DATA_FETCH_INTERVAL = 5000; // Fetch latest data every 5 seconds (ms)
    const HISTORY_FETCH_INTERVAL = 60000; // Fetch history every 60 seconds (ms)

    // --- DOM Elements ---
    const tempEl = document.getElementById('temp');
    const humidityEl = document.getElementById('humidity');
    const fanStatusEl = document.getElementById('fan-status');
    const modeEl = document.getElementById('mode');
    const lastUpdateEl = document.getElementById('last-update');

    const targetTempInput = document.getElementById('target-temp');
    const manualModeSwitch = document.getElementById('manual-mode');
    const manualFanControlGroup = document.getElementById('manual-fan-control-group');
    const manualFanSwitch = document.getElementById('manual-fan-state');
    const manualFanLabel = document.getElementById('manual-fan-label');
    const saveConfigButton = document.getElementById('save-config');
    const configStatusEl = document.getElementById('config-status');
    const refreshHistoryButton = document.getElementById('refresh-history');

    // --- Chart Setup ---
    const ctx = document.getElementById('sensorChart').getContext('2d');
    let sensorChart; // To hold the chart instance

    function initializeChart() {
        sensorChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [], // Timestamps
                datasets: [
                    {
                        label: 'Temperature (°C)',
                        data: [], // Temperature values
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        yAxisID: 'yTemp',
                        tension: 0.1
                    },
                    {
                        label: 'Humidity (%)',
                        data: [], // Humidity values
                        borderColor: 'rgb(54, 162, 235)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        yAxisID: 'yHum',
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                stacked: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Sensor Readings Over Time',
                        color: '#e0e0e0'
                    },
                    legend: {
                         labels: { color: '#e0e0e0' }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'minute', // Adjust as needed (e.g., 'hour', 'day')
                             tooltipFormat: 'MMM d, yyyy, h:mm:ss a', // Format for tooltips
                             displayFormats: {
                                minute: 'h:mm a' // Format for axis labels
                            }
                        },
                        title: {
                            display: true,
                            text: 'Time',
                            color: '#c0c0c0'
                        },
                        ticks: { color: '#c0c0c0' }
                    },
                    yTemp: { // Temperature axis
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Temperature (°C)',
                            color: 'rgb(255, 99, 132)'
                        },
                         ticks: { color: 'rgb(255, 99, 132)' }
                    },
                    yHum: { // Humidity axis
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Humidity (%)',
                            color: 'rgb(54, 162, 235)'
                        },
                         ticks: { color: 'rgb(54, 162, 235)' },
                        // Ensure humidity axis doesn't overlap temp axis
                        grid: {
                            drawOnChartArea: false, // Only draw grid for temp axis
                        },
                    }
                }
            }
        });
    }


    // --- API Fetch Functions ---
    async function fetchData(endpoint) {
        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error fetching ${endpoint}:`, error);
            configStatusEl.textContent = `Error fetching data: ${error.message}`;
            configStatusEl.className = 'status-message error';
            return null; // Indicate failure
        }
    }

     async function postData(endpoint, data) {
        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ message: 'Unknown error' })); // Try to get error message from body
                throw new Error(`HTTP error! status: ${response.status} - ${errorData.message}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error posting to ${endpoint}:`, error);
            configStatusEl.textContent = `Error saving config: ${error.message}`;
            configStatusEl.className = 'status-message error';
            return null; // Indicate failure
        }
    }


    // --- Update UI Functions ---
    function updateLatestDataUI(data) {
        if (!data || !data.sensor_data) {
            console.warn("No latest data received or data format incorrect.");
            tempEl.textContent = 'N/A';
            humidityEl.textContent = 'N/A';
            fanStatusEl.textContent = 'N/A';
            fanStatusEl.className = '';
            modeEl.textContent = 'N/A';
            lastUpdateEl.textContent = new Date().toLocaleTimeString(); // Show fetch time
            return;
        }

         const sensorData = data.sensor_data;
         const configData = data.config; // Config is now part of the /latest response

        tempEl.textContent = sensorData.temperature !== null ? sensorData.temperature.toFixed(1) : 'N/A';
        humidityEl.textContent = sensorData.humidity !== null ? sensorData.humidity.toFixed(1) : 'N/A';

        if (sensorData.fan_on !== null) {
             fanStatusEl.textContent = sensorData.fan_on ? 'ON' : 'OFF';
             fanStatusEl.className = sensorData.fan_on ? 'status-on' : 'status-off';
        } else {
             fanStatusEl.textContent = 'N/A';
             fanStatusEl.className = '';
        }

        if(configData) {
            modeEl.textContent = configData.manual_mode ? 'Manual' : 'Automatic';
        } else {
             modeEl.textContent = 'N/A';
        }


        lastUpdateEl.textContent = sensorData.timestamp ? new Date(sensorData.timestamp).toLocaleString() : new Date().toLocaleTimeString();
    }

     function updateConfigUI(config) {
         if (!config) return;
         targetTempInput.value = config.target_temp !== null ? config.target_temp.toFixed(1) : '';
         manualModeSwitch.checked = config.manual_mode || false;
         manualFanSwitch.checked = config.manual_fan_state || false;
         toggleManualFanControls(manualModeSwitch.checked); // Update visibility based on fetched state
          updateManualFanLabel();
    }


    function updateChart(historyData) {
        if (!sensorChart || !historyData || historyData.length === 0) {
            console.warn("Chart not initialized or no history data.");
            return;
        }

        const labels = historyData.map(d => new Date(d.created_at).valueOf()); // Use timestamp value for Chart.js time scale
        const tempData = historyData.map(d => d.temperature);
        const humidityData = historyData.map(d => d.humidity);

        sensorChart.data.labels = labels;
        sensorChart.data.datasets[0].data = tempData; // Update temperature data
        sensorChart.data.datasets[1].data = humidityData; // Update humidity data
        sensorChart.update(); // Redraw the chart
    }

    // --- Event Handlers ---
    function toggleManualFanControls(isManual) {
         manualFanControlGroup.style.display = isManual ? 'flex' : 'none';
         updateManualFanLabel(); // Update label text when visibility changes
    }

     function updateManualFanLabel() {
        manualFanLabel.textContent = `(Currently ${manualFanSwitch.checked ? 'ON' : 'OFF'})`;
     }

    manualModeSwitch.addEventListener('change', (event) => {
        toggleManualFanControls(event.target.checked);
    });

     manualFanSwitch.addEventListener('change', () => {
        updateManualFanLabel();
     });


    async function handleSaveConfig() {
        const configData = {
            target_temp: parseFloat(targetTempInput.value),
            manual_mode: manualModeSwitch.checked,
            manual_fan_state: manualFanSwitch.checked // Always send current switch state
        };

        configStatusEl.textContent = 'Saving...';
        configStatusEl.className = 'status-message'; // Reset class

        const result = await postData('/config', configData);

        if (result && result.status === 'success') {
            configStatusEl.textContent = 'Configuration saved successfully!';
            configStatusEl.className = 'status-message success';
            // Optionally re-fetch latest data to confirm UI update immediately
             fetchLatest();
        } else {
            // Error message is set within postData
             configStatusEl.textContent = result?.message || 'Failed to save configuration.';
             configStatusEl.className = 'status-message error';
        }
        // Clear status message after a few seconds
        setTimeout(() => { configStatusEl.textContent = ''; }, 5000);
    }

    saveConfigButton.addEventListener('click', handleSaveConfig);
    refreshHistoryButton.addEventListener('click', fetchHistory); // Manual refresh


    // --- Initial Load and Periodic Fetch ---
    async function fetchLatest() {
         console.log("Fetching latest data...");
         const latest = await fetchData('/latest');
         if(latest) {
             updateLatestDataUI(latest);
             // Update config controls based on the combined /latest response
             updateConfigUI(latest.config);
         }
    }

    async function fetchHistory() {
        console.log("Fetching history data...");
        const history = await fetchData('/history?limit=100'); // Fetch last 100 points
         if (history) {
            updateChart(history);
         }
    }

    // --- Initialization ---
    initializeChart();
    fetchLatest(); // Initial fetch for latest data and config
    fetchHistory(); // Initial fetch for history

    // Set up periodic fetching
    setInterval(fetchLatest, DATA_FETCH_INTERVAL);
    // setInterval(fetchHistory, HISTORY_FETCH_INTERVAL); // Less frequent history update or use manual button
});
