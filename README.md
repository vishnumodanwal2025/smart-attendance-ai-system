# Smart Attendance AI System

**GL Bajaj Group of Institutions, Mathura — Dept. of CSE (CSE-AIML & CS, Section H, Sem III)**

A full-stack, role-secured college attendance management system that combines **deep-learning facial verification (YuNet + SFace)**, **teacher-anchored dynamic GPS geofencing**, and **strict subject-level access control** to eliminate proxy attendance in classrooms and labs.

---

## Project Team & Member Task Breakdown (4 Members)

> Replace the placeholder names/roll numbers below with your group members' details before submission.

| Member | Role / Focus Area | Specific Tasks & Implemented Modules |
| :--- | :--- | :--- |
| **Member 1** *(Name / Roll No.)* | **AI & Computer Vision Lead** | • Integrated OpenCV `FaceDetectorYN` (`yunet_face.onnx`) and `FaceRecognizerSF` (`sface.onnx`) in [`backend/app/main.py`](backend/app/main.py)<br>• Built `validate_face_image()` to enforce single-face framing, detection confidence (`>= 0.75`), minimum face size (`60x60` px), and Laplacian blur rejection<br>• Implemented `process_face_verification()` using 5-point landmark alignment, 128-D embeddings, cosine similarity (`>= 0.45`), and L2 distance (`<= 1.05`)<br>• Built protected local disk biometric image storage under `backend/app/static/faces/` |
| **Member 2** *(Name / Roll No.)* | **Backend API, Database & Security Lead** | • Designed FastAPI application, request/response Pydantic schemas, and REST APIs ([`backend/app/main.py`](backend/app/main.py), [`backend/app/schemas.py`](backend/app/schemas.py))<br>• Designed SQLAlchemy ORM models (`User`, `Schedule`, `Attendance`, `AttendanceSession`) and SQLite/PostgreSQL setup with automatic schema migration ([`backend/app/models.py`](backend/app/models.py), [`backend/app/database.py`](backend/app/database.py))<br>• Implemented bcrypt password hashing and JWT bearer authentication/RBAC (`get_current_user`, `get_current_professor`, `get_current_admin`) in [`backend/app/auth.py`](backend/app/auth.py)<br>• Enforced Coordinator/HOD-only student onboarding, shareable credential generation, protected face-photo serving (`/users/{id}/face-photo`), subject-teacher session locking, and role-scoped attendance logs |
| **Member 3** *(Name / Roll No.)* | **Geofencing, Session Control & Check-In Logic** | • Implemented Haversine distance calculation on both backend and frontend ([`frontend/src/constants/scheduleData.js`](frontend/src/constants/scheduleData.js))<br>• Built teacher-anchored dynamic geofencing (`/sessions/open`, `/sessions/close`, [`ManageSessionsPanel.jsx`](frontend/src/components/ManageSessionsPanel.jsx)) supporting live teacher GPS capture, merged-class radius options (`150m` / `300m` / `1000m`), desktop test GPS toggle, and face-only demo bypass<br>• Built the unified check-in workflow (`/attendance/unified-check-in`) and [`LiveCheckinPanel.jsx`](frontend/src/components/LiveCheckinPanel.jsx) live webcam frame capture, GPS verification, session-scoped duplicate prevention, and IST timestamps |
| **Member 4** *(Name / Roll No.)* | **Frontend UI/UX, Timetable & Reporting Lead** | • Built React 19 + Vite application shell, JWT session persistence, Vite API proxy, and custom responsive CSS ([`App.jsx`](frontend/src/App.jsx), [`vite.config.js`](frontend/vite.config.js), [`index.css`](frontend/src/index.css))<br>• Implemented institutional Sign-In portal with public registration disabled ([`AuthOverlay.jsx`](frontend/src/components/AuthOverlay.jsx)), role-based navigation & status bar ([`TabNav.jsx`](frontend/src/components/TabNav.jsx), [`Topbar.jsx`](frontend/src/components/Topbar.jsx), [`Toast.jsx`](frontend/src/components/Toast.jsx))<br>• Built Coordinator-only Student + Face Enrollment & credential sharing UI ([`FaceEnrollmentPanel.jsx`](frontend/src/components/FaceEnrollmentPanel.jsx))<br>• Built the Official Sec-H Timetable & Weekly Matrix ([`TimetablePanel.jsx`](frontend/src/components/TimetablePanel.jsx)) and searchable attendance audit table ([`AttendanceLogsPanel.jsx`](frontend/src/components/AttendanceLogsPanel.jsx)) |

