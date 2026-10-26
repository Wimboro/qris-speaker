#include "audio.h"

#include "pins.h"

#include <cstring>
#include <driver/i2s.h>

static bool i2sReady = false;
static uint8_t volumePct = 100;

void audioSetVolume(uint8_t percent) {
  if (percent > 100) percent = 100;
  volumePct = percent;
}

static void amp(bool on) {
  digitalWrite(PIN_AMP_SD, on ? HIGH : LOW);
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
  return (int16_t)((int32_t)sample * volumePct / 100);
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
  pinMode(PIN_AMP_SD, OUTPUT);
  amp(false);

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
  cfg.fixed_mclk = 0;

  i2s_pin_config_t pins = {};
  pins.mck_io_num = -1;
  pins.bck_io_num = PIN_I2S_BCLK;
  pins.ws_io_num = PIN_I2S_LRCK;
  pins.data_out_num = PIN_I2S_DOUT;
  pins.data_in_num = -1;

  i2sReady = i2s_driver_install(I2S_NUM_0, &cfg, 0, nullptr) == ESP_OK &&
             i2s_set_pin(I2S_NUM_0, &pins) == ESP_OK;
  if (i2sReady) i2s_stop(I2S_NUM_0);
}

bool playWavs(const uint8_t* const* clips, const size_t* lengths, size_t count) {
  if (!i2sReady || count == 0) return false;
  if (volumePct == 0) return true;
  WavPcm first;
  if (!parseWav(clips[0], lengths[0], first)) return false;
  i2s_set_clk(I2S_NUM_0, first.rate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_STEREO);
  i2s_zero_dma_buffer(I2S_NUM_0);
  i2s_start(I2S_NUM_0);
  amp(true);
  delay(10);
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
  amp(false);
  return ok;
}

bool playWav(const uint8_t* data, size_t len) {
  return playWavs(&data, &len, 1);
}
