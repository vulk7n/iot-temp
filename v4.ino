// --- LIBRARIES ---
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h> 
#include <DHT.h>
#include <Adafruit_NeoPixel.h>

// --- PIN DEFINITIONS ---
#define DHT_PIN D1
#define RELAY_PIN D2
#define NEOPIXEL_PIN D3
#define BUZZER_PIN D5

// --- DEVICE & NETWORK CONFIGURATION ---
#define NEOPIXEL_LED_COUNT 12
const char* WIFI_SSID = "Shubham"; 
const char* WIFI_PASSWORD = "shikhashine4"; 
const char* FLASK_SERVER_HOST = "flask.vlkn.in";
const int FLASK_SERVER_PORT = 443; 
const String API_PATH_DATA = "/api/data";
const String API_PATH_CONFIG = "/api/config";

// --- TIMING INTERVALS (milliseconds) ---
const unsigned long WIFI_CONNECT_TIMEOUT = 20000; 
const unsigned long WIFI_RETRY_DELAY = 7000;    
const unsigned long DHT_READ_INTERVAL = 3000;
const unsigned long DATA_SEND_INTERVAL = 15000;   
const unsigned long CONFIG_FETCH_INTERVAL = 10000;  
const unsigned long NEOPIXEL_UPDATE_INTERVAL = 50; 
const unsigned long HEAP_LOG_INTERVAL = 15000;
unsigned long lastWiFiStatusCheckMillis = 0; 
const unsigned long WIFI_STATUS_CHECK_INTERVAL = 3000;


// --- NEOPIXEL SETUP ---
Adafruit_NeoPixel pixels(NEOPIXEL_LED_COUNT, NEOPIXEL_PIN, NEO_GRB + NEO_KHZ800);
byte ledBrightness = 20; 

// --- DHT SENSOR SETUP ---
DHT dht(DHT_PIN, DHT11);

// --- GLOBAL STATE VARIABLES ---
float currentTemperature = 0.0f;
float currentHumidity = 0.0f;
bool dhtOnline = true;
bool fanState = false; 

// Configurable parameters (defaults, updated from server)
float fanThresholdTemperature = 25.0f;
bool manualFanControl = false;
bool manualFanState = false;

// System operational state enum
enum OpState {
    STATE_BOOTING,
    STATE_WIFI_CONNECTING,
    STATE_WIFI_CONNECTION_FAILED_RETRY,
    STATE_WIFI_CONNECTED_INIT_ANIM, 
    STATE_OPERATIONAL,
    STATE_ERROR_WIFI_DISCONNECTED, 
    STATE_ERROR_SENSOR,
    STATE_HTTP_ACTIVE, 
    STATE_ERROR_HTTP 
};
OpState currentOpState = STATE_BOOTING;
OpState previousOpStateForLog = STATE_BOOTING;

volatile bool httpClientIsActive = false; 
bool initialConfigFetched = false; 

// NeoPixel animation specific state
enum LedAnimMode { 
    LED_ANIM_NONE,      
    LED_ANIM_WIPE,      
    LED_ANIM_BLINK,     
    LED_ANIM_SOLID,      
    LED_ANIM_CONNECTING_SPIN, 
    LED_ANIM_ERROR_PULSE,     
    LED_ANIM_TEMP_HIGH_PULSE, 
    LED_ANIM_HTTP_ACTIVE_CHASE 
};
LedAnimMode currentLedAnim = LED_ANIM_NONE;      // Master current animation mode
uint32_t ledAnimColor = pixels.Color(0,0,0);   // Target color for current effect
int ledWipePixelCounter = -1;                 // Progress for WIPE
int ledBlinkPhaseCounter = 0;                // Progress for BLINK
bool ledIsOnInBlink = false;                  // ON/OFF state for BLINK
unsigned long lastLedEffectStepMillis = 0;    // Timer for WIPE/BLINK/PULSE steps
uint8_t genericAnimStep = 0;                  // General purpose animator step

const int NEOPIXEL_WIPE_STEP_DELAY = 60;    
const int NEOPIXEL_BLINK_INTERVAL = 250;    
const int NEOPIXEL_MAX_BLINK_PHASES = 4; 


