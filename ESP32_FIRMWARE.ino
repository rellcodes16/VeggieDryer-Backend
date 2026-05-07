/*
 * ESP32 Vegetable Dryer Firmware
 * 
 * Hardware:
 *   - ESP32 dev board
 *   - DHT22 sensor on pin 4  (temperature + humidity)
 *   - HX711 load cell on pins 5 (DT) and 18 (SCK)
 *   - Relay module on pin 26  (controls heating element)
 * 
 * Libraries needed (install via Arduino Library Manager):
 *   - DHT sensor library by Adafruit
 *   - HX711 by Bogdan Necula (or similar)
 *   - ArduinoJson by Benoit Blanchon
 *   - HTTPClient (built-in ESP32)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// WiFi & Server Config
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Replace with your server's IP address (run `ipconfig` or `ifconfig` to find it)
const char* SERVER_URL    = "http://192.168.1.100:3000";

// Pin Config 
#define DHT_PIN       4
#define DHT_TYPE      DHT22
#define RELAY_PIN     26
// HX711 pins 
// #define LOADCELL_DT   5
// #define LOADCELL_SCK  18

//Intervals 
const unsigned long SENSOR_INTERVAL_MS  = 5000;   // Post sensor data every 5s
const unsigned long COMMAND_INTERVAL_MS = 3000;   // Poll commands every 3s

// Objects 
DHT dht(DHT_PIN, DHT_TYPE);
// HX711 scale;   
// float calibrationFactor = -7050.0;

unsigned long lastSensorPost = 0;
unsigned long lastCommandPoll = 0;

// ── Setup 
void setup() {
  Serial.begin(115200);
  
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);  // Start with dryer OFF
  
  dht.begin();
  
  // Load cell setup 
  // scale.begin(LOADCELL_DT, LOADCELL_SCK);
  // scale.set_scale(calibrationFactor);
  // scale.tare();

  connectWiFi();
}

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
}

// ── Loop
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    return;
  }

  unsigned long now = millis();

  // Post sensor data to server
  if (now - lastSensorPost >= SENSOR_INTERVAL_MS) {
    postSensorData();
    lastSensorPost = now;
  }

  // Poll server for commands (on/off, settings)
  if (now - lastCommandPoll >= COMMAND_INTERVAL_MS) {
    pollCommand();
    lastCommandPoll = now;
  }
}

// Post sensor data 
void postSensorData() {
  float temperature = dht.readTemperature();
  float humidity    = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT read failed, skipping...");
    return;
  }

  // Read weight from load cell 
  // float weight = scale.get_units(5);  // average of 5 readings

  // Build JSON body
  StaticJsonDocument<256> doc;
  doc["temperature"] = temperature;
  doc["humidity"]    = humidity;
  // doc["weight"]   = weight;   

  String body;
  serializeJson(doc, body);

  Serial.printf("📤 Posting: temp=%.1f°C  hum=%.1f%%\n", temperature, humidity);

  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/sensor/data");
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(body);
  if (code == 201) {
    Serial.println("Sensor data posted");
  } else {
    Serial.printf("POST failed (HTTP %d)\n", code);
  }
  http.end();
}

// Poll server for dryer command 
void pollCommand() {
  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/dryer/command");

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    
    StaticJsonDocument<256> doc;
    deserializeJson(doc, payload);
    
    bool dryerOn = doc["command"]["dryerOn"];
    float targetTemp = doc["command"]["targetTemperature"];

    // Control the relay based on server command
    digitalWrite(RELAY_PIN, dryerOn ? HIGH : LOW);

    Serial.printf("Command: dryerOn=%s  targetTemp=%.1f°C\n",
                  dryerOn ? "ON" : "OFF", targetTemp);
  } else {
    Serial.printf("Command poll failed (HTTP %d)\n", code);
  }
  http.end();
}
