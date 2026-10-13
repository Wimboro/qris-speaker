#include <Arduino.h>
#include <WiFi.h>
#include <cstring>

#include "audio.h"
#include "bank.h"
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
static bool touching = false;
static bool screenOn = true;
static bool tapPending = false;
static int pendingX = 0;
static int pendingY = 0;
static uint32_t pendingAt = 0;

static uint8_t savedLight = 100;
static const uint8_t SCREEN_BRIGHT = 200;
static const uint32_t TAP_GAP_MIN = 80;
static const uint32_t TAP_GAP_MAX = 380;
static const uint32_t TAP_DEBOUNCE = 180;

static void applyLight(uint8_t percent) {
  if (percent < 1) percent = 1;
  if (percent > 100) percent = 100;
  savedLight = percent;
  if (screenOn) lcd.setBrightness((uint16_t)savedLight * SCREEN_BRIGHT / 100);
}

static void setScreen(bool on) {
  screenOn = on;
  lcd.setBrightness(on ? (uint16_t)savedLight * SCREEN_BRIGHT / 100 : 0);
}

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
  tapPending = false;
  setScreen(true);
  ledFailed();
  drawResult(false, amount);
  delay(1600);
  enterStatic();
}

static void speakOne(JsonVariant ann) {
  String orderId = ann["order_id"] | "";
  int amount = ann["amount"] | 0;
  int id = ann["id"] | 0;
  bool sameOrder = mode == Mode::Dynamic && orderId == dynOrder;
  bool known = heard(orderId);
  tapPending = false;
  setScreen(true);
  ledPaid();
  drawResult(true, amount);
#if WORD_BANK
  if (!known && speakAmount(amount)) {
    markHeard(orderId);
  } else if (!known) {
#else
  const char* audio = ann["audio_url"] | "";
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
#endif
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
  handleSerial();
  Serial.println("QRIS Speaker");
  lcd.init();
  lcd.setRotation(2);
  setScreen(true);
  uiBegin();
  drawConnecting("Menyiapkan");
  touchBegin();
  handleSerial();
  audioBegin();
  ledBegin();
  loadConfig();
  handleSerial();
  onLevels(audioSetVolume, applyLight);
  audioSetVolume(volumePercent());
  applyLight(lightPercent());
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
    if (down && !touching) {
      uint32_t now = millis();
      if (mode == Mode::StaticQr) {
        uint32_t gap = now - pendingAt;
        if (tapPending && gap >= TAP_GAP_MIN && gap <= TAP_GAP_MAX) {
          tapPending = false;
          setScreen(!screenOn);
        } else if (!tapPending || gap > TAP_GAP_MAX) {
          if (tapPending && screenOn) onTap(pendingX, pendingY);
          pendingX = x;
          pendingY = y;
          pendingAt = now;
          tapPending = true;
        }
      } else if (screenOn && now - pendingAt > TAP_DEBOUNCE) {
        pendingAt = now;
        tapPending = false;
        onTap(x, y);
      }
    }
    touching = down;
    if (mode == Mode::StaticQr && tapPending && millis() - pendingAt > TAP_GAP_MAX) {
      tapPending = false;
      if (screenOn) onTap(pendingX, pendingY);
    }
  }

  if ((mode == Mode::StaticQr || mode == Mode::Dynamic) && millis() - lastPoll > 2000) {
    lastPoll = millis();
    poll();
  }
}
