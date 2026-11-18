/*
  Scoreboard LED display: ESP32 or ESP8266 + MAX7219 (FC-16) 8x8 dot-matrix modules.

  Libraries (Arduino IDE > Library Manager):
    - MD_Parola    by majicDesigns
    - MD_MAX72XX   by majicDesigns
    - WebSockets   by Markus Sattler (arduinoWebSockets)

  Wiring (FC-16 module input side):
                 ESP32      ESP8266 (NodeMCU / Wemos D1 mini)
    VCC   ->     5V / VIN   5V / VIN    (use a separate 5V supply for 4+ modules)
    GND   ->     GND        GND
    DIN   ->     GPIO23     D7 (GPIO13)
    CLK   ->     GPIO18     D5 (GPIO14)
    CS    ->     GPIO5      D8 (GPIO15)

  The web scoreboard sends one line per message, over a WebSocket on port 81 or USB serial at 115200:
    T|text    static text, centred
    S|text    scrolling text (repeats)
    FT|text   flash static text for ~2.5 s, then back to the score
    FS|text   flash scrolling text once, then back to the score
    B|0-15    brightness
    V|ms      scroll speed in ms per column (lower = faster)
*/

#include <MD_Parola.h>
#include <MD_MAX72xx.h>
#include <SPI.h>
#include <WebSocketsServer.h>

#if defined(ESP32)
  #include <WiFi.h>
  #include <ESPmDNS.h>
  const uint8_t CS_PIN = 5;
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <ESP8266mDNS.h>
  const uint8_t CS_PIN = 15;  // D8
#else
  #error "This sketch is for ESP32 or ESP8266 boards"
#endif

// ======================= CHANGE THESE =======================
#define HARDWARE_TYPE MD_MAX72XX::FC16_HW  // If letters look mirrored or scrambled, try PAROLA_HW, GENERIC_HW or ICSTATION_HW
#define MAX_DEVICES   8                    // Number of 8x8 modules chained. Set the same number in the web app.

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* AP_SSID   = "Scoreboard";      // Hotspot the board creates if it can't join the Wi-Fi above
const char* AP_PASS   = "scoreboard123";   // At least 8 characters
const char* HOSTNAME  = "scoreboard";      // Reachable as scoreboard.local on networks that support mDNS
// ============================================================

MD_Parola P(HARDWARE_TYPE, CS_PIN, MAX_DEVICES);
WebSocketsServer ws(81);

const size_t BUF = 160;
char mainText[BUF] = "READY";
bool mainScroll = false;
char flashText[BUF] = "";
bool flashScroll = false;
bool flashing = false;
unsigned long flashUntil = 0;
uint16_t speedMs = 35;

char serialBuf[BUF];
size_t serialLen = 0;

void showMain() {
  P.displayClear();
  if (mainScroll) P.displayText(mainText, PA_LEFT, speedMs, 0, PA_SCROLL_LEFT, PA_SCROLL_LEFT);
  else            P.displayText(mainText, PA_CENTER, speedMs, 0, PA_PRINT, PA_NO_EFFECT);
}

void showFlash() {
  P.displayClear();
  flashing = true;
  if (flashScroll) {
    P.displayText(flashText, PA_LEFT, speedMs, 0, PA_SCROLL_LEFT, PA_SCROLL_LEFT);
  } else {
    P.displayText(flashText, PA_CENTER, 25, 0, PA_SCROLL_UP, PA_NO_EFFECT);
    flashUntil = millis() + 2500;
  }
}

void handleLine(char* line) {
  // strip trailing CR/LF
  size_t n = strlen(line);
  while (n && (line[n - 1] == '\r' || line[n - 1] == '\n')) line[--n] = 0;

  char* bar = strchr(line, '|');
  if (!bar) return;
  *bar = 0;
  const char* cmd = line;
  const char* arg = bar + 1;

  if (!strcmp(cmd, "T") || !strcmp(cmd, "S")) {
    strlcpy(mainText, arg, BUF);
    mainScroll = (cmd[0] == 'S');
    if (!flashing) showMain();
  } else if (!strcmp(cmd, "FT") || !strcmp(cmd, "FS")) {
    strlcpy(flashText, arg, BUF);
    flashScroll = (cmd[1] == 'S');
    showFlash();
  } else if (!strcmp(cmd, "B")) {
    P.setIntensity(constrain(atoi(arg), 0, 15));
  } else if (!strcmp(cmd, "V")) {
    speedMs = constrain(atoi(arg), 10, 200);
    P.setSpeed(speedMs);
  }
}

// A WebSocket message may hold one or several lines.
void handleMessage(const uint8_t* data, size_t len) {
  char line[BUF];
  size_t n = 0;
  for (size_t i = 0; i <= len; i++) {
    char c = (i < len) ? (char)data[i] : '\n';
    if (c == '\n') {
      line[n] = 0;
      if (n) handleLine(line);
      n = 0;
    } else if (n < BUF - 1) {
      line[n++] = c;
    }
  }
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_TEXT) {
    handleMessage(payload, length);
  } else if (type == WStype_CONNECTED) {
    Serial.printf("Web app connected (client %u)\n", num);
    ws.sendTXT(num, "HELLO|scoreboard");
  } else if (type == WStype_DISCONNECTED) {
    Serial.printf("Web app disconnected (client %u)\n", num);
  }
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      serialBuf[serialLen] = 0;
      if (serialLen) handleLine(serialBuf);
      serialLen = 0;
    } else if (serialLen < BUF - 1) {
      serialBuf[serialLen++] = c;
    }
  }
}

void setup() {
  Serial.begin(115200);
  P.begin();
  P.setIntensity(6);
  P.setTextAlignment(PA_CENTER);
  P.print("WIFI...");

  WiFi.mode(WIFI_STA);
#if defined(ESP32)
  WiFi.setHostname(HOSTNAME);
#else
  WiFi.hostname(HOSTNAME);
#endif
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("\nConnecting to %s", WIFI_SSID);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(300);
    Serial.print('.');
  }

  String ip;
  if (WiFi.status() == WL_CONNECTED) {
    ip = WiFi.localIP().toString();
#if defined(ESP32)
    WiFi.setSleep(false);  // lower latency for live updates
#endif
    snprintf(mainText, BUF, "IP %s", ip.c_str());
    Serial.printf("\nConnected. IP address: %s\n", ip.c_str());
  } else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    ip = WiFi.softAPIP().toString();
    snprintf(mainText, BUF, "HOTSPOT %s  IP %s", AP_SSID, ip.c_str());
    Serial.printf("\nWi-Fi not found. Started hotspot '%s' (password '%s'), IP %s\n", AP_SSID, AP_PASS, ip.c_str());
  }

  if (MDNS.begin(HOSTNAME)) Serial.printf("mDNS: %s.local\n", HOSTNAME);

  ws.begin();
  ws.onEvent(onWsEvent);

  mainScroll = true;  // scroll the IP address until the web app sends a score
  showMain();
}

void loop() {
  ws.loop();
#if defined(ESP8266)
  MDNS.update();
#endif
  readSerial();

  if (P.displayAnimate()) {
    if (flashing) {
      if (flashScroll || millis() >= flashUntil) {
        flashing = false;
        showMain();
      }
    } else if (mainScroll) {
      P.displayReset();
    }
  }
}
