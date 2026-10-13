#include <Arduino.h>
#include <WiFi.h>
#include <cstring>

#include "audio.h"
#include "display.h"
#include "led.h"
#include "net.h"
#include "touch.h"
#include "ui.h"

enum class Mode { Setup, StaticQr, Keypad, Dynamic };

static Mode mode = Mode::Setup;
static String digits;
static String staticQr;
static String dynQr;
static String dynOrder;
static int dynAmount = 0;
static uint32_t lastPoll = 0;
static uint32_t lastTap = 0;
static bool touching = false;

static void enterStatic() {
  mode = Mode::StaticQr;
  ledOff();
  drawStatic(staticQr, wifiUp());
  lastPoll = millis();
}

static void enterKeypad() {
  mode = Mode::Keypad;
  digits = "";
  ledOff();
  drawKeypad(digits);
}

static void enterDynamic() {
  mode = Mode::Dynamic;
  ledWaiting();
  drawDynamic(dynQr, dynAmount);
  lastPoll = millis();
}

static void showFailure(int amount) {
  ledFailed();
  drawResult(false, amount);
  delay(1600);
  enterStatic();
}

static void speakOne(JsonVariant ann) {
  String orderId = ann["order_id"] | "";
  int amount = ann["amount"] | 0;
  int id = ann["id"] | 0;
  const char* audio = ann["audio_url"] | "";
  bool sameOrder = mode == Mode::Dynamic && orderId == dynOrder;
  bool known = heard(orderId);
  ledPaid();
  drawResult(true, amount);
  if (!known && audio && audio[0]) {
    size_t len = 0;
    uint8_t* wav = fetchAudio(audio, &len);
    if (wav) {
      playWav(wav, len);
      free(wav);
    } else {
      delay(1200);
    }
    markHeard(orderId);
  } else if (!known) {
    delay(1200);
    markHeard(orderId);
  }
  if (id) ackAnnouncement(id);
  if (sameOrder || mode != Mode::Dynamic) enterStatic();
  else enterDynamic();
}

static void poll() {
  if (!wifiUp()) return;
  JsonDocument doc;
  String watch = mode == Mode::Dynamic ? dynOrder : "";
  if (!fetchEvents(watch, doc)) return;
  JsonArray announcements = doc["announcements"].as<JsonArray>();
  if (!announcements.isNull() && announcements.size() > 0) {
    speakOne(announcements[0]);
    return;
  }
  if (mode != Mode::Dynamic) return;
  const char* status = doc["order"]["status"] | "";
  if (strcmp(status, "expire") == 0 || strcmp(status, "cancel") == 0 || strcmp(status, "deny") == 0) {
    showFailure(dynAmount);
  }
}

static void requestCharge() {
  int amount = digits.toInt();
  if (amount < 1) return;
  drawConnecting("Meminta QR");
  String error;
  if (!createCharge(amount, dynOrder, dynQr, error)) {
    Serial.println(error);
    showFailure(amount);
    return;
  }
  dynAmount = amount;
  enterDynamic();
}

static void onTap(int x, int y) {
  int id = hitButtons(x, y);
  if (id < 0) return;
  if (mode == Mode::StaticQr && id == 1) {
    enterKeypad();
    return;
  }
  if (mode == Mode::Dynamic && id == 12) {
    enterStatic();
    return;
  }
  if (mode != Mode::Keypad) return;
  if (id <= 9) {
    if (digits.length() >= 8) return;
    if (digits == "0") digits = "";
    digits += char('0' + id);
    drawKeypad(digits);
  } else if (id == 10) {
    digits = "";
    drawKeypad(digits);
  } else if (id == 11) {
    if (digits.length()) digits.remove(digits.length() - 1);
    drawKeypad(digits);
  } else if (id == 12) {
    enterStatic();
  } else if (id == 13) {
    requestCharge();
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("QRIS Speaker");
  lcd.init();
  lcd.setRotation(0);
  lcd.setBrightness(200);
  uiBegin();
  drawConnecting("Menyiapkan");
  touchBegin();
  audioBegin();
  ledBegin();
  loadConfig();
  if (!configReady()) {
    startPortal();
    ledSetup();
    drawSetup("");
    mode = Mode::Setup;
    return;
  }
  drawConnecting("Menyambung Wi-Fi");
  if (!connectWifi()) {
    startPortal();
    ledSetup();
    drawSetup("Wi-Fi gagal");
    mode = Mode::Setup;
    return;
  }
  drawConnecting("Mengambil QR statis");
  if (!fetchConfig(staticQr)) Serial.println("Gagal mengambil konfigurasi");
  enterStatic();
}

void loop() {
  handleSerial();
  if (mode == Mode::Setup) {
    portalLoop();
    delay(5);
    return;
  }

  if (touchReady()) {
    int x = 0;
    int y = 0;
    bool down = readTouch(x, y);
    if (down && !touching && millis() - lastTap > 180) {
      lastTap = millis();
      onTap(x, y);
    }
    touching = down;
  }

  if ((mode == Mode::StaticQr || mode == Mode::Dynamic) && millis() - lastPoll > 2000) {
    lastPoll = millis();
    poll();
  }
}
