#include "led.h"

#include <Adafruit_NeoPixel.h>
#include "pins.h"

static Adafruit_NeoPixel pixel(1, PIN_RGB, NEO_GRB + NEO_KHZ800);

static void show(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

void ledBegin() {
  pixel.begin();
  pixel.setBrightness(40);
  ledOff();
}

void ledOff() { show(0, 0, 0); }
void ledWaiting() { show(0, 40, 140); }
void ledPaid() { show(0, 140, 50); }
void ledFailed() { show(160, 24, 16); }
void ledSetup() { show(140, 90, 0); }
