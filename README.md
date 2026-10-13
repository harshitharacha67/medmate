# MedMate

**Every dose, confirmed.** A smart pill box companion with a live caregiver dashboard, a fun voice assistant that understands many languages, and an optional ESP32 box.

Palette: `#F3ECE4` `#D9B6A3` `#D88B79` `#A71F13` `#340A10`. Fonts: Playfair Display and Montserrat (loaded from Google Fonts, with safe fallbacks when offline).

## Run it in VS Code (2 minutes)

1. Install **Node.js 18 or newer** from nodejs.org.
2. In VS Code choose **File > Open Folder** and pick this `medmate` folder.
3. Open the terminal (**Terminal > New Terminal**) and run:
   ```
   npm install
   npm start
   ```
4. Open **http://localhost:3000** in Chrome or Edge.

Demo accounts are created on first run:

| Role | Email | Password |
|---|---|---|
| Patient | demo@medmate.app | demo123 |
| Caregiver | caregiver@medmate.app | demo123 |

The login screen also has "Try demo patient" and "Try demo caregiver" buttons. Open both in two browser windows to watch the live updates.

## A 3-minute demo script

1. Sign in as the **demo patient**. Open **Settings** and set "Minutes before a dose counts as missed" to **1**.
2. On **Today**, press **Add a test dose in 1 minute**. Watch the countdown.
3. In another window sign in as the **demo caregiver**. When the dose is due, both screens chime and show a toast.
4. Either take the dose (confetti, XP, streak) or wait a minute and see the caregiver get a **missed dose** alert.
5. Open **Smart Box** and click a glowing lid. The virtual box logs the dose the same way a real ESP32 would.
6. Press the round **mic** button and say "I took my medicine", "what's next?" or "मेरी अगली दवा कौन सी है". Pick your language in the assistant's dropdown first.

## Features

- Accounts for **patients** and **caregivers**, linked with a short care code (like `MM-DEMO`)
- Medicines with times, weekdays, stock, colours, notes and **refill predictions**
- Today view with a progress ring, streak, XP, levels and **confetti**
- Live events (Server-Sent Events): due, taken, missed, SOS, nudges, no refresh needed
- Server-side scheduler: a dose that is not logged within your grace period becomes **missed** and alerts caregivers. Three misses in a row raise a "needs attention" alert
- **Smart Box** simulator with 3D lids and LEDs, plus a real `POST /api/device/event` endpoint for the ESP32
- **Adaptive timing**: if you always take a dose 20 minutes late, MedMate suggests moving the reminder
- **Insights**: weekly bars, 4-week heatmap, best time of day, badges
- **Drug interaction hints** for common pairs (informational only)
- **Health log** for BP, sugar, weight, pulse and mood with trend charts and high/low flags that alert caregivers
- **SOS** button, caregiver **nudges**, browser notifications, spoken reminders
- **Doctor report** you can print or save as PDF
- Light and dark theme, mobile friendly, reduced-motion friendly

## The voice assistant

- **Speaking**: uses the browser's speech recognition (Chrome, Edge or Safari). Pick the language you will speak from the dropdown, because browsers need to know it in advance. About 30 languages are listed.
- **Typing**: works in any language.
- **Replies**: spoken back in the reply's language with the browser's text-to-speech.
- **Built-in mode** (no setup): understands English, Hindi, Telugu, Tamil, Spanish, French and German keywords, and replies in English, Hindi, Telugu or Spanish.
- **Full mode**: copy `.env.example` to `.env` and add your `ANTHROPIC_API_KEY`. The assistant then understands **any language**, answers in the same one, and can add medicines, log vitals, mark doses and navigate. It also unlocks **Scan prescription** (photo to medicines). Change the model with `ANTHROPIC_MODEL` if you like.

Things you can say: "I took my BP tablet", "add Vitamin D at 9 pm", "my sugar is 140", "my BP is 130/85", "snooze", "how is my streak?", "tell me a joke", "SOS".

## Real hardware (optional)

Open `esp32/medmate_box.ino` in the Arduino IDE. Wire a reed switch per lid, three LEDs and a buzzer, set your Wi-Fi, your computer's local IP and the patient code (shown in Care Circle), then upload. Opening a lid sends `{ "code": "MM-DEMO", "slot": 1 }` and the box shows green, amber or red from the reply.

## Project structure

```
server.js          Express API, JSON database, scheduler, live events, assistant
public/index.html  App shell, logo and icon sprite
public/styles.css  Palette, layout, animations
public/app.js      The whole frontend (vanilla JS, no build step)
public/logo.svg    Logo and favicon
esp32/             Arduino sketch for the smart box
data/db.json       Created on first run. Delete it to reset the demo data
```

## Good to know

- Times use the clock of the computer running the server.
- Passwords are hashed with scrypt and sessions use signed tokens, which is fine for a prototype. Before real patients use it, add HTTPS, rate limiting and a proper database.
- Speech recognition needs `localhost` or HTTPS.
- MedMate is a reminder and companion app. It does not give medical advice, and the interaction hints are informational only.
- Port busy? Set `PORT=4000` in a `.env` file.
