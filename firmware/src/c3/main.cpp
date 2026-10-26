#include <Arduino.h>

#include "audio.h"
#include "bank.h"
#include "display.h"
#include "net.h"

static uint32_t lastPoll = 0;
static bool setupMode = false;
static bool wasUp = false;

static String rupiah(int amount) {
  String digits = String(amount);
  String out = "Rp ";
  int n = digits.length();
  for (int i = 0; i < n; i++) {
    if (i > 0 && (n - i) % 3 == 0) out += '.';
    out += digits[i];
  }
  return out;
}

static void showIdle() {
  displayStatus(wifiUp() ? "Siap" : "Wi-Fi putus", "");
}

static void speakOne(JsonVariant ann) {
  String orderId = ann["order_id"] | "";
  int amount = ann["amount"] | 0;
  int id = ann["id"] | 0;
  if (heard(orderId)) {
    if (id) ackAnnouncement(id);
    return;
  }
  String shown = rupiah(amount);
  displayStatus("Lunas", shown.c_str(), true);
  if (!speakAmount(amount) || volumePercent() == 0) delay(1200);
  markHeard(orderId);
  if (id) ackAnnouncement(id);
  showIdle();
}

static void poll() {
  if (!wifiUp()) return;
  JsonDocument doc;
  if (!fetchEvents("", doc)) return;
  JsonArray announcements = doc["announcements"].as<JsonArray>();
  if (announcements.isNull() || announcements.size() == 0) return;
  speakOne(announcements[0]);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  handleSerial();
  Serial.println("QRIS Speaker C3");
  loadConfig();
  handleSerial();
  onLevels(audioSetVolume, displayContrast);
  if (!configReady()) {
    bool portal = startPortal();
    displayBegin();
    displayContrast(lightPercent());
    displayStatus(portal ? "qris-speaker" : "Wi-Fi gagal", portal ? "192.168.4.1" : "");
    audioBegin();
    audioSetVolume(volumePercent());
    setupMode = true;
    return;
  }
  displayBegin();
  displayStatus("Menyiapkan", "");
  displayContrast(lightPercent());
  audioBegin();
  audioSetVolume(volumePercent());
  displayStatus("Wi-Fi", "Menyambung");
  if (!connectWifi()) {
    bool portal = startPortal();
    displayStatus(portal ? "qris-speaker" : "Wi-Fi gagal", portal ? "192.168.4.1" : "");
    setupMode = true;
    return;
  }
  wasUp = true;
  showIdle();
  lastPoll = millis();
}

void loop() {
  handleSerial();
  if (setupMode) {
    portalLoop();
    delay(5);
    return;
  }
  bool up = wifiUp();
  if (up != wasUp) {
    wasUp = up;
    showIdle();
  }
  if (up && millis() - lastPoll > 2000) {
    lastPoll = millis();
    poll();
  }
}
