#pragma once

#include <Arduino.h>

void uiBegin();
void drawSetup(const char* note);
void drawConnecting(const char* line);
void drawStatic(const String& qr, bool wifi);
void drawKeypad(const String& digits);
void drawDynamic(const String& qr, int amount);
void drawResult(bool success, int amount);
int hitButtons(int x, int y);