// --- TIMERS ---
unsigned long lastWiFiAttemptMillis = 0;
unsigned long lastDHTReadMillis = 0;
unsigned long lastDataSendMillis = 0;
unsigned long lastConfigFetchMillis = 0;
unsigned long lastNeoPixelUpdateMillis = 0;
unsigned long lastHeapLogMillis = 0;


// --- FUNCTION FORWARD DECLARATIONS ---
void connectToWiFi(); 
void readDHTSensor();
void controlFan(); 
void sendDataToServer();
void fetchConfigFromServer();
bool executeHttpRequest(const String& path, const String& method, const String& body, String& response);
void parseServerConfig(const String& jsonConfig);
void updateLedDisplayMaster(); 
void renderCurrentLedAnimation(); 
void startLedEffect(LedAnimMode effect, uint32_t color = 0, int auxParam = 0); 
void playTune(const int melody[], const int durations[], int notes);
String opStateToString(OpState state);
uint8_t sin8_C(uint8_t theta); 

// --- BUZZER TUNES --- 
const int tuneWiFiConnect[] = {392, 440, 392}; const int durWiFiConnect[] = {100,100,150}; 
const int tuneError[] = {440,0,440}; const int durError[] = {150,50,150}; 
const int tuneFanOn[] = {262,392}; const int durFanOn[] = {100,150}; 
const int tuneWiFiFailedRetry[] = {330, 262}; const int durWiFiFailedRetry[] = {150, 200};


//------------------------------------------------------------------------------------
// SETUP
//------------------------------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    while(!Serial) { delay(10); } 
    Serial.println(F("\n[SETUP] Device Starting..."));
    Serial.print(F("[SETUP] Free Heap: ")); Serial.println(ESP.getFreeHeap());
    Serial.print(F("[SETUP] ESP Core Ver: ")); Serial.println(ESP.getCoreVersion());

    pinMode(RELAY_PIN, OUTPUT); digitalWrite(RELAY_PIN, LOW); 
    pinMode(BUZZER_PIN, OUTPUT);

    pixels.begin();
    pixels.setBrightness(ledBrightness);
    pixels.clear(); pixels.show(); 
    Serial.println(F("[SETUP] NeoPixels Initialized."));

    dht.begin();
    Serial.println(F("[SETUP] DHT Initialized."));

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(false); 

    currentOpState = STATE_WIFI_CONNECTING; 
    startLedEffect(LED_ANIM_CONNECTING_SPIN, pixels.Color(0,0,ledBrightness)); 
    Serial.println(F("[SETUP] Setup complete. Initializing WiFi connection."));
}

