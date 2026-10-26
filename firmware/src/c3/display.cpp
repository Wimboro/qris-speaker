#include "display.h"

#include "pins.h"

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>
#include <cstring>

static Adafruit_SSD1306 oled(128, 32, &Wire, -1);
static bool ready = false;

static void drawLine(const char* text, int y, int size) {
  int len = (int)strlen(text);
  int w = len * 6 * size;
  int x = (128 - w) / 2;
  if (x < 0) x = 0;
  oled.setTextSize(size);
  oled.setCursor(x, y);
  oled.print(text);
}

void displayBegin() {
  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  ready = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (!ready) return;
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextWrap(false);
  oled.clearDisplay();
  oled.display();
}

void displayContrast(uint8_t percent) {
  if (!ready) return;
  if (percent < 1) percent = 1;
  if (percent > 100) percent = 100;
  oled.ssd1306_command(SSD1306_SETCONTRAST);
  oled.ssd1306_command((uint8_t)((uint16_t)percent * 255 / 100));
}

void displayStatus(const char* status, const char* detail, bool invert) {
  if (!ready) return;
  if (!status) status = "";
  if (!detail) detail = "";
  int detailSize = (strlen(detail) > 0 && strlen(detail) * 12 <= 128) ? 2 : 1;
  oled.invertDisplay(invert);
  oled.clearDisplay();
  drawLine(status, 0, 1);
  drawLine(detail, 16, detailSize);
  oled.display();
}
