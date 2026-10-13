#include "touch.h"

#include <Wire.h>
#include "pins.h"

static bool ready = false;

static uint8_t readReg(uint8_t reg) {
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom(TOUCH_ADDR, (uint8_t)1) != 1) return 0;
  return Wire.read();
}

bool touchBegin() {
  pinMode(PIN_TOUCH_RST, OUTPUT);
  digitalWrite(PIN_TOUCH_RST, LOW);
  delay(10);
  digitalWrite(PIN_TOUCH_RST, HIGH);
  delay(300);
  pinMode(PIN_TOUCH_INT, INPUT);
  Wire.begin(PIN_TOUCH_SDA, PIN_TOUCH_SCL);
  Wire.beginTransmission(TOUCH_ADDR);
  ready = Wire.endTransmission() == 0;
  return ready;
}

bool touchReady() { return ready; }

bool readTouch(int& x, int& y) {
  if (!ready) return false;
  uint8_t points = readReg(0x02) & 0x0F;
  if (points == 0 || points > 2) return false;
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(0x03);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(TOUCH_ADDR, (uint8_t)4) != 4) return false;
  uint8_t data[4];
  for (int i = 0; i < 4; i++) data[i] = Wire.read();
  x = ((data[0] & 0x0F) << 8) | data[1];
  y = ((data[2] & 0x0F) << 8) | data[3];
  if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) return false;
  return true;
}