//------------------------------------------------------------------------------------
// MAIN LOOP
//------------------------------------------------------------------------------------
void loop() {
    unsigned long currentMillis = millis();

    // --- WiFi Connection Management ---
    if (currentMillis - lastWiFiStatusCheckMillis >= WIFI_STATUS_CHECK_INTERVAL) {
        lastWiFiStatusCheckMillis = currentMillis;
        bool isConnected = WiFi.isConnected();

        if (!isConnected) {
            if (currentOpState != STATE_WIFI_CONNECTING && currentOpState != STATE_WIFI_CONNECTION_FAILED_RETRY) {
                Serial.println(F("[WIFI] Disconnected. Attempting reconnect."));
                currentOpState = STATE_WIFI_CONNECTING;
                initialConfigFetched = false; 
                startLedEffect(LED_ANIM_CONNECTING_SPIN, pixels.Color(0,0,ledBrightness)); 
                lastWiFiAttemptMillis = 0; 
            }
        } else { 
            if ((currentOpState == STATE_WIFI_CONNECTING || currentOpState == STATE_WIFI_CONNECTION_FAILED_RETRY) && !initialConfigFetched) {
                Serial.print(F("[WIFI] Connected! IP: ")); Serial.println(WiFi.localIP());
                currentOpState = STATE_WIFI_CONNECTED_INIT_ANIM; 
                startLedEffect(LED_ANIM_WIPE, pixels.Color(0, 0, ledBrightness)); 
                playTune(tuneWiFiConnect, durWiFiConnect, sizeof(tuneWiFiConnect)/sizeof(int));
            } else if (currentOpState == STATE_ERROR_WIFI_DISCONNECTED) { 
                 Serial.println(F("[WIFI] Reconnected to network. Fetching config."));
                 currentOpState = STATE_OPERATIONAL; 
                 fetchConfigFromServer(); 
            }
        }
    }

    // State-based actions for WiFi connection process
    switch (currentOpState) {
        case STATE_WIFI_CONNECTING:
            if (!WiFi.isConnected()) { 
                if (lastWiFiAttemptMillis == 0) { 
                    connectToWiFi(); 
                } else if (currentMillis - lastWiFiAttemptMillis > WIFI_CONNECT_TIMEOUT) {
                    Serial.println(F("[WIFI] Connection Timeout. Will retry..."));
                    WiFi.disconnect(false); 
                    delay(100);
                    currentOpState = STATE_WIFI_CONNECTION_FAILED_RETRY;
                    lastWiFiAttemptMillis = currentMillis; 
                    startLedEffect(LED_ANIM_ERROR_PULSE, pixels.Color(80,0,0)); 
                    playTune(tuneWiFiFailedRetry, durWiFiFailedRetry, sizeof(tuneWiFiFailedRetry)/sizeof(int));
                }
            } 
            break;

        case STATE_WIFI_CONNECTION_FAILED_RETRY:
            if (!WiFi.isConnected()){
                if (currentMillis - lastWiFiAttemptMillis > WIFI_RETRY_DELAY) {
                    currentOpState = STATE_WIFI_CONNECTING;
                    startLedEffect(LED_ANIM_CONNECTING_SPIN, pixels.Color(0,0,ledBrightness));
                    lastWiFiAttemptMillis = 0; 
                }
            } 
            break;

        case STATE_WIFI_CONNECTED_INIT_ANIM: 
            if (currentLedAnim == LED_ANIM_NONE && !initialConfigFetched) { 
                 Serial.println(F("[WIFI_INIT] Animation done. Fetching initial config."));
                 fetchConfigFromServer(); 
                 if (currentOpState != STATE_ERROR_HTTP) { 
                    currentOpState = STATE_OPERATIONAL; 
                 }
                 controlFan(); 
            }
            break;
        
        case STATE_OPERATIONAL:
            if (WiFi.isConnected()) { 
                if (!initialConfigFetched && !httpClientIsActive) { 
                    fetchConfigFromServer(); 
                }
                if (currentMillis - lastDHTReadMillis >= DHT_READ_INTERVAL) {
                    lastDHTReadMillis = currentMillis;
                    readDHTSensor();
                }
                controlFan(); 

                if (dhtOnline && (currentMillis - lastDataSendMillis >= DATA_SEND_INTERVAL)) {
                    lastDataSendMillis = currentMillis;
                    sendDataToServer();
                }
                if (initialConfigFetched && (currentMillis - lastConfigFetchMillis >= CONFIG_FETCH_INTERVAL)) {
                    lastConfigFetchMillis = currentMillis;
                    fetchConfigFromServer();
                }
            } else {
                currentOpState = STATE_ERROR_WIFI_DISCONNECTED; 
            }
            break;
        
        default:
            break;
    }

    updateLedDisplayMaster();
    
    if (currentOpState != previousOpStateForLog) { 
        Serial.print(F("[STATE] Change: ")); Serial.print(opStateToString(previousOpStateForLog));
        Serial.print(F(" -> ")); Serial.println(opStateToString(currentOpState));
        if ((currentOpState == STATE_ERROR_SENSOR || currentOpState == STATE_ERROR_HTTP || currentOpState == STATE_ERROR_WIFI_DISCONNECTED) &&
            (previousOpStateForLog != STATE_ERROR_SENSOR && previousOpStateForLog != STATE_ERROR_HTTP && previousOpStateForLog != STATE_ERROR_WIFI_DISCONNECTED &&
             previousOpStateForLog != STATE_WIFI_CONNECTING && previousOpStateForLog != STATE_WIFI_CONNECTION_FAILED_RETRY) ) {
            playTune(tuneError, durError, sizeof(tuneError)/sizeof(int));
        }
        previousOpStateForLog = currentOpState;
    }
    if (currentMillis - lastHeapLogMillis >= HEAP_LOG_INTERVAL) { 
        lastHeapLogMillis = currentMillis; Serial.print(F("[HEAP] Free: ")); Serial.println(ESP.getFreeHeap());
    }
    delay(10); 
}

