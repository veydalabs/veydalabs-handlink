# veydalabs-handlink

Browser-based hand-mirroring control UI for a 5-servo InMoov hand/forearm.

## Scope / Intended Hardware

This code is tuned for my InMoov right forearm with MG996R servos and my tendon routing.

This is for:
- InMoov right forearm
- MG996R servos
- My specific tendon routing
- My wiring order

If your build differs (mechanics, horn orientation, tendon path, wiring, servo model), you should expect to recalibrate and possibly modify behavior.

## What Is Inside This Folder

- Web app UI (`index.html`, `styles.css`, `app.js`)
- Required Arduino firmware bridge:
  - `firmware/serial_servo_bridge/serial_servo_bridge.ino`

`veydalabs-handlink` is now self-contained for running this app + required firmware.

## Requirements

- Desktop Chrome or Edge (Web Serial required)
- Arduino Uno (or Uno-compatible serial bridge)
- USB data cable
- External servo power supply for MG996R servos
- Common ground between Arduino GND and servo power GND
- Internet access when loading the web app (MediaPipe scripts load from CDN)

## 1) Upload Firmware (Arduino IDE)

1. Open Arduino IDE.
2. Open sketch:
   - `veydalabs-handlink/firmware/serial_servo_bridge/serial_servo_bridge.ino`
3. Select board: `Arduino Uno`.
4. Select correct port.
5. Upload.

### Firmware behavior

- Bridge accepts absolute command: `A a1 a2 a3 a4 a5`
- Universal limiter is enforced in firmware for every servo write:
  - `15..165` degrees
- Bridge is channel-based only (`S1..S5`), not finger-mapped
- Finger mapping + interpolation are owned by the app calibration settings

## 2) Run App (Linux/macOS)

```bash
cd veydalabs-handlink
python3 -m http.server 8080
```

Open: `http://localhost:8080`

## 2) Run App (Windows PowerShell)

```powershell
cd veydalabs-handlink
py -m http.server 8080
```

Open: `http://localhost:8080`

## 3) Setup Flow

1. Open `Setup` tab.
2. Click `Look For Arduino`, choose your board.
3. Click `Connect Device`.
4. In Manual Calibration, for each `S1..S5`:
   - assign finger mapping
   - use `Down -5°` / `Up +5°` to test
   - enter `Fully Extended` and `Fully Closed`
5. Click `Save Calibration`.

Calibration values persist in browser local storage.

## 4) Control Flow

1. Open `Control` tab.
2. Confirm safety prompt.
3. Click `Start Hand Control`.
4. Show one hand to camera.
5. Optional: toggle `Show Camera Feed` off to hide the camera image while still displaying hand landmarks.

If serial disconnects, tracking stops automatically.

## Safety Note

Always verify safe tendon tension and safe travel before full-speed motion.
Even with software limits, mechanical binding can still damage tendons, horns, or printed parts.
