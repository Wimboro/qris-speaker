#include "audio.h"

#include <cstring>
#include <driver/i2s.h>
#include <Wire.h>
#include "pins.h"

static const uint8_t REG_RESET = 0x00;
static const uint8_t REG_CLK1 = 0x01;
static const uint8_t REG_CLK2 = 0x02;
static const uint8_t REG_CLK3 = 0x03;
static const uint8_t REG_CLK4 = 0x04;
static const uint8_t REG_CLK5 = 0x05;
static const uint8_t REG_CLK6 = 0x06;
static const uint8_t REG_CLK7 = 0x07;
static const uint8_t REG_CLK8 = 0x08;
static const uint8_t REG_SDPIN = 0x09;
static const uint8_t REG_SDPOUT = 0x0A;
static const uint8_t REG_SYS0D = 0x0D;
static const uint8_t REG_SYS0E = 0x0E;
static const uint8_t REG_SYS12 = 0x12;
static const uint8_t REG_SYS13 = 0x13;
static const uint8_t REG_DAC31 = 0x31;
static const uint8_t REG_DAC32 = 0x32;
static const uint8_t REG_DAC37 = 0x37;

static bool i2sReady = false;
static uint8_t volumeReg = 0xD8;

static void writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ES8311_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

void audioSetVolume(uint8_t percent) {
  if (percent > 100) percent = 100;
  // 0 bisu. 1..100 = 0xBF (0 dB) .. 0xD8 (+12.5 dB), 0.5 dB per langkah.
  volumeReg = percent == 0 ? 0 : 0xBF + (uint16_t)percent * (0xD8 - 0xBF) / 100;
  writeReg(REG_DAC32, volumeReg);
}

static void codecOn() {
  digitalWrite(PIN_AMP_EN, LOW);
  writeReg(REG_RESET, 0x1F);
  delay(20);
  writeReg(REG_RESET, 0x00);
  writeReg(REG_RESET, 0x80);
  writeReg(REG_CLK1, 0x3F);
  // 16 kHz, MCLK = 256 * fs = 4.096 MHz. Coeff ES8311: pre_div 1, dac_osr 0x20, lrck 0x00FF, bclk_div 4.
  writeReg(REG_CLK2, 0x00);
  writeReg(REG_CLK3, 0x10);
  writeReg(REG_CLK4, 0x20);
  writeReg(REG_CLK5, 0x00);
  writeReg(REG_CLK6, 0x03);
  writeReg(REG_CLK7, 0x00);
  writeReg(REG_CLK8, 0xFF);
  writeReg(REG_SDPIN, 0x0C);
  writeReg(REG_SDPOUT, 0x0C);
  writeReg(REG_SYS0D, 0x01);
  writeReg(REG_SYS0E, 0x02);
  writeReg(REG_SYS12, 0x00);
  writeReg(REG_SYS13, 0x10);
  writeReg(REG_DAC37, 0x08);
  writeReg(REG_DAC31, 0x00);
  writeReg(REG_DAC32, volumeReg);
}

static void codecOff() {
  writeReg(REG_SYS0D, 0xFC);
  writeReg(REG_RESET, 0x00);
  digitalWrite(PIN_AMP_EN, HIGH);
}

struct WavPcm {
  const uint8_t* pcm;
  size_t frames;
  int channels;
  int rate;
};

