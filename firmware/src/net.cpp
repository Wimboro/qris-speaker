#include "net.h"

#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>

static Preferences prefs;
static WebServer server(80);
static String cfgSsid;
static String cfgPass;
static String cfgHost;
static String cfgToken;
static uint8_t cfgVol = 100;
static uint8_t cfgLight = 100;
static void (*levelVolume)(uint8_t) = nullptr;
static void (*levelLight)(uint8_t) = nullptr;
static bool apOn = false;
static String serialLine;

static const char PORTAL_HTML[] PROGMEM = R"HTML(
<!DOCTYPE html>
<html lang="id">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QRIS Speaker</title>
<style>
body { font: 16px/1.4 sans-serif; background: #102018; color: #f4f1e8; margin: 0; padding: 24px; }
h1 { font-size: 22px; margin: 0 0 8px; }
p { margin: 0 0 16px; color: #d5d0c4; }
label { display: block; margin: 14px 0 6px; }
input { width: 100%; box-sizing: border-box; padding: 12px; font-size: 16px; border: 0; }
button { margin-top: 18px; width: 100%; padding: 14px; font-size: 16px; background: #f2c14e; border: 0; }
</style>
<h1>QRIS Speaker</h1>
<p>Isi Wi-Fi toko dan alamat server.</p>
<form method="POST" action="/save">
<label>Nama Wi-Fi</label>
<input name="ssid" required autocomplete="off">
<label>Sandi Wi-Fi</label>
<input name="pass" type="password" autocomplete="off">
<label>Alamat server</label>
<input name="host" required placeholder="https://toko.example.com" autocomplete="off">
<label>Token perangkat</label>
<input name="token" required autocomplete="off">
<button type="submit">Simpan</button>
</form>
)HTML";

static void remember(const char* key, const String& value) {
  prefs.putString(key, value);
}

static void trimHost(String& host) {
  host.trim();
  while (host.endsWith("/")) host.remove(host.length() - 1);
}

static bool hostOk(const String& host) {
  return host.startsWith("http://") || host.startsWith("https://");
}

static void saveAll() {
  remember("ssid", cfgSsid);
  remember("pass", cfgPass);
  remember("host", cfgHost);
  remember("token", cfgToken);
}

void loadConfig() {
  prefs.begin("qris", false);
  cfgSsid = prefs.getString("ssid", "");
  cfgPass = prefs.getString("pass", "");
  cfgHost = prefs.getString("host", "");
  cfgToken = prefs.getString("token", "");
  cfgVol = prefs.getUChar("vol", 100);
  cfgLight = prefs.getUChar("light", 100);
  if (cfgVol > 100) cfgVol = 100;
  if (cfgLight < 1 || cfgLight > 100) cfgLight = 100;
  trimHost(cfgHost);
}

void onLevels(void (*volume)(uint8_t), void (*light)(uint8_t)) {
  levelVolume = volume;
  levelLight = light;
}

uint8_t volumePercent() { return cfgVol; }
uint8_t lightPercent() { return cfgLight; }

static uint8_t clampLevel(int value, uint8_t low) {
  if (value < low) return low;
  if (value > 100) return 100;
  return (uint8_t)value;
}

bool configReady() {
  return cfgSsid.length() > 0 && hostOk(cfgHost) && cfgToken.length() > 0;
}

static void applyLine(String line) {
  line.trim();
  if (line.startsWith("WIFI=")) {
    cfgSsid = line.substring(5);
    cfgSsid.trim();
    remember("ssid", cfgSsid);
    Serial.println("OK WIFI");
  } else if (line.startsWith("PASS=")) {
    cfgPass = line.substring(5);
    remember("pass", cfgPass);
    Serial.println("OK PASS");
  } else if (line.startsWith("HOST=")) {
    cfgHost = line.substring(5);
    trimHost(cfgHost);
    remember("host", cfgHost);
    Serial.println(hostOk(cfgHost) ? "OK HOST" : "HOST harus http:// atau https://");
  } else if (line.startsWith("TOKEN=")) {
    cfgToken = line.substring(6);
    cfgToken.trim();
    remember("token", cfgToken);
    Serial.println("OK TOKEN");
  } else if (line == "APPLY") {
    if (!configReady()) {
      Serial.println("Belum lengkap");
      return;
    }
    Serial.println("Menyala ulang");
    delay(200);
    ESP.restart();
  } else if (line.startsWith("VOL=")) {
    cfgVol = clampLevel(line.substring(4).toInt(), 0);
    prefs.putUChar("vol", cfgVol);
    if (levelVolume) levelVolume(cfgVol);
    Serial.println("OK VOL");
  } else if (line.startsWith("LIGHT=")) {
    cfgLight = clampLevel(line.substring(6).toInt(), 1);
    prefs.putUChar("light", cfgLight);
    if (levelLight) levelLight(cfgLight);
    Serial.println("OK LIGHT");
  } else if (line == "STATUS") {
    Serial.printf("ssid %s\nhost %s\ntoken %s\nwifi %s\nvol %u\nlight %u\nEND\n",
                  cfgSsid.c_str(),
                  cfgHost.c_str(),
                  cfgToken.length() ? "ada" : "kosong",
                  wifiUp() ? "nyambung" : "putus",
                  cfgVol,
                  cfgLight);
  }
}

void handleSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLine.length()) applyLine(serialLine);
      serialLine = "";
    } else if (serialLine.length() < 240) {
      serialLine += c;
    }
  }
}

