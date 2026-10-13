#include "ui.h"

#pragma push_macro("LOW")
#pragma push_macro("HIGH")
#undef LOW
#undef HIGH
#include <qrcodegen.hpp>
#pragma pop_macro("HIGH")
#pragma pop_macro("LOW")

#include "display.h"
#include "pins.h"

static uint16_t colBg;
static uint16_t colCream;
static uint16_t colInk;
static uint16_t colAccent;
static uint16_t colDanger;
static uint16_t colOk;

extern const uint8_t qris_bg_start[] asm("_binary_src_qris_bg_png_start");
extern const uint8_t qris_bg_end[] asm("_binary_src_qris_bg_png_end");

struct Btn {
  int x;
  int y;
  int w;
  int h;
  int id;
};

static Btn buttons[16];
static int buttonCount = 0;

void uiBegin() {
  colBg = lcd.color565(255, 255, 255);
  colCream = lcd.color565(255, 255, 255);
  colInk = lcd.color565(32, 32, 32);
  colAccent = lcd.color565(0xD8, 0x3E, 0x3C);
  colDanger = colAccent;
  colOk = lcd.color565(22, 110, 64);
}

static String formatRupiah(int amount) {
  String digits = String(amount);
  String out;
  int n = digits.length();
  for (int i = 0; i < n; i++) {
    if (i > 0 && (n - i) % 3 == 0) out += '.';
    out += digits[i];
  }
  return out;
}

static void addButton(int x, int y, int w, int h, const char* label, int id, uint16_t fill) {
  if (buttonCount >= 16) return;
  buttons[buttonCount++] = {x, y, w, h, id};
  bool solid = fill == colAccent;
  uint16_t face = solid ? colAccent : colBg;
  uint16_t text = solid ? colCream : colInk;
  lcd.fillRoundRect(x, y, w, h, 8, face);
  if (!solid) lcd.drawRoundRect(x, y, w, h, 8, colAccent);
  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(text, face);
  lcd.setTextDatum(textdatum_t::middle_center);
  lcd.drawString(label, x + w / 2, y + h / 2 + 1);
}

int hitButtons(int x, int y) {
  for (int i = 0; i < buttonCount; i++) {
    const Btn& b = buttons[i];
    if (x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h) return b.id;
  }
  return -1;
}

static bool paintModules(const qrcodegen::QrCode& qr, int x0, int y0, int side) {
  int n = qr.getSize();
  if (n < 1 || side < n) return false;
  lcd.fillRect(x0, y0, side, side, colCream);
  lcd.startWrite();
  for (int y = 0; y < n; y++) {
    int py = y0 + (y * side) / n;
    int ph = y0 + ((y + 1) * side) / n - py;
    for (int x = 0; x < n; x++) {
      if (!qr.getModule(x, y)) continue;
      int px = x0 + (x * side) / n;
      int pw = x0 + ((x + 1) * side) / n - px;
      lcd.fillRect(px, py, pw, ph, colInk);
    }
  }
  lcd.endWrite();
  return true;
}

static void paintQr(const String& text, int boxX, int boxY, int box) {
  if (!text.length()) {
    lcd.setFont(&fonts::Font2);
    lcd.setTextColor(colInk, colBg);
    lcd.setTextDatum(textdatum_t::middle_center);
    lcd.drawString("QR statis kosong", boxX + box / 2, boxY + box / 2);
    return;
  }
  bool painted = false;
  try {
    painted = paintModules(
        qrcodegen::QrCode::encodeText(text.c_str(), qrcodegen::QrCode::Ecc::MEDIUM),
        boxX,
        boxY,
        box);
  } catch (...) {
    painted = false;
  }
  if (painted) return;
  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(colInk, colBg);
  lcd.setTextDatum(textdatum_t::top_left);
  lcd.drawString("QR gagal digambar", boxX, boxY);
}

static void drawPoster() {
  lcd.drawPng(qris_bg_start, (uint32_t)(qris_bg_end - qris_bg_start), 0, 0);
}