//------------------------------------------------------------------------------------
// WIFI FUNCTIONS
//------------------------------------------------------------------------------------
void connectToWiFi() { 
    Serial.print(F("[WIFI_FUNC] Attempting WiFi.begin for SSID: ")); Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWiFiAttemptMillis = millis(); 
}

//------------------------------------------------------------------------------------
// SENSOR FUNCTIONS
//------------------------------------------------------------------------------------
void readDHTSensor() { 
    float h = dht.readHumidity(); float t = dht.readTemperature();
    if (isnan(h) || isnan(t)) { if (dhtOnline) Serial.println(F("[DHT] Failed!")); dhtOnline = false; }
    else { if (!dhtOnline) Serial.println(F("[DHT] Online.")); dhtOnline = true; currentTemperature = t; currentHumidity = h; }
}

//------------------------------------------------------------------------------------
// FAN CONTROL
//------------------------------------------------------------------------------------
void controlFan() { 
    bool targetFanState = fanState; 
    if (!dhtOnline && !manualFanControl) { targetFanState = false; } 
    else { if (manualFanControl) targetFanState = manualFanState;
           else if (dhtOnline) { if (currentTemperature >= fanThresholdTemperature) targetFanState = true;
                                 else if (currentTemperature < fanThresholdTemperature - 0.5f) targetFanState = false; }
    }

    if (targetFanState != fanState) { 
        bool oldActualHardwareState = digitalRead(RELAY_PIN) == HIGH; 
        fanState = targetFanState;      
        digitalWrite(RELAY_PIN, fanState ? HIGH : LOW);
        
        if (fanState != oldActualHardwareState) { 
            Serial.print(F("[FAN] State changed to: ")); Serial.println(fanState ? "ON" : "OFF");
            Serial.print(F("    Mode: ")); Serial.print(manualFanControl ? "MANUAL" : "AUTO");
            Serial.print(F(", Temp: ")); Serial.print(currentTemperature, 1);
            Serial.print(F("C, Threshold: ")); Serial.println(fanThresholdTemperature, 1);

            if (initialConfigFetched && currentOpState == STATE_OPERATIONAL) { 
                pixels.clear(); pixels.show(); delay(20); 
                if (fanState) { 
                    playTune(tuneFanOn, durFanOn, sizeof(tuneFanOn)/sizeof(int));
                    startLedEffect(LED_ANIM_WIPE, pixels.Color(ledBrightness, 0, 0)); 
                } else { 
                    startLedEffect(LED_ANIM_WIPE, pixels.Color(0, ledBrightness, 0)); 
                }
            }
        }
    }
}

//------------------------------------------------------------------------------------
// HTTP COMMUNICATION
//------------------------------------------------------------------------------------
void sendDataToServer() { 
    if (!dhtOnline) { Serial.println(F("[HTTP_DATA] DHT Offline. Skip.")); return; }
    StaticJsonDocument<128> doc; 
    doc["temperature"] = currentTemperature; 
    doc["humidity"] = currentHumidity; 
    doc["fan_on"] = fanState;
    String body; serializeJson(doc, body); 
    String response;
    executeHttpRequest(API_PATH_DATA, "POST", body, response);
}

void fetchConfigFromServer() { 
    String response; 
    if (executeHttpRequest(API_PATH_CONFIG, "GET", "", response)) { 
        parseServerConfig(response); 
    } 
}

