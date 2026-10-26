#pragma once

#include <Arduino.h>

void displayBegin();
void displayContrast(uint8_t percent);
void displayStatus(const char* status, const char* detail, bool invert = false);
