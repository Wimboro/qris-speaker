#pragma once

#include <Arduino.h>

void audioBegin();
void audioSetVolume(uint8_t percent);
bool playWav(const uint8_t* data, size_t len);
bool playWavs(const uint8_t* const* clips, const size_t* lengths, size_t count);