bool executeHttpRequest(const String& path, const String& method, const String& body, String& responseBuffer) {
    if (WiFi.status() != WL_CONNECTED) { Serial.println(F("[HTTP] No WiFi.")); currentOpState = STATE_ERROR_WIFI_DISCONNECTED; return false; } 
    OpState stateBeforeHttp = currentOpState; 
    currentOpState = STATE_HTTP_ACTIVE; 
    httpClientIsActive = true; 
    bool success = false; 
    std::unique_ptr<WiFiClientSecure> client(new WiFiClientSecure);
    if (!client) { Serial.println(F("[HTTP] Client alloc fail!")); currentOpState = STATE_ERROR_HTTP; httpClientIsActive = false; return false; }
    client->setInsecure(); HTTPClient http; http.setReuse(false); yield();
    
    if (http.begin(*client, FLASK_SERVER_HOST, FLASK_SERVER_PORT, path, true)) {
        http.addHeader("Content-Type", "application/json"); http.setTimeout(10000); int httpCode = 0;
        if (method == "POST") httpCode = http.POST(body); else if (method == "GET") httpCode = http.GET();
        else { Serial.println(F("[HTTP] Invalid method.")); http.end(); currentOpState = STATE_ERROR_HTTP; httpClientIsActive = false; return false; }
        
        Serial.print(F("[HTTP] ")); Serial.print(method); Serial.print(F(" ")); Serial.print(path); Serial.print(F(" -> Code: ")); Serial.println(httpCode);
        if (httpCode > 0) { responseBuffer = http.getString(); if (httpCode >= 200 && httpCode < 300) success = true; else { Serial.print(F(" ErrResp:")); Serial.println(responseBuffer.substring(0,min(80,(int)responseBuffer.length())));} }
        else { Serial.print(F(" Err: ")); Serial.println(http.errorToString(httpCode).c_str()); }
        http.end();
    } else { Serial.println(F("[HTTP] Begin FAILED.")); }
    
    if (success) {
        if (stateBeforeHttp == STATE_OPERATIONAL || stateBeforeHttp == STATE_ERROR_SENSOR || stateBeforeHttp == STATE_ERROR_WIFI_DISCONNECTED || stateBeforeHttp == STATE_WIFI_CONNECTED_INIT_ANIM ) {
            currentOpState = stateBeforeHttp; 
             if(currentOpState == STATE_WIFI_CONNECTED_INIT_ANIM && path == API_PATH_CONFIG) {
                // Stay in init anim state if it was the initial config fetch
             } else if (currentOpState != STATE_WIFI_CONNECTED_INIT_ANIM) { 
                currentOpState = STATE_OPERATIONAL; 
             }
        } else { 
            currentOpState = STATE_OPERATIONAL;
        }
    } else {
        currentOpState = STATE_ERROR_HTTP; 
    }
    httpClientIsActive = false; 
    if (path == API_PATH_CONFIG && success) initialConfigFetched = true;
    return success;
}

void parseServerConfig(const String& jsonConfig) { 
    if (jsonConfig.isEmpty()) { Serial.println(F("[JSON_CFG] Empty.")); return; }
    StaticJsonDocument<256> doc; DeserializationError error = deserializeJson(doc, jsonConfig);
    if (error) { Serial.print(F("[JSON_CFG] ParseFail: ")); Serial.println(error.f_str()); return; }
    Serial.println(F("[JSON_CFG] Parsed OK."));
    
    JsonVariant ftv=doc["fan_threshold_temp"]; if(!ftv.isNull()&&ftv.is<float>())fanThresholdTemperature=ftv.as<float>();
    JsonVariant bv=doc["rgb_brightness"]; if(!bv.isNull()){byte br=bv.as<byte>();br=constrain(br,5,80);if(br!=ledBrightness){ledBrightness=br;pixels.setBrightness(br);}}
    JsonVariant mcv=doc["manual_fan_control"]; if(!mcv.isNull()&&mcv.is<bool>())manualFanControl=mcv.as<bool>();
    JsonVariant msv=doc["manual_fan_state"]; if(!msv.isNull()&&msv.is<bool>())manualFanState=msv.as<bool>();
    Serial.print(F("    New Config: Th=")); Serial.print(fanThresholdTemperature,1); Serial.print(F("C,Br=")); Serial.print(ledBrightness); Serial.print(F(",ManM=")); Serial.print(manualFanControl); Serial.print(F(",ManS=")); Serial.println(manualFanState);
}


//------------------------------------------------------------------------------------
// LED & BUZZER FUNCTIONS
//------------------------------------------------------------------------------------
void startLedEffect(LedAnimMode effect, uint32_t color, int auxParam) {
    currentLedAnim = effect;
    ledAnimColor = color; 
    genericAnimStep = 0; 
    lastLedEffectStepMillis = millis();

    if (effect == LED_ANIM_WIPE) {
        ledWipePixelCounter = 0; 
    } else if (effect == LED_ANIM_BLINK) {
        ledBlinkPhaseCounter = auxParam; 
        ledIsOnInBlink = true; 
    }
}