static void handleSave() {
  String ssid = server.arg("ssid");
  String pass = server.arg("pass");
  String host = server.arg("host");
  String token = server.arg("token");
  ssid.trim();
  token.trim();
  trimHost(host);
  if (!ssid.length() || !hostOk(host) || !token.length()) {
    server.send(400, "text/plain", "Nama Wi-Fi, alamat http(s), dan token wajib diisi.");
    return;
  }
  cfgSsid = ssid;
  cfgPass = pass;
  cfgHost = host;
  cfgToken = token;
  saveAll();
  server.send(200, "text/plain", "Tersimpan. Perangkat menyala ulang.");
  delay(400);
  ESP.restart();
}

void startPortal() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP);
  WiFi.softAP("qris-speaker");
  server.on("/", HTTP_GET, []() { server.send_P(200, "text/html", PORTAL_HTML); });
  server.on("/save", HTTP_POST, handleSave);
  server.onNotFound([]() {
    server.sendHeader("Location", "http://192.168.4.1/", true);
    server.send(302, "text/plain", "");
  });
  server.begin();
  apOn = true;
  Serial.println("Portal http://192.168.4.1  SSID qris-speaker");
}

void portalLoop() {
  if (apOn) server.handleClient();
}

bool portalActive() { return apOn; }

bool connectWifi() {
  if (apOn) {
    server.stop();
    apOn = false;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    handleSerial();
    delay(50);
  }
  return WiFi.status() == WL_CONNECTED;
}

bool wifiUp() { return WiFi.status() == WL_CONNECTED; }

static bool request(const char* method, const String& path, const String& payload, JsonDocument& doc) {
  if (!wifiUp() || !cfgHost.length()) return false;
  String url = cfgHost + path;
  bool https = url.startsWith("https://");
  WiFiClient plain;
  WiFiClientSecure secure;
  HTTPClient http;
  if (https) {
    secure.setInsecure();
    if (!http.begin(secure, url)) return false;
  } else if (!http.begin(plain, url)) {
    return false;
  }
  http.setTimeout(8000);
  http.addHeader("Authorization", "Bearer " + cfgToken);
  int code;
  if (strcmp(method, "POST") == 0) {
    http.addHeader("Content-Type", "application/json");
    code = http.POST(payload);
  } else {
    code = http.GET();
  }
  String body = http.getString();
  http.end();
  doc.clear();
  if (body.length()) deserializeJson(doc, body);
  return code >= 200 && code < 300;
}

bool fetchConfig(String& staticQr) {
  JsonDocument doc;
  if (!request("GET", "/device/config", "", doc)) return false;
  staticQr = doc["static_qr_string"] | "";
  return true;
}

bool createCharge(int amount, String& orderId, String& qr, String& error) {
  JsonDocument body;
  body["amount"] = amount;
  String payload;
  serializeJson(body, payload);
  JsonDocument doc;
  if (!request("POST", "/device/charge", payload, doc)) {
    error = doc["error"] | "Gagal membuat QR";
    return false;
  }
  orderId = doc["order_id"] | "";
  qr = doc["qr_string"] | "";
  if (!orderId.length() || !qr.length()) {
    error = "Respons QR kosong";
    return false;
  }
  return true;
}

bool fetchEvents(const String& orderId, JsonDocument& doc) {
  String path = "/device/events";
  if (orderId.length()) path += "?order_id=" + orderId;
  return request("GET", path, "", doc);
}

uint8_t* fetchAudio(const String& path, size_t* outLen) {
  if (!wifiUp() || !path.length()) return nullptr;
  String url = cfgHost + path;
  bool https = url.startsWith("https://");
  WiFiClient plain;
  WiFiClientSecure secure;
  HTTPClient http;
  if (https) {
    secure.setInsecure();
    if (!http.begin(secure, url)) return nullptr;
  } else if (!http.begin(plain, url)) {
    return nullptr;
  }
  http.setTimeout(8000);
  http.addHeader("Authorization", "Bearer " + cfgToken);
  int code = http.GET();
  int len = http.getSize();
  if (code != 200 || len <= 44 || len > 200000) {
    http.end();
    return nullptr;
  }
  uint8_t* buf = (uint8_t*)heap_caps_malloc(len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!buf) buf = (uint8_t*)malloc(len);
  if (!buf) {
    http.end();
    return nullptr;
  }
  WiFiClient* stream = http.getStreamPtr();
  size_t got = 0;
  uint32_t start = millis();
  while (got < (size_t)len && millis() - start < 12000) {
    int n = stream->readBytes(buf + got, (size_t)len - got);
    if (n > 0) got += (size_t)n;
    else delay(1);
  }
  http.end();
  if (got != (size_t)len) {
    free(buf);
    return nullptr;
  }
  *outLen = got;
  return buf;
}

bool ackAnnouncement(int id) {
  JsonDocument doc;
  return request("POST", "/device/announcements/" + String(id) + "/ack", "{}", doc);
}

bool heard(const String& orderId) {
  if (!orderId.length()) return false;
  String list = prefs.getString("heard", "");
  int from = 0;
  while (from < (int)list.length()) {
    int comma = list.indexOf(',', from);
    if (comma < 0) comma = list.length();
    if (list.substring(from, comma) == orderId) return true;
    from = comma + 1;
  }
  return false;
}

void markHeard(const String& orderId) {
  if (!orderId.length() || heard(orderId)) return;
  String list = prefs.getString("heard", "");
  if (list.length()) list += ",";
  list += orderId;
  int commas = 0;
  for (unsigned i = 0; i < list.length(); i++) {
    if (list[i] == ',') commas++;
  }
  while (commas > 19) {
    int cut = list.indexOf(',');
    if (cut < 0) break;
    list = list.substring(cut + 1);
    commas--;
  }
  prefs.putString("heard", list);
}
