#pragma once

#include <Arduino.h>

void audioBegin();
bool playWav(const uint8_t* data, size_t len);