void updateLedDisplayMaster() { 
    unsigned long currentMillis = millis();
    if (httpClientIsActive) { // Guard to prevent NeoPixel updates during HTTP requests
        return; 
    }

    if (currentMillis - lastNeoPixelUpdateMillis >= NEOPIXEL_UPDATE_INTERVAL) {
        lastNeoPixelUpdateMillis = currentMillis;
        renderCurrentLedAnimation(); 
        pixels.show();             
    }
}

void renderCurrentLedAnimation() {
    unsigned long currentMillis = millis(); 

    if (currentLedAnim == LED_ANIM_WIPE && ledWipePixelCounter >= 0) {
        if (currentMillis - lastLedEffectStepMillis >= NEOPIXEL_WIPE_STEP_DELAY) {
            lastLedEffectStepMillis = currentMillis;
            if (ledWipePixelCounter < NEOPIXEL_LED_COUNT) {
                pixels.setPixelColor(ledWipePixelCounter, ledAnimColor); 
            }
            ledWipePixelCounter++;
            if (ledWipePixelCounter > NEOPIXEL_LED_COUNT) { 
                ledWipePixelCounter = -1; 
                if (currentOpState == STATE_WIFI_CONNECTED_INIT_ANIM) { 
                    startLedEffect(LED_ANIM_BLINK, pixels.Color(0,0,ledBrightness), NEOPIXEL_MAX_BLINK_PHASES); 
                } else {
                    currentLedAnim = LED_ANIM_SOLID; 
                }
            }
        }
        // pixels.show() is in master
        return; 
    }
    else if (currentLedAnim == LED_ANIM_BLINK && ledBlinkPhaseCounter > 0) {
        if (currentMillis - lastLedEffectStepMillis >= NEOPIXEL_BLINK_INTERVAL) {
            lastLedEffectStepMillis = currentMillis;
            ledIsOnInBlink = !ledIsOnInBlink; 
            if (ledIsOnInBlink) { 
                for(int i=0; i<NEOPIXEL_LED_COUNT; i++) pixels.setPixelColor(i, ledAnimColor); 
            } else {
                pixels.clear();
            }
            ledBlinkPhaseCounter--;
            if (ledBlinkPhaseCounter <= 0) { 
                currentLedAnim = LED_ANIM_NONE; 
                pixels.clear(); 
                if (currentOpState == STATE_WIFI_CONNECTED_INIT_ANIM) { 
                    Serial.println(F("[LED] WiFi Init Blink Finished."));
                    currentOpState = STATE_OPERATIONAL; // Triggers config fetch in loop if needed
                }
            }
        }
        // pixels.show() is in master
        return;
    }
    
    if (currentLedAnim == LED_ANIM_SOLID) { 
        for(int i=0; i<NEOPIXEL_LED_COUNT; i++) pixels.setPixelColor(i, ledAnimColor); 
    } else { 
        pixels.clear(); 
        switch (currentOpState) {
            case STATE_WIFI_CONNECTING:
            case STATE_WIFI_CONNECTION_FAILED_RETRY:
                if (currentLedAnim != LED_ANIM_CONNECTING_SPIN) {
                     startLedEffect(LED_ANIM_CONNECTING_SPIN, pixels.Color(0,0,ledBrightness));
                }
                if (currentLedAnim == LED_ANIM_CONNECTING_SPIN) { 
                    uint8_t N = NEOPIXEL_LED_COUNT;
                    uint8_t dot = (genericAnimStep / 4) % N;  
                    pixels.setPixelColor(dot, ledAnimColor);  
                    pixels.setPixelColor((dot + 1) % N, pixels.Color( (ledAnimColor>>16 & 0xFF)/2, (ledAnimColor>>8 & 0xFF)/2, (ledAnimColor & 0xFF)/2 ));
                    pixels.setPixelColor((dot + 2) % N, pixels.Color( (ledAnimColor>>16 & 0xFF)/4, (ledAnimColor>>8 & 0xFF)/4, (ledAnimColor & 0xFF)/4 ));
                }
                break;
            
            case STATE_OPERATIONAL: 
                if (fanState) { 
                    for(int i=0; i<NEOPIXEL_LED_COUNT; i++) pixels.setPixelColor(i, pixels.Color(ledBrightness,0,0)); 
                } else { 
                    for(int i=0; i<NEOPIXEL_LED_COUNT; i++) pixels.setPixelColor(i, pixels.Color(0,ledBrightness,0)); 
                }
                if (!fanState && dhtOnline && currentTemperature > fanThresholdTemperature + 2.0f && !manualFanControl) {
                    if (currentLedAnim != LED_ANIM_TEMP_HIGH_PULSE) startLedEffect(LED_ANIM_TEMP_HIGH_PULSE, pixels.Color(ledBrightness, ledBrightness/2, 0));
                    if (currentLedAnim == LED_ANIM_TEMP_HIGH_PULSE) {
                        int rb=map(sin8_C(genericAnimStep*5),0,255, (ledAnimColor>>16 & 0xFF)/2, (ledAnimColor>>16 & 0xFF) ); 
                        int gb=map(sin8_C(genericAnimStep*5),0,255,0, (ledAnimColor>>8 & 0xFF)/2 );  
                        for(int i=0;i<NEOPIXEL_LED_COUNT;i++)pixels.setPixelColor(i,pixels.Color(rb,gb,0)); 
                    }
                } else if (currentLedAnim == LED_ANIM_TEMP_HIGH_PULSE) { 
                    currentLedAnim = LED_ANIM_NONE; 
                }
                break;

            case STATE_ERROR_WIFI_DISCONNECTED:
            case STATE_ERROR_HTTP:
                if (currentLedAnim != LED_ANIM_ERROR_PULSE) startLedEffect(LED_ANIM_ERROR_PULSE, pixels.Color(ledBrightness/2,0,0));
                if (currentLedAnim == LED_ANIM_ERROR_PULSE) {
                    int b = map(sin8_C(genericAnimStep * 3), 0, 255, 0, (ledAnimColor>>16 & 0xFF)); 
                    for(int i=0; i<NEOPIXEL_LED_COUNT; i++) pixels.setPixelColor(i, pixels.Color(b,0,0)); 
                }
                break;
            case STATE_ERROR_SENSOR: 
                for(int i=0; i<NEOPIXEL_LED_COUNT; i++) pixels.setPixelColor(i, pixels.Color(ledBrightness, (int)(ledBrightness*0.6), 0)); 
                break;
            
            case STATE_HTTP_ACTIVE: 
                if (currentLedAnim != LED_ANIM_HTTP_ACTIVE_CHASE) startLedEffect(LED_ANIM_HTTP_ACTIVE_CHASE, pixels.Color(ledBrightness/3,ledBrightness/3,ledBrightness/3));
                if (currentLedAnim == LED_ANIM_HTTP_ACTIVE_CHASE) {
                    pixels.clear();
                    pixels.setPixelColor(genericAnimStep % NEOPIXEL_LED_COUNT, ledAnimColor); 
                }
                break;
            
            default:
                break;
        }
    }
    // pixels.show() is called by updateLedDisplayMaster
    genericAnimStep++; 
}


