#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

bool configReady();
void loadConfig();
void onLevels(void (*volume)(uint8_t), void (*light)(uint8_t));
uint8_t volumePercent();
uint8_t lightPercent();
void handleSerial();
bool startPortal();
void portalLoop();
bool portalActive();
bool connectWifi();
bool wifiUp();

bool fetchConfig(String& staticQr);
bool createCharge(int amount, String& orderId, String& qr, String& error);
bool fetchEvents(const String& orderId, JsonDocument& doc);
uint8_t* fetchAudio(const String& path, size_t* outLen);
bool ackAnnouncement(int id);
bool heard(const String& orderId);
void markHeard(const String& orderId);
