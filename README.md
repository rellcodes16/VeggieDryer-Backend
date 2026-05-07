# Vegetable Dryer Backend API

Node.js + Express backend for a portable vegetable dryer system with ESP32, DHT22 sensor, and HX711 load cell. Features real-time data via Socket.IO, batch session management, automatic alerts, and graph-ready sensor history.

---

## Project Structure

```
dryer-backend/
├── server.js                   # Entry point, Socket.IO setup
├── .env                        # Environment config
├── ESP32_FIRMWARE.ino          # Arduino reference code for ESP32
├── data/
│   └── db.json                 # JSON database (auto-created)
└── src/
    ├── database.js             # DB init with lowdb
    ├── routes/
    │   ├── index.js
    │   ├── batchRoutes.js
    │   ├── sensorRoutes.js
    │   ├── dryerRoutes.js
    │   └── alertRoutes.js
    ├── controllers/
    │   ├── batchController.js  # Drying session logic
    │   ├── sensorController.js # ESP32 data ingestion
    │   ├── dryerController.js  # On/Off control + settings
    │   └── alertController.js  # Alert management
    └── utils/
        └── alertManager.js     # Auto-alert generation
```

---

## Getting Started

```bash
npm install
npm run dev      # development 
npm start        # production
```

Server runs at `http://localhost:3000`

---

## API Reference

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |

---

### Dryer Control
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dryer/status` | Full dryer status (on/off, active batch, latest sensor) |
| POST | `/api/dryer/on` | Turn dryer ON |
| POST | `/api/dryer/off` | Turn dryer OFF |
| PUT | `/api/dryer/settings` | Set target temperature & drying time |
| GET | `/api/dryer/command` | **ESP32 polls this** — returns on/off + settings |

**PUT /api/dryer/settings body:**
```json
{
  "targetTemperature": 55,
  "dryingTimeMinutes": 180
}
```

---

### Sensor Data (ESP32 → Server)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sensor/data` | ESP32 posts readings here |
| GET | `/api/sensor/latest` | Latest sensor snapshot |
| GET | `/api/sensor/history` | Historical data for graphs |

**POST /api/sensor/data body:**
```json
{
  "temperature": 52.3,
  "humidity": 38.5,
  "weight": 450.2
}
```

**GET /api/sensor/history query params:**
- `batchId` — filter to a specific batch
- `type` — `temperature` | `humidity` | `weight` (returns `{x, y}` pairs ready for Chart.js)
- `from` / `to` — ISO date strings
- `limit` — max readings (default 500)

---

### Batches (Drying Sessions)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/batches` | All batches (paginated) |
| GET | `/api/batches/active` | Currently running batch |
| GET | `/api/batches/:id` | Single batch + its readings |
| POST | `/api/batches/start` | Start a new drying batch |
| PATCH | `/api/batches/:id/complete` | Complete batch (provide final weight) |
| PATCH | `/api/batches/:id/abort` | Abort batch |

**POST /api/batches/start body:**
```json
{
  "vegetableName": "Tomatoes",
  "initialWeight": 850.0,
  "targetTemperature": 55,
  "dryingTimeMinutes": 240,
  "notes": "Sliced thin, 5mm"
}
```

**PATCH /api/batches/:id/complete body:**
```json
{
  "finalWeight": 312.5
}
```

---

### Alerts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alerts` | List alerts (`?unreadOnly=true&limit=50`) |
| PATCH | `/api/alerts/:id/read` | Mark one as read |
| PATCH | `/api/alerts/read-all` | Mark all as read |
| DELETE | `/api/alerts` | Clear all alerts |

**Alert types:** `DRYING_COMPLETE`, `HIGH_TEMPERATURE`, `LOW_HUMIDITY`, `HIGH_HUMIDITY`, `DRYER_STARTED`, `DRYER_STOPPED`, `BATCH_STARTED`, `TARGET_TEMP_REACHED`, `SENSOR_ERROR`

---

## Socket.IO Real-Time Events

Connect from your web app:
```javascript
import { io } from "socket.io-client";
const socket = io("http://localhost:3000");

socket.on("sensorUpdate",    (data) => { /* {temperature, humidity, weight, timestamp, dryingStatus} */ });
socket.on("dryerStatus",     (data) => { /* {dryerOn, activeBatch} */ });
socket.on("alert",           (data) => { /* {type, message, severity, createdAt} */ });
socket.on("batchStarted",    (data) => { /* batch object */ });
socket.on("batchComplete",   (data) => { /* batch object with finalWeight */ });
socket.on("batchAborted",    (data) => { /* batch object */ });
socket.on("settingsUpdated", (data) => { /* new settings */ });

// Control dryer via socket too:
socket.emit("controlDryer", { dryerOn: true });
```

---

## ESP32 Setup

1. Open `ESP32_FIRMWARE.ino` in Arduino IDE
2. Fill in your WiFi credentials and server IP address
3. Install libraries: **Adafruit DHT**, **ArduinoJson**, **HX711**
4. Upload to ESP32

The ESP32:
- **POSTs** to `/api/sensor/data` every 5 seconds
- **GETs** `/api/dryer/command` every 3 seconds to know if it should turn on/off

---

## Environment Variables (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `MAX_TEMPERATURE` | 75 | Alert threshold (°C) |
| `MIN_HUMIDITY` | 10 | Alert threshold (%) |
| `MAX_HUMIDITY` | 95 | Alert threshold (%) |
| `DEFAULT_TARGET_TEMP` | 50 | Default target temp (°C) |
| `DEFAULT_DRYING_TIME_MINUTES` | 120 | Default drying time |

---

## Graph Data Usage

Sensor history is returned as `{x: timestamp, y: value}` pairs — plug directly into Chart.js or Recharts:

```javascript
const res = await fetch(`/api/sensor/history?batchId=${id}&type=temperature`);
const { data } = await res.json();

