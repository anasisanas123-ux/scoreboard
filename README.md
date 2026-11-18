# Cricket & Football Scoreboard

A browser scoreboard for cricket and football. It has a public scoreboard page, an admin login for scoring, and can drive a MAX7219 LED dot-matrix display through an ESP32.

- **Cricket:** ball-by-ball scoring with runs, wides, no-balls, byes, leg-byes and wickets (with how out). It tracks batters, bowlers and maidens, CRR, RRR, target and projected score, has two innings with an automatic result, a full scorecard and unlimited undo. A pixel-art pitch shows the bowler's run-up, the delivery and the shot.
- **Football:** goals, yellow and red cards, a match clock with halves and stoppage time (45+2'), goal scorers and kit colours. It has an animated pitch and undo.
- **Big-screen scoreboard** for phones, TVs and projectors. It updates within about a second and flashes FOUR!, SIX!, WICKET! and GOAL!.
- **LED display:** a live preview of the matrix, the best-fit score or a scrolling ticker, event flashes, and custom messages.

| Page | Who uses it |
|---|---|
| `/` (`index.html`) | Public scoreboard. Anyone with the link can watch. |
| `/admin` (`admin.html`) | Scoring panel. Admins only, once a password is set. |

## Deploy on Vercel

1. **Put the project on Vercel.** You can push it to GitHub and click **Add New → Project** on vercel.com. Or, from this folder, run `npx vercel` and follow the sign-in prompts. No build settings are needed.
2. **Add storage.** In the Vercel project, open **Storage → Create / Connect → Upstash (Redis)** and pick the free plan. Connect it to the project. This sets the `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables for you.
3. **Create the admin account.** Go to **Settings → Environment Variables** and add:
   - `ADMIN_PASSWORD`: a long password. This one is required.
   - `ADMIN_USER`: optional. It defaults to `admin`.
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variables take effect.
5. Score at `https://your-app.vercel.app/admin` and share `https://your-app.vercel.app/` with viewers.

How it works:

- **Sign-in:** the session lasts 12 hours. After 10 wrong passwords from one address, sign-in is blocked for 15 minutes. Changing `ADMIN_PASSWORD` signs everyone out.
- **Updates:** viewers check for a new score every second. Vercel's edge cache absorbs the load, so a crowd of viewers costs about one database read per second, which keeps you comfortably inside the free tiers.
- **Changing devices:** if you sign in on another device mid-match, the scoring panel loads the current match from the server.

## Run locally (same Wi-Fi only)

1. Double-click `start-server.bat`, or run `node server.js` (Node.js 18 or later).
2. Score at `http://localhost:8765/admin`. The window prints the phone address, such as `http://192.168.1.20:8765/`.
3. The first time, allow Node.js through Windows Firewall on **Private networks**.

**Admin login locally:** create a file called `.env.local` next to `server.js` containing `ADMIN_PASSWORD=your-password`. Without it, anyone on your Wi-Fi can score, which is handy for quick testing. The match is kept in `.scoreboard-state.json`.

**Without any server:** double-click `admin.html`. Scores stay in that browser, and **Big screen ↗** opens the scoreboard in another tab.

## Scoring

- **Cricket keys:** `0`–`6` runs, `D` wide, `N` no-ball, `B` bye, `L` leg-bye, `W` wicket, `S` swap strike, `U` or `Ctrl+Z` undo.
- **Football keys:** `Q` home goal, `P` away goal, `Space` kick off/pause, `U` undo.
- **Extras:** tap **Wide**, **No ball**, **Bye** or **Leg bye** first, then the runs. For example, Wide then 0 is a plain wide, and No ball then 4 is a no-ball with a four off the bat.
- **One scorer:** score from one admin screen at a time.

## LED display

There are three ways the matrix can get the score:

| Setup | How it connects |
|---|---|
| **Local server / laptop at the ground** | The admin page talks to the ESP32 directly over Wi-Fi (WebSocket, port 81). In the app, click **LED offline** → enter the board's IP → **Connect**. |
| **USB cable** | The admin page sends the score down the cable. Click **Connect USB** (Chrome or Edge). This also works on the Vercel site. |
| **Vercel / internet (planned)** | The ESP32 joins any Wi-Fi with internet and reads `https://your-app.vercel.app/api/led` every second or two. No laptop is needed near the display. The feed is ready; the firmware's polling mode will be added in the hardware phase. |

Browsers block a secure `https://` site from opening an insecure `ws://` connection to a device. That's why direct Wi-Fi only works from the local server, and the internet setup has the ESP32 fetch the score itself.

`/api/led` returns plain text the firmware already understands:

```
T|LQ 11/0 0.4          what to show now
B|6                    brightness 0-15
V|35                   scroll speed, ms per column
F|1795004491748|FT|SIX!   latest flash (show it if the number is new)
```

### Hardware

| Part | Notes |
|---|---|
| ESP32 dev board (or ESP8266 NodeMCU / D1 mini) | |
| MAX7219 FC-16 4-in-1 dot-matrix modules | Two of them gives 8 modules, 64×8 pixels |
| 5 V power supply, 2 A or more | USB power is enough for about 4 modules at low brightness |

| Matrix pin | ESP32 | ESP8266 |
|---|---|---|
| VCC | 5V (VIN) | 5V (VIN) |
| GND | GND | GND |
| DIN | GPIO23 | D7 (GPIO13) |
| CLK | GPIO18 | D5 (GPIO14) |
| CS  | GPIO5  | D8 (GPIO15) |

If you use a separate 5 V supply, connect its GND to the ESP's GND.

### Flash the firmware

1. Install the Arduino IDE and add the ESP32 (or ESP8266) board package.
2. In Library Manager, install **MD_Parola**, **MD_MAX72XX** and **WebSockets** (by Markus Sattler).
3. Open `firmware/scoreboard_esp/scoreboard_esp.ino` and set `WIFI_SSID`, `WIFI_PASS` and `MAX_DEVICES`.
4. Upload the sketch. The matrix scrolls `IP 192.168.x.x`.
5. Set *Modules chained* in the app's LED settings to the same value as `MAX_DEVICES`.

If the board can't find your Wi-Fi, it creates its own hotspot called **Scoreboard** (password `scoreboard123`) at `192.168.4.1`.

### Troubleshooting

- **Letters are mirrored, upside-down or jumbled.** Change `HARDWARE_TYPE` to `PAROLA_HW`, `GENERIC_HW` or `ICSTATION_HW`.
- **The display glitches or flickers.** Use a proper 5 V supply and lower the brightness. If it still glitches, put a 74HCT125 level shifter on DIN, CLK and CS.
- **`scoreboard.local` doesn't connect.** Phones often can't resolve `.local` names, so use the IP address instead.

### Line protocol (WebSocket and USB)

```
T|IND 145/3        static text, centred
S|LONG TEXT...     scrolling text
FT|SIX!            flash static text ~2.5 s, then return to the score
FS|LONG FLASH      scroll the text once, then return to the score
B|8                brightness 0-15
V|35               scroll speed, ms per column
```
