#pragma once

// LCDWiki ES3C28P: ILI9341 SPI, FT6336 touch, ES8311 codec, WS2812.
static const int PIN_LCD_CS = 10;
static const int PIN_LCD_DC = 46;
static const int PIN_LCD_SCK = 12;
static const int PIN_LCD_MOSI = 11;
static const int PIN_LCD_MISO = 13;
static const int PIN_LCD_BL = 45;

static const int PIN_TOUCH_SDA = 16;
static const int PIN_TOUCH_SCL = 15;
static const int PIN_TOUCH_RST = 18;
static const int PIN_TOUCH_INT = 17;
static const uint8_t TOUCH_ADDR = 0x38;

static const int PIN_I2S_MCLK = 4;
static const int PIN_I2S_BCLK = 5;
static const int PIN_I2S_DOUT = 8;
static const int PIN_I2S_LRCK = 7;
static const int PIN_I2S_DIN = 6;
static const int PIN_AMP_EN = 1;
static const uint8_t ES8311_ADDR = 0x18;

static const int PIN_RGB = 42;

static const int SCREEN_W = 240;
static const int SCREEN_H = 320;