uint8_t sin8_C(uint8_t theta) { 
    return (uint8_t)(sin(theta * PI / 128.0f) * 127.5f + 127.5f);
}

void playTune(const int notes[], const int durations[], int noteCount) {
    for (int i = 0; i < noteCount; i++) {
        if (notes[i] == 0) { 
            noTone(BUZZER_PIN);
        } else {
            tone(BUZZER_PIN, notes[i]); 
        }
        delay(durations[i]); 
        noTone(BUZZER_PIN);  
        if (i < noteCount - 1) { 
             delay(durations[i] / 4); 
        }
    }
}

String opStateToString(OpState state) { 
    switch(state){ 
        case STATE_BOOTING: return "Booting"; 
        case STATE_WIFI_CONNECTING: return "WiFi Connecting"; 
        case STATE_WIFI_CONNECTION_FAILED_RETRY: return "WiFi Retry"; 
        case STATE_WIFI_CONNECTED_INIT_ANIM: return "WiFi InitAnim"; 
        case STATE_OPERATIONAL: return "Operational"; 
        case STATE_ERROR_WIFI_DISCONNECTED: return "WiFi Disconnected (Op)"; 
        case STATE_ERROR_SENSOR: return "Sensor Error"; 
        case STATE_HTTP_ACTIVE: return "HTTP Active"; 
        case STATE_ERROR_HTTP: return "HTTP Error"; 
        default: return "Unknown OpState (" + String(state) + ")";
    }
}
