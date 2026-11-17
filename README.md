# Surepass Driving Licence Verification Automation System

An enterprise-grade, batch driving licence verification automation solution powered by **FastAPI**, **Playwright**, and **SQLite**. Supports headed and headless execution, live browser mirroring, session cookie transfer, automated PDF capture, and real-time WebSocket dashboard streaming.

---

## 🚀 Key Features

* **Dual Platform Support:**
  * **Modern FastAPI Single-Page Web Dashboard:** Non-blocking async server with real-time WebSockets, live progress streaming, and zero page re-renders.
  * **Streamlit Operations Console:** Rapid local dashboard for data exploration and testing.
* **Xvfb Cloud Virtual Desktop Support:**
  * Includes a production `Dockerfile` with `xvfb` (Virtual Framebuffer).
  * Runs headed Chromium inside Docker in the cloud with zero `Missing X server or $DISPLAY` errors!
* **Robust Batch Excel Processing:**
  * Auto-detects columns: `GSM ID`, `Phone Number`, `DL Number`, `DOB`.
  * Preserves leading zeros and formats dates (`YYYY-MM-DD` and `DD-MM-YYYY`).
  * Real-time incremental Excel updating via `openpyxl` after every record.
* **Automated PDF Report Management:**
  * Conclusively captures verification outcome PDFs.
  * Renames reports to standardized format: `GSMID_PHONENUMBER_DL_Report.pdf`.
  * Validates PDF byte structures and provides 1-click ZIP bundle downloads.
* **Cloud Browser Mirror & Remote Operator Login:**
  * Live canvas screen streaming from the cloud container to your browser.
  * Form inputs for remote operator login, password, and OTP/CAPTCHA submission.
  * Session cookie export and import (`surepass_session.json`).

---

## 🛠️ Architecture

```
dlaadhar-automation/
├── server.py                 # FastAPI enterprise web application & WebSocket server
├── web/
│   └── index.html            # Modern Tailwind SPA with real-time UI
├── Dockerfile                # Production container with Playwright + Xvfb
├── entrypoint.sh             # Starts Xvfb virtual desktop & launches Uvicorn
├── docker-compose.yml        # Docker compose setup
├── railway.json              # 1-click Railway deployment configuration
├── render.yaml               # 1-click Render deployment configuration
├── app.py                    # Streamlit alternate dashboard
├── config.py                 # Central configurations & timeouts
├── portal_selectors.json     # Configurable Surepass DOM selectors
├── core/
│   ├── excel_processor.py    # Excel loading, validation & incremental saving
│   ├── job_manager.py        # Thread-safe execution coordinator
│   ├── status_manager.py     # Verification status enums & badges
│   ├── validators.py         # DL, Phone, DOB, and GSM validation rules
│   └── verification_engine.py# Sequential processing queue
├── automation/
│   ├── browser_manager.py    # Persistent Playwright context with self-healing
│   ├── download_manager.py   # PDF download capture, validation & renaming
│   ├── login_handler.py      # Session state & remote input handlers
│   └── surepass_automation.py# Form filling & outcome detection
├── database/
│   └── db_manager.py         # SQLite persistence for jobs & driver records
├── tests/                    # 20 Unit & Integration tests (100% passing)
└── requirements.txt          # Production dependencies
```

---

## 💻 Local Running Guide

### 1. Run the FastAPI Modern Web App (Recommended)
```powershell
# Start the web server
python server.py
```
Open **`http://localhost:8000`** in your browser.

* Teammates on the same Wi-Fi can open: **`http://<YOUR_LOCAL_IP>:8000`**

### 2. Run the Streamlit Dashboard (Alternate)
```powershell
streamlit run app.py
```
Open **`http://localhost:8501`** in your browser.

---

## ☁️ Cloud Deployment (Zero Display Errors)

### Deploy to Railway (Easiest)
1. Fork or push this repository to GitHub.
2. Go to [railway.app](https://railway.app) $\rightarrow$ Click **"New Project"** $\rightarrow$ **"Deploy from GitHub repo"**.
3. Select your repository (`dlaadhar-automation`).
4. Railway automatically reads `Dockerfile` and `railway.json`, boots `xvfb` virtual display, and gives you a live public HTTPS URL!

### Deploy to Render
1. Go to [render.com](https://render.com) $\rightarrow$ Click **"New Web Service"**.
2. Connect your GitHub repository.
3. Select **Docker** environment.
4. Render builds the container and launches the app!

### Deploy with Docker Compose (Any VPS)
```bash
docker compose up -d --build
```

---

## 🧪 Running Tests

Run the full automated test suite (20 tests covering all processors, validators, database, and API routes):
```powershell
python -m pytest -v
```
Output: **20 passed in 15.25s**.