void drawSetup(const char* note) {
  buttonCount = 0;
  lcd.fillScreen(colBg);
  lcd.setTextColor(colAccent, colBg);
  lcd.setTextDatum(textdatum_t::top_left);
  lcd.setFont(&fonts::Font4);
  lcd.drawString("Atur speaker", 12, 12);
  lcd.setTextColor(colInk, colBg);
  lcd.setFont(&fonts::Font2);
  int y = 58;
  if (note && note[0]) {
    lcd.drawString(note, 12, y);
    y += 28;
  }
  lcd.drawString("Wi-Fi: qris-speaker", 12, y);
  y += 24;
  lcd.drawString("Browser: 192.168.4.1", 12, y);
  y += 36;
  lcd.drawString("Serial 115200:", 12, y);
  y += 24;
  lcd.drawString("WIFI=nama", 12, y);
  y += 22;
  lcd.drawString("PASS=sandi", 12, y);
  y += 22;
  lcd.drawString("HOST=https://server", 12, y);
  y += 22;
  lcd.drawString("TOKEN=rahasia", 12, y);
  y += 22;
  lcd.drawString("APPLY", 12, y);
}

void drawConnecting(const char* line) {
  buttonCount = 0;
  lcd.fillScreen(colBg);
  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(colInk, colBg);
  lcd.setTextDatum(textdatum_t::middle_center);
  lcd.drawString(line, SCREEN_W / 2, SCREEN_H / 2);
}

void drawStatic(const String& qr, bool wifi) {
  (void)wifi;
  buttonCount = 0;
  drawPoster();
  paintQr(qr, 32, 69, 176);
  addButton(8, 276, 224, 40, "NOMINAL", 1, colAccent);
}

void drawKeypad(const String& digits) {
  buttonCount = 0;
  lcd.fillScreen(colBg);
  lcd.setTextColor(colAccent, colBg);
  lcd.setTextDatum(textdatum_t::top_left);
  lcd.setFont(&fonts::Font2);
  lcd.drawString("Nominal", 10, 6);
  lcd.setTextColor(colInk, colBg);
  lcd.setFont(&fonts::Font4);
  int amount = digits.length() ? digits.toInt() : 0;
  String shown = "Rp " + formatRupiah(amount);
  lcd.drawString(shown.c_str(), 10, 28);

  const char* labels[12] = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"};
  const int ids[12] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 11};
  const int gap = 6;
  const int w = 70;
  const int h = 40;
  const int y0 = 88;
  for (int i = 0; i < 12; i++) {
    int col = i % 3;
    int row = i / 3;
    addButton(8 + col * (w + gap), y0 + row * (h + gap), w, h, labels[i], ids[i], colBg);
  }
  int yb = y0 + 4 * (h + gap);
  int hw = (SCREEN_W - 16 - gap) / 2;
  addButton(8, yb, hw, h, "BATAL", 12, colBg);
  addButton(8 + hw + gap, yb, hw, h, "BAYAR", 13, colAccent);
}

void drawDynamic(const String& qr, int amount) {
  buttonCount = 0;
  drawPoster();
  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(colAccent, colBg);
  lcd.setTextDatum(textdatum_t::top_left);
  String shown = "Rp " + formatRupiah(amount);
  lcd.drawString(shown.c_str(), 8, 2);
  paintQr(qr, 32, 69, 176);
  addButton(8, 276, 224, 40, "BATAL", 12, colBg);
}

void drawResult(bool success, int amount) {
  buttonCount = 0;
  uint16_t fill = success ? colOk : colDanger;
  lcd.fillScreen(fill);
  lcd.setTextColor(colCream, fill);
  lcd.setTextDatum(textdatum_t::middle_center);
  lcd.setFont(&fonts::Font4);
  lcd.drawString(success ? "Lunas" : "Gagal", SCREEN_W / 2, 120);
  String shown = "Rp " + formatRupiah(amount);
  lcd.drawString(shown.c_str(), SCREEN_W / 2, 168);
}