---

## Key Features

- **Institutional Credential Control (No Public Sign-Up):** Students cannot self-register; only the Coordinator / HOD creates accounts, captures/uploads face baselines, and shares generated login credentials.
- **Role-Based Access & Subject-Teacher Locking:**
  - **Coordinator / HOD:** Enrolls students, resets passwords, provisions faculty accounts, reassigns subjects, views all logs, and manages sessions.
  - **Subject Faculty:** Can open/close sessions, run direct check-ins, and view attendance logs **strictly for their own assigned subjects/labs**.
  - **Students:** Locked to their own authenticated identity, can only check in when a session is open, and see only their personal attendance history.
- **Strict Biometric Face AI:** Single-face quality validation at enrollment + YuNet detection + SFace 128-D cosine/L2 verification at check-in.
- **Teacher-Anchored Dynamic Geofencing:** Teachers can anchor the active session to their live GPS (for moved or merged classes), adjust radius (`150m`–`1000m`), or enable Face-Only Demo mode.
- **Session-Scoped Anti-Duplicate & IST Logging:** Prevents duplicate check-ins per active session and stores timestamps formatted in IST (`UTC+05:30`).

---

## Technology Stack

- **Frontend:** React 19, Vite 8, JavaScript (JSX), CSS3, `lucide-react`, Browser MediaDevices & Geolocation APIs
- **Backend:** Python, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2
- **Security & Auth:** JWT (`python-jose`), `bcrypt` via `passlib`, OAuth2 Bearer dependencies
- **AI / Computer Vision:** OpenCV (`cv2.FaceDetectorYN`, `cv2.FaceRecognizerSF`), YuNet ONNX, SFace ONNX, NumPy
- **Database & Storage:** SQLite (`attendance.db` at project root; configurable via `DATABASE_URL` for PostgreSQL/Supabase) + protected local disk storage for student face images (`backend/app/static/faces/`)

---

## Running Locally

### Prerequisites
- Python 3.10+ and Node.js 18+
- ONNX model files present in `backend/app/`: `yunet_face.onnx` and `sface.onnx`

### 1. Start the Backend (from project root)
```powershell
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. Start the Frontend (in a second terminal)
```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open **http://127.0.0.1:5173/** in Chrome/Edge (camera & location permissions are required for live verification). API documentation is available at **http://127.0.0.1:8000/docs**.

---

## Seeded Test Accounts

- **Coordinator / HOD:** `prof@college.edu` / `prof123`
- **Subject Teachers** *(password: `faculty123`)*:
  - `bhanu@glbajaj.ac.in` (PYTHON)
  - `ashish@glbajaj.ac.in` (MATH-IV)
  - `richa@glbajaj.ac.in` (DS & Data Structure Lab)
  - `gopal@glbajaj.ac.in` (DSTL, Web Designing Workshop & Mini Project Lab)
  - `hitendra@glbajaj.ac.in` (COA, COA Lab & Mini Project Lab)
  - `bablu@glbajaj.ac.in` (UHV)
- **Students:** Created by the Coordinator / HOD in **Face Enrollment**, which displays shareable login ID + password credentials immediately upon enrollment.

---

## Security & Privacy Notes

- Student biometric photos are stored locally in `backend/app/static/faces/` and served exclusively via the authenticated `/users/{user_id}/face-photo` route (restricted to Coordinator/HOD or that student).
- Set the `JWT_SECRET_KEY` and `ALLOWED_ORIGINS` environment variables before deploying outside localhost.
- For full endpoint and schema documentation, see [`PROJECT_DETAILS.txt`](PROJECT_DETAILS.txt).
