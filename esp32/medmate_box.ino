/*
  MedMate smart pill box: ESP32 sketch
  ------------------------------------
  Wiring (4 compartments):
    Reed switch + magnet on each lid: one leg to a GPIO below, other leg to GND (internal pull-up used).
    Green LED -> GPIO 25 (+ resistor), Amber LED -> GPIO 26, Red LED -> GPIO 27, Buzzer -> GPIO 14.
  Fill in WIFI_SSID, WIFI_PASS, SERVER (your computer's local IP and port) and PATIENT_CODE
  (shown in the app under Care Circle, for example MM-DEMO).
  Board: "ESP32 Dev Module". Libraries: none beyond the ESP32 core (WiFi, HTTPClient).
*/
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* SERVER = "http://192.168.1.10:3000";   // run `npm start` on this computer
const char* PATIENT_CODE = "MM-DEMO";

const int LID_PINS[4] = {32, 33, 34, 35};          // reed switches (closed lid = LOW)
const int LED_G = 25, LED_A = 26, LED_R = 27, BUZZER = 14;
bool wasOpen[4] = {false, false, false, false};

void beep(int ms) { digitalWrite(BUZZER, HIGH); delay(ms); digitalWrite(BUZZER, LOW); }

void showLed(const String& color) {
  digitalWrite(LED_G, color == "green"); digitalWrite(LED_A, color == "amber"); digitalWrite(LED_R, color == "red");
  delay(2500);
  digitalWrite(LED_G, LOW); digitalWrite(LED_A, LOW); digitalWrite(LED_R, LOW);
}

void sendLidEvent(int slot) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(String(SERVER) + "/api/device/event");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST("{\"code\":\"" + String(PATIENT_CODE) + "\",\"slot\":" + String(slot) + "}");
  String body = http.getString();
  http.end();
  if (code != 200) { showLed("red"); return; }
  if (body.indexOf("\"green\"") > 0) { beep(120); showLed("green"); }
  else if (body.indexOf("\"amber\"") > 0) { beep(400); showLed("amber"); }
  else showLed("red");
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) pinMode(LID_PINS[i], INPUT_PULLUP);   // note: GPIO 34/35 are input-only and have no pull-up, add 10k resistors to 3.3V
  pinMode(LED_G, OUTPUT); pinMode(LED_A, OUTPUT); pinMode(LED_R, OUTPUT); pinMode(BUZZER, OUTPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.println("\nConnected: " + WiFi.localIP().toString());
  beep(80);
}

void loop() {
  for (int i = 0; i < 4; i++) {
    bool open = digitalRead(LID_PINS[i]) == HIGH;      // magnet away = lid open
    if (open && !wasOpen[i]) { Serial.printf("Lid %d opened\n", i + 1); sendLidEvent(i + 1); }
    wasOpen[i] = open;
  }
  delay(60);
}