static bool parseWav(const uint8_t* data, size_t len, WavPcm& out) {
  if (len < 44) return false;
  if (memcmp(data, "RIFF", 4) != 0 || memcmp(data + 8, "WAVE", 4) != 0) return false;
  size_t off = 12;
  const uint8_t* pcm = nullptr;
  size_t pcmBytes = 0;
  int channels = 1;
  int rate = 16000;
  int bits = 16;
  while (off + 8 <= len) {
    uint32_t size = (uint32_t)data[off + 4] | ((uint32_t)data[off + 5] << 8) |
                    ((uint32_t)data[off + 6] << 16) | ((uint32_t)data[off + 7] << 24);
    const uint8_t* body = data + off + 8;
    if (off + 8 + size > len) break;
    if (memcmp(data + off, "fmt ", 4) == 0 && size >= 16) {
      channels = body[2] | (body[3] << 8);
      rate = (int)((uint32_t)body[4] | ((uint32_t)body[5] << 8) |
                   ((uint32_t)body[6] << 16) | ((uint32_t)body[7] << 24));
      bits = body[14] | (body[15] << 8);
    } else if (memcmp(data + off, "data", 4) == 0) {
      pcm = body;
      pcmBytes = size;
    }
    off += 8 + size + (size & 1);
  }
  if (!pcm || bits != 16 || channels < 1 || rate < 8000) return false;
  out.pcm = pcm;
  out.frames = pcmBytes / (size_t)(2 * channels);
  out.channels = channels;
  out.rate = rate;
  return out.frames > 0;
}

static int16_t sampleAt(const WavPcm& wav, size_t frame) {
  int16_t sample = 0;
  memcpy(&sample, wav.pcm + frame * (size_t)wav.channels * 2, 2);
  return sample;
}

static void writeWav(const WavPcm& wav) {
  int16_t chunk[256];
  size_t frame = 0;
  while (frame < wav.frames) {
    size_t count = wav.frames - frame;
    if (count > 128) count = 128;
    for (size_t i = 0; i < count; i++) {
      int16_t sample = sampleAt(wav, frame + i);
      chunk[i * 2] = sample;
      chunk[i * 2 + 1] = sample;
    }
    size_t written = 0;
    i2s_write(I2S_NUM_0, chunk, count * 4, &written, portMAX_DELAY);
    frame += count;
  }
}

void audioBegin() {
  pinMode(PIN_AMP_EN, OUTPUT);
  digitalWrite(PIN_AMP_EN, HIGH);

  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = 16000;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 6;
  cfg.dma_buf_len = 256;
  cfg.use_apll = false;
  cfg.tx_desc_auto_clear = true;
  cfg.fixed_mclk = 16000 * 256;
  cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;

  i2s_pin_config_t pins = {};
  pins.mck_io_num = PIN_I2S_MCLK;
  pins.bck_io_num = PIN_I2S_BCLK;
  pins.ws_io_num = PIN_I2S_LRCK;
  pins.data_out_num = PIN_I2S_DOUT;
  pins.data_in_num = PIN_I2S_DIN;

  i2sReady = i2s_driver_install(I2S_NUM_0, &cfg, 0, nullptr) == ESP_OK &&
             i2s_set_pin(I2S_NUM_0, &pins) == ESP_OK;
  if (i2sReady) i2s_stop(I2S_NUM_0);
}

bool playWavs(const uint8_t* const* clips, const size_t* lengths, size_t count) {
  if (!i2sReady || count == 0) return false;
  WavPcm first;
  if (!parseWav(clips[0], lengths[0], first)) return false;
  codecOn();
  i2s_set_clk(I2S_NUM_0, first.rate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_STEREO);
  i2s_zero_dma_buffer(I2S_NUM_0);
  i2s_start(I2S_NUM_0);
  bool ok = true;
  for (size_t i = 0; i < count; i++) {
    WavPcm wav = first;
    if (i > 0 && !parseWav(clips[i], lengths[i], wav)) {
      ok = false;
      break;
    }
    if (wav.rate != first.rate) {
      i2s_set_clk(I2S_NUM_0, wav.rate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_STEREO);
    }
    writeWav(wav);
  }
  i2s_zero_dma_buffer(I2S_NUM_0);
  delay(60);
  i2s_stop(I2S_NUM_0);
  codecOff();
  return ok;
}

bool playWav(const uint8_t* data, size_t len) {
  return playWavs(&data, &len, 1);
}
