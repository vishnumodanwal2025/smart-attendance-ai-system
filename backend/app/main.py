from datetime import timedelta, datetime, timezone
from typing import Optional
import math
import os
import secrets
import shutil
import string

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import auth, models, schemas
from .database import SessionLocal, engine, get_db

IST = timezone(timedelta(hours=5, minutes=30))


def to_ist_str(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).strftime("%Y-%m-%d %H:%M:%S IST")


def ensure_sqlite_columns():
    """Safely add new columns to existing SQLite tables without losing data."""
    if not str(engine.url).startswith("sqlite"):
        return
    migrations = {
        "users": [("is_admin", "TEXT DEFAULT 'no'")],
        "schedules": [("co_prof_id", "INTEGER")],
        "attendance": [("session_id", "INTEGER")],
        "attendance_sessions": [
            ("allow_demo_gps", "TEXT DEFAULT 'no'"),
            ("session_lat", "REAL"),
            ("session_lng", "REAL"),
            ("allowed_radius_m", "REAL"),
            ("bypass_geofence", "TEXT DEFAULT 'no'"),
        ],
    }
    with engine.begin() as conn:
        for table, cols in migrations.items():
            existing = {
                row[1]
                for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            }
            for col_name, col_def in cols:
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"))
                    print(f"[DB Migrate] Added {table}.{col_name}")


models.Base.metadata.create_all(bind=engine)
ensure_sqlite_columns()

app = FastAPI(title="College Attendance AI System")

default_origins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]
env_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=env_origins or default_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "faces")
FRONTEND_DIST = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "frontend", "dist"))
FRONTEND_DIST_ASSETS = os.path.join(FRONTEND_DIST, "assets")
FRONTEND_FILE = (
    os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(os.path.join(FRONTEND_DIST, "index.html"))
    else os.path.abspath(os.path.join(BASE_DIR, "..", "..", "frontend", "index.html"))
)
os.makedirs(UPLOAD_DIR, exist_ok=True)
if os.path.exists(FRONTEND_DIST_ASSETS):
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST_ASSETS), name="frontend-assets")


def generate_temp_password(length: int = 8) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def can_manage_schedule(user: models.User, schedule: models.Schedule) -> bool:
    if user.role != "professor":
        return False
    if user.is_admin == "yes":
        return True
    if schedule.prof_id == user.id:
        return True
    if schedule.co_prof_id is not None and schedule.co_prof_id == user.id:
        return True
    return False


@app.on_event("startup")
def init_db_data():
    """Seed initial demo accounts, subject faculty, and the 10 canonical GLBAJAJ schedules."""
    db = SessionLocal()
    try:
        # 1. Ensure Demo Student and Coordinator/Admin Professor exist
        demo_student = db.query(models.User).filter(models.User.email == "student@college.edu").first()
        if not demo_student:
            user1_path = os.path.join(UPLOAD_DIR, "user_1.jpg")
            demo_student = models.User(
                name="Demo Student",
                email="student@college.edu",
                hashed_password=auth.get_password_hash("student123"),
                role="student",
                is_admin="no",
                enrollment_no="25CSAIM076",
                section="H",
                group="G1",
                face_encoding=user1_path if os.path.exists(user1_path) else None,
            )
            db.add(demo_student)
            db.commit()
            db.refresh(demo_student)
        elif not demo_student.enrollment_no:
            demo_student.enrollment_no = "25CSAIM076"
            demo_student.section = demo_student.section or "H"
            demo_student.group = demo_student.group or "G1"
            db.commit()

        coordinator = db.query(models.User).filter(models.User.email == "prof@college.edu").first()
        if not coordinator:
            coordinator = models.User(
                name="Class Coordinator (Admin)",
                email="prof@college.edu",
                hashed_password=auth.get_password_hash("prof123"),
                role="professor",
                is_admin="yes",
                section="H",
                group="All",
            )
            db.add(coordinator)
            db.commit()
            db.refresh(coordinator)
        elif coordinator.is_admin != "yes":
            coordinator.is_admin = "yes"
            db.commit()

        # 2. Seed real subject faculty accounts
        faculty_specs = [
            ("Er. Bhanu Pratap Singh", "bhanu@glbajaj.ac.in"),
            ("Dr. Ashish Kumar", "ashish@glbajaj.ac.in"),
            ("Er. Richa Mishra", "richa@glbajaj.ac.in"),
            ("Er. Gopal Singh", "gopal@glbajaj.ac.in"),
            ("Er. Hitendra Kumar Prajapati", "hitendra@glbajaj.ac.in"),
            ("Dr. Bablu Kumar Jha", "bablu@glbajaj.ac.in"),
        ]
        faculty_by_email = {}
        for f_name, f_email in faculty_specs:
            fac = db.query(models.User).filter(models.User.email == f_email).first()
            if not fac:
                fac = models.User(
                    name=f_name,
                    email=f_email,
                    hashed_password=auth.get_password_hash("faculty123"),
                    role="professor",
                    is_admin="no",
                    section="H",
                    group="All",
                )
                db.add(fac)
                db.commit()
                db.refresh(fac)
            faculty_by_email[f_email] = fac

        # 3. Sync the 10 canonical GLBAJAJ schedules when missing or legacy-mismatched
        sched_1 = db.query(models.Schedule).filter(models.Schedule.id == 1).first()
        needs_sync = (
            db.query(models.Schedule).count() < 10
            or (sched_1 is not None and sched_1.course_name.startswith("COA:"))
        )
        if needs_sync:
            canonical_schedules = [
                {
                    "id": 1,
                    "course_name": "PYTHON",
                    "full_name": "Python Programming (BCC302)",
                    "course_type": "theory",
                    "room_or_lab": "Room 242 (Block-B)",
                    "faculty_name": "Er. Bhanu Pratap Singh",
                    "prof_id": faculty_by_email["bhanu@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "All",
                    "time_slot": "Mon 09:10-10:00, Wed 09:10-10:00, Thu 12:41-01:30, Fri 11:01-11:50",
                },
                {
                    "id": 2,
                    "course_name": "MATH-IV",
                    "full_name": "Math IV (BAS303)",
                    "course_type": "theory",
                    "room_or_lab": "Room 242 (Block-B)",
                    "faculty_name": "Dr. Ashish Kumar",
                    "prof_id": faculty_by_email["ashish@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "All",
                    "time_slot": "Mon 10:01-10:50, Tue 09:10-10:00, Wed 12:41-01:30, Thu 09:10-10:00, Fri 11:51-12:40",
                },
                {
                    "id": 3,
                    "course_name": "DS",
                    "full_name": "Data Structure (BCS301)",
                    "course_type": "theory",
                    "room_or_lab": "Room 242 (Block-B)",
                    "faculty_name": "Er. Richa Mishra",
                    "prof_id": faculty_by_email["richa@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "All",
                    "time_slot": "Mon 11:01-11:50, Tue 10:01-10:50, Wed 10:01-10:50, Thu 11:01-11:50, Fri 12:41-01:30",
                },
                {
                    "id": 4,
                    "course_name": "DSTL",
                    "full_name": "Discrete Structures & Theory of Logic (BCS303)",
                    "course_type": "theory",
                    "room_or_lab": "Room 242 (Block-B)",
                    "faculty_name": "Er. Gopal Singh",
                    "prof_id": faculty_by_email["gopal@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "All",
                    "time_slot": "Mon 11:51-12:40, Wed 11:51-12:40, Thu 11:51-12:40, Fri 09:10-10:00",
                },
                {
                    "id": 5,
                    "course_name": "COA",
                    "full_name": "Computer Organization & Architecture (BCS302)",
                    "course_type": "theory",
                    "room_or_lab": "Room 242 (Block-B)",
                    "faculty_name": "Er. Hitendra Kumar Prajapati",
                    "prof_id": faculty_by_email["hitendra@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "All",
                    "time_slot": "Tue 02:21-04:00, Wed 11:01-11:50, Thu 10:01-10:50, Fri 10:01-10:50",
                },
                {
                    "id": 6,
                    "course_name": "UHV",
                    "full_name": "Universal Human Values (BVE301)",
                    "course_type": "theory",
                    "room_or_lab": "Room 242 (Block-B)",
                    "faculty_name": "Dr. Bablu Kumar Jha",
                    "prof_id": faculty_by_email["bablu@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "All",
                    "time_slot": "Tue 04:01-04:50, Wed 02:21-03:10, Fri 04:01-04:50",
                },
                {
                    "id": 7,
                    "course_name": "Web Designing Workshop",
                    "full_name": "Web Designing Workshop Lab (BCS353)",
                    "course_type": "lab",
                    "room_or_lab": "Lab-11 (Room 321) / Lab-04",
                    "faculty_name": "Er. Gopal Singh",
                    "prof_id": faculty_by_email["gopal@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "G1: Tue 11:01-12:40 (Lab-11) | G2: Thu 02:21-04:00 (Lab-04)",
                    "time_slot": "Tue 11:01-12:40 (G1) / Thu 02:21-04:00 (G2)",
                },
                {
                    "id": 8,
                    "course_name": "Data Structure Lab",
                    "full_name": "Data Structure Lab (BCS351)",
                    "course_type": "lab",
                    "room_or_lab": "Lab-05",
                    "faculty_name": "Er. Richa Mishra",
                    "prof_id": faculty_by_email["richa@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "G1: Wed 03:11-04:50 (Lab-05) | G2: Fri 02:21-04:00 (Lab-05)",
                    "time_slot": "Wed 03:11-04:50 (G1) / Fri 02:21-04:00 (G2)",
                },
                {
                    "id": 9,
                    "course_name": "COA Lab",
                    "full_name": "Computer Organization & Architecture Lab (BCS352)",
                    "course_type": "lab",
                    "room_or_lab": "Lab-07 / Lab-03",
                    "faculty_name": "Er. Hitendra Kumar Prajapati",
                    "prof_id": faculty_by_email["hitendra@glbajaj.ac.in"].id,
                    "co_prof_id": None,
                    "target_group": "G2: Tue 11:01-12:40 (Lab-07) | G1: Thu 02:21-04:00 (Lab-03)",
                    "time_slot": "Tue 11:01-12:40 (G2) / Thu 02:21-04:00 (G1)",
                },
                {
                    "id": 10,
                    "course_name": "Mini Project Lab",
                    "full_name": "Internship Assessment / Mini Project Lab (BCC351)",
                    "course_type": "lab",
                    "room_or_lab": "Lab-06",
                    "faculty_name": "Er. Gopal Singh / Er. Hitendra Kumar Prajapati",
                    "prof_id": faculty_by_email["gopal@glbajaj.ac.in"].id,
                    "co_prof_id": faculty_by_email["hitendra@glbajaj.ac.in"].id,
                    "target_group": "G2: Wed 03:11-04:50 (Lab-06) | G1: Fri 02:21-04:00 (Lab-06)",
                    "time_slot": "Wed 03:11-04:50 (G2) / Fri 02:21-04:00 (G1)",
                },
            ]

            for item in canonical_schedules:
                existing = db.query(models.Schedule).filter(models.Schedule.id == item["id"]).first()
                if existing:
                    existing.course_name = item["course_name"]
                    existing.full_name = item["full_name"]
                    existing.course_type = item["course_type"]
                    existing.room_or_lab = item["room_or_lab"]
                    existing.faculty_name = item["faculty_name"]
                    existing.prof_id = item["prof_id"]
                    existing.co_prof_id = item["co_prof_id"]
                    existing.target_group = item["target_group"]
                    existing.time_slot = item["time_slot"]
                    existing.lat = 27.646560
                    existing.lng = 77.551925
                    existing.allowed_radius_m = 100.0
                else:
                    db.add(
                        models.Schedule(
                            id=item["id"],
                            course_name=item["course_name"],
                            full_name=item["full_name"],
                            course_type=item["course_type"],
                            room_or_lab=item["room_or_lab"],
                            faculty_name=item["faculty_name"],
                            prof_id=item["prof_id"],
                            co_prof_id=item["co_prof_id"],
                            target_group=item["target_group"],
                            time_slot=item["time_slot"],
                            lat=27.646560,
                            lng=77.551925,
                            allowed_radius_m=100.0,
                        )
                    )
            db.commit()
            print("[DB Seed] Synced 10 canonical GLBAJAJ schedules with subject faculty.")
    except Exception as e:
        print(f"[DB Seed Error] {e}")
    finally:
        db.close()


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def serialize_user(u: models.User) -> dict:
    has_face = bool(u.face_encoding and os.path.exists(u.face_encoding))
    face_url = None
    if has_face:
        mtime = int(os.path.getmtime(u.face_encoding))
        face_url = f"/users/{u.id}/face-photo?v={mtime}"
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "role": u.role,
        "is_admin": u.is_admin or "no",
        "enrollment_no": u.enrollment_no,
        "section": u.section,
        "group": u.group,
        "has_face_encoding": has_face,
        "face_url": face_url,
    }


@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def read_root():
    if os.path.exists(FRONTEND_FILE):
        with open(FRONTEND_FILE, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(
        content="<h1>College Attendance AI System is Live!</h1><p><a href='/docs'>Swagger API Docs</a></p>"
    )


@app.api_route("/api/health", methods=["GET", "HEAD"])
def api_health():
    return {"status": "success", "message": "The Attendance API is live!"}


# --- Admin-Only User Registration (Public self-signup disabled) ---
@app.post("/register", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def register_user(
    user: schemas.UserCreate,
    current_admin: models.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    existing_user = db.query(models.User).filter(models.User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email is already registered")

    if user.enrollment_no:
        existing_enroll = (
            db.query(models.User).filter(models.User.enrollment_no == user.enrollment_no).first()
        )
        if existing_enroll:
            raise HTTPException(
                status_code=400,
                detail=f"Enrollment number '{user.enrollment_no}' is already registered.",
            )

    if user.role not in ("student", "professor"):
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'student' or 'professor'.")

    new_user = models.User(
        name=user.name.strip(),
        email=user.email.strip().lower(),
        hashed_password=auth.get_password_hash(user.password),
        role=user.role,
        is_admin=user.is_admin if (user.role == "professor" and user.is_admin == "yes") else "no",
        enrollment_no=user.enrollment_no.strip() if user.enrollment_no else None,
        section=user.section or "H",
        group=user.group or ("G1" if user.role == "student" else "All"),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


# --- JSON Login Route (Email OR Enrollment No) ---
@app.post("/auth/login")
def auth_login(data: schemas.SimpleLogin, db: Session = Depends(get_db)):
    identifier = data.email.strip()
    user = (
        db.query(models.User)
        .filter((models.User.email == identifier.lower()) | (models.User.enrollment_no == identifier))
        .first()
    )

    if not user or not auth.verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials. Please check the Student ID / Email and password provided by faculty.",
        )

    access_token = auth.create_access_token(
        data={"sub": str(user.id), "role": user.role, "is_admin": user.is_admin or "no"},
        expires_delta=timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": serialize_user(user),
    }


@app.post("/login", response_model=schemas.Token)
def login_user(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    identifier = form_data.username.strip()
    user = (
        db.query(models.User)
        .filter((models.User.email == identifier.lower()) | (models.User.enrollment_no == identifier))
        .first()
    )
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email/ID or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_access_token(
        data={"sub": str(user.id), "role": user.role, "is_admin": user.is_admin or "no"},
        expires_delta=timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/auth/me")
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return serialize_user(current_user)


# --- Schedules ---
@app.post("/schedules", response_model=schemas.ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    schedule: schemas.ScheduleCreate,
    current_admin: models.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    assigned_prof_id = schedule.prof_id or current_admin.id
    assigned_prof = db.query(models.User).filter(
        models.User.id == assigned_prof_id, models.User.role == "professor"
    ).first()
    if not assigned_prof:
        raise HTTPException(status_code=400, detail="Assigned faculty member not found.")

    new_schedule = models.Schedule(
        course_name=schedule.course_name,
        full_name=schedule.full_name,
        course_type=schedule.course_type or "theory",
        room_or_lab=schedule.room_or_lab,
        faculty_name=schedule.faculty_name or assigned_prof.name,
        target_group=schedule.target_group or "All",
        time_slot=schedule.time_slot,
        lat=schedule.lat,
        lng=schedule.lng,
        allowed_radius_m=schedule.allowed_radius_m,
        prof_id=assigned_prof.id,
        co_prof_id=schedule.co_prof_id,
    )
    db.add(new_schedule)
    db.commit()
    db.refresh(new_schedule)
    return new_schedule


@app.put("/schedules/{schedule_id}/assign-faculty")
def assign_schedule_faculty(
    schedule_id: int,
    payload: schemas.ScheduleAssignFaculty,
    current_admin: models.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    schedule = db.query(models.Schedule).filter(models.Schedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    prof = db.query(models.User).filter(
        models.User.id == payload.prof_id, models.User.role == "professor"
    ).first()
    if not prof:
        raise HTTPException(status_code=404, detail="Selected faculty account not found")

    faculty_names = [prof.name]
    co_prof_id = None
    if payload.co_prof_id and payload.co_prof_id != prof.id:
        co_prof = db.query(models.User).filter(
            models.User.id == payload.co_prof_id, models.User.role == "professor"
        ).first()
        if not co_prof:
            raise HTTPException(status_code=404, detail="Co-faculty account not found")
        co_prof_id = co_prof.id
        faculty_names.append(co_prof.name)

    schedule.prof_id = prof.id
    schedule.co_prof_id = co_prof_id
    schedule.faculty_name = " / ".join(faculty_names)
    db.commit()
    db.refresh(schedule)
    return {
        "status": "success",
        "message": f"Assigned '{schedule.course_name}' to {schedule.faculty_name}.",
        "schedule_id": schedule.id,
        "prof_id": schedule.prof_id,
        "co_prof_id": schedule.co_prof_id,
        "faculty_name": schedule.faculty_name,
    }


@app.get("/schedules", response_model=list[schemas.ScheduleResponse])
def get_schedules(db: Session = Depends(get_db)):
    return db.query(models.Schedule).order_by(models.Schedule.id.asc()).all()


# --- Face Recognition AI Setup (YuNet + SFace) ---
YUNET_PATH = os.path.join(BASE_DIR, "yunet_face.onnx")
SFACE_PATH = os.path.join(BASE_DIR, "sface.onnx")

face_detector = None
face_recognizer = None


def get_face_ai():
    global face_detector, face_recognizer
    if face_detector is None and os.path.exists(YUNET_PATH):
        try:
            face_detector = cv2.FaceDetectorYN.create(
                model=YUNET_PATH,
                config="",
                input_size=(320, 320),
                score_threshold=0.6,
                nms_threshold=0.3,
                top_k=5000,
            )
        except Exception as e:
            print("[Face AI Error] Could not load FaceDetectorYN:", e)
    if face_recognizer is None and os.path.exists(SFACE_PATH):
        try:
            face_recognizer = cv2.FaceRecognizerSF.create(model=SFACE_PATH, config="")
        except Exception as e:
            print("[Face AI Error] Could not load FaceRecognizerSF:", e)
    return face_detector, face_recognizer


def validate_face_image(img, require_sharpness=False):
    """
    Validates that an image contains exactly one clear, front-facing human face.
    Returns: (is_valid: bool, face_box_or_None, message: str)
    """
    detector, _ = get_face_ai()
    if detector is None:
        return (False, None, "Face recognition AI models not available on server.")

    if img is None or img.size == 0:
        return (False, None, "Could not decode image file.")

    h, w = img.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)

    if faces is None or len(faces) == 0:
        return (False, None, "No face detected in camera! Please look directly into the camera inside the guide box.")

    if len(faces) > 1:
        return (False, None, f"Multiple faces ({len(faces)}) detected! Only one person is allowed in frame.")

    face = faces[0]
    face_w, face_h = float(face[2]), float(face[3])
    confidence = float(face[14])

    if confidence < 0.75:
        return (False, None, "Face not clear enough. Please improve lighting and look straight at the camera.")

    if face_w < 60 or face_h < 60:
        return (False, None, "Face is too far from the camera. Please move closer so your face fills the guide box.")

    if require_sharpness:
        x1 = max(0, int(face[0]))
        y1 = max(0, int(face[1]))
        x2 = min(w, int(face[0] + face_w))
        y2 = min(h, int(face[1] + face_h))
        face_crop = img[y1:y2, x1:x2]
        if face_crop.size > 0:
            gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
            if sharpness < 25.0:
                return (False, None, "Photo is too blurry. Please hold still in good lighting and try again.")

    return (True, face, "Valid face detected.")


def process_face_verification(live_img, ref_img):
    """
    Analyzes live_img and ref_img using deep neural models (YuNet + SFace).
    Returns: (is_verified: bool, score: float, message: str, face_detected: bool)
    """
    detector, recognizer = get_face_ai()
    if detector is None or recognizer is None:
        return (False, 0.0, "Face recognition AI models not available on server.", False)

    live_ok, primary_live_face, live_msg = validate_face_image(live_img, require_sharpness=False)
    if not live_ok:
        return (False, 0.0, live_msg, False)

    ref_ok, primary_ref_face, _ = validate_face_image(ref_img, require_sharpness=False)
    if not ref_ok:
        return (False, 0.0, "Enrolled reference image does not have a valid clear face. Please re-enroll face.", True)

    aligned_live = recognizer.alignCrop(live_img, primary_live_face)
    aligned_ref = recognizer.alignCrop(ref_img, primary_ref_face)

    feat_live = recognizer.feature(aligned_live)
    feat_ref = recognizer.feature(aligned_ref)

    raw_sim = float(recognizer.match(feat_live, feat_ref, cv2.FaceRecognizerSF_FR_COSINE))
    l2_dist = float(recognizer.match(feat_live, feat_ref, cv2.FaceRecognizerSF_FR_NORM_L2))

    MATCH_COSINE_THRESHOLD = 0.45
    MATCH_L2_THRESHOLD = 1.05
    is_match = bool(raw_sim >= MATCH_COSINE_THRESHOLD and l2_dist <= MATCH_L2_THRESHOLD)

    display_score = round(max(0.0, min(1.0, raw_sim)), 2)

    if not is_match:
        return (
            False,
            display_score,
            f"Face verification failed! Live face does not match enrolled baseline (Match score: {int(display_score * 100)}%).",
            True,
        )

    return (
        True,
        display_score,
        f"Face verified successfully ({int(display_score * 100)}% biometric match)!",
        True,
    )


# --- Protected Face Photo Serving (Coordinator/HOD or Student Self Only) ---
@app.get("/users/{user_id}/face-photo")
def get_user_face_photo(
    user_id: int,
    token: Optional[str] = Query(default=None),
    header_token: Optional[str] = Depends(auth.oauth2_scheme),
    db: Session = Depends(get_db),
):
    effective_token = header_token or token
    current_user = auth.decode_token_user(effective_token, db)
    if current_user.is_admin != "yes" and current_user.id != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only Coordinator/HOD or the student themselves can view this face photo.",
        )

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.face_encoding or not os.path.exists(user.face_encoding):
        raise HTTPException(status_code=404, detail="Face photo not found.")

    return FileResponse(user.face_encoding, media_type="image/jpeg")


# --- Upload Face Reference Route (Coordinator / HOD Only) ---
@app.post("/users/{user_id}/upload-face", status_code=status.HTTP_200_OK)
async def upload_face(
    user_id: int,
    file: UploadFile = File(...),
    current_admin: models.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    temp_path = os.path.join(UPLOAD_DIR, f"temp_enroll_{user_id}.jpg")
    try:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            return {"status": "error", "message": "User not found"}

        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        img = cv2.imread(temp_path)
        if img is None:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return {"status": "error", "message": "Could not decode image file."}

        is_valid, _, val_msg = validate_face_image(img, require_sharpness=True)
        if not is_valid:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return {"status": "error", "message": val_msg}

        file_path = os.path.join(UPLOAD_DIR, f"user_{user_id}.jpg")
        shutil.move(temp_path, file_path)

        user.face_encoding = file_path
        db.commit()

        mtime = int(os.path.getmtime(file_path))
        return {
            "status": "success",
            "message": f"Accurate face baseline saved to local storage for {user.name}!",
            "file_path": file_path,
            "face_url": f"/users/{user_id}/face-photo?v={mtime}",
        }
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return {"status": "error", "message": str(e)}


# --- Enroll New Student + Face + Shareable Credentials (Coordinator / HOD Only) ---
@app.post("/students/enroll-with-face", status_code=status.HTTP_201_CREATED)
async def enroll_student_with_face(
    name: str,
    enrollment_no: str = "",
    email: str = "",
    section: str = "H",
    group: str = "G1",
    password: str = "",
    file: UploadFile = File(...),
    current_admin: models.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    clean_name = name.strip()
    if not clean_name:
        return {"status": "error", "message": "Student name is required."}

    clean_enroll = enrollment_no.strip() or None
    if clean_enroll:
        existing_enroll = (
            db.query(models.User).filter(models.User.enrollment_no == clean_enroll).first()
        )
        if existing_enroll:
            return {"status": "error", "message": f"Enrollment number '{clean_enroll}' already exists."}

    clean_email = email.strip().lower()
    if not clean_email:
        slug = "".join(c.lower() for c in (clean_enroll or clean_name) if c.isalnum())
        clean_email = f"{slug}_{int(datetime.utcnow().timestamp())}@glbajaj.ac.in"

    existing_email = db.query(models.User).filter(models.User.email == clean_email).first()
    if existing_email:
        return {"status": "error", "message": f"Email '{clean_email}' is already registered."}

    raw_password = password.strip() if password and password.strip() else generate_temp_password(8)
    if len(raw_password) < 4:
        return {"status": "error", "message": "Password must be at least 4 characters long."}

    temp_path = os.path.join(UPLOAD_DIR, f"temp_new_{int(datetime.utcnow().timestamp() * 1000)}.jpg")
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        img = cv2.imread(temp_path)
        is_valid, _, val_msg = validate_face_image(img, require_sharpness=True)
        if not is_valid:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return {"status": "error", "message": val_msg}

        new_user = models.User(
            name=clean_name,
            email=clean_email,
            hashed_password=auth.get_password_hash(raw_password),
            role="student",
            is_admin="no",
            enrollment_no=clean_enroll,
            section=section or "H",
            group=group or "G1",
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        file_path = os.path.join(UPLOAD_DIR, f"user_{new_user.id}.jpg")
        shutil.move(temp_path, file_path)
        new_user.face_encoding = file_path
        db.commit()
        db.refresh(new_user)

        return {
            "status": "success",
            "message": f"Student '{new_user.name}' created and face saved to local storage!",
            "student": serialize_user(new_user),
            "credentials": {
                "login_id": new_user.enrollment_no or new_user.email,
                "email": new_user.email,
                "enrollment_no": new_user.enrollment_no,
                "initial_password": raw_password,
            },
        }
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        db.rollback()
        return {"status": "error", "message": str(e)}


# --- Reset User Password (Coordinator / HOD Only) ---
@app.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    payload: schemas.PasswordResetRequest = schemas.PasswordResetRequest(),
    current_admin: models.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    new_pwd = (
        payload.new_password.strip()
        if payload.new_password and payload.new_password.strip()
        else generate_temp_password(8)
    )
    if len(new_pwd) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    target.hashed_password = auth.get_password_hash(new_pwd)
    db.commit()
    return {
        "status": "success",
        "message": f"Password updated for {target.name}. Share the new credentials securely.",
        "credentials": {
            "login_id": target.enrollment_no or target.email,
            "email": target.email,
            "enrollment_no": target.enrollment_no,
            "new_password": new_pwd,
        },
    }


# --- Delete Student / User (Coordinator / HOD Only) ---
@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_admin: models.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    if current_admin.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.face_encoding and os.path.exists(user.face_encoding):
        try:
            os.remove(user.face_encoding)
        except Exception:
            pass
    db.query(models.Attendance).filter(models.Attendance.student_id == user_id).delete()
    db.delete(user)
    db.commit()
    return {"status": "success", "message": f"Removed '{user.name}' and their stored face photo."}


# --- Face Verification Test Endpoint (Authenticated) ---
@app.post("/attendance/verify-face/{user_id}")
async def verify_student_face(
    user_id: int,
    file: UploadFile = File(...),
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "professor" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Students can only verify their own face.")

    temp_selfie_path = os.path.join(UPLOAD_DIR, f"temp_{user_id}.jpg")
    try:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user or not user.face_encoding:
            return {"status": "error", "message": "Student or baseline face reference not enrolled"}

        if not os.path.exists(user.face_encoding):
            return {"status": "error", "message": "Reference image file missing on server disk"}

        with open(temp_selfie_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        img_ref = cv2.imread(user.face_encoding)
        img_live = cv2.imread(temp_selfie_path)

        if os.path.exists(temp_selfie_path):
            os.remove(temp_selfie_path)

        if img_ref is None or img_live is None:
            return {"status": "error", "message": "Could not decode image files."}

        is_verified, score, msg, face_detected = process_face_verification(img_live, img_ref)

        return {
            "status": "success" if is_verified else "failed",
            "message": msg,
            "verified": is_verified,
            "face_detected": face_detected,
            "similarity_score": score,
        }
    except Exception as e:
        if os.path.exists(temp_selfie_path):
            os.remove(temp_selfie_path)
        return {"status": "error", "message": str(e)}


# --- Unified Check-In Route (JWT + Session Lock + Geofence + Deep Learning Face AI) ---
@app.post("/attendance/unified-check-in", status_code=status.HTTP_201_CREATED)
async def unified_check_in(
    schedule_id: int,
    lat: float,
    lng: float,
    student_id: Optional[int] = None,
    require_active_session: bool = True,
    file: UploadFile = File(...),
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    temp_selfie_path = None
    try:
        schedule = db.query(models.Schedule).filter(models.Schedule.id == schedule_id).first()
        if not schedule:
            raise HTTPException(status_code=404, detail="Schedule not found")

        # Students can ONLY check in for themselves and MUST have an active open session
        if current_user.role == "student":
            target_student_id = current_user.id
            effective_require_session = True
        else:
            if not can_manage_schedule(current_user, schedule):
                raise HTTPException(
                    status_code=403,
                    detail=f"Access denied: '{schedule.course_name}' is assigned to {schedule.faculty_name or 'another teacher'}.",
                )
            if not student_id:
                raise HTTPException(status_code=400, detail="student_id is required for faculty check-in.")
            target_student_id = student_id
            effective_require_session = require_active_session

        user = db.query(models.User).filter(models.User.id == target_student_id).first()
        if not user or user.role != "student":
            return {"status": "error", "message": "Student record not found"}

        if not user.face_encoding or not os.path.exists(user.face_encoding):
            return {
                "status": "failed",
                "message": f"Student '{user.name}' has no face baseline registered. Ask faculty to register face in 'Face Enrollment' first.",
                "face_detected": False,
                "similarity_score": 0.0,
            }

        active_session = (
            db.query(models.AttendanceSession)
            .filter(
                models.AttendanceSession.schedule_id == schedule_id,
                models.AttendanceSession.is_active == "yes",
            )
            .first()
        )
        if effective_require_session and not active_session:
            return {
                "status": "failed",
                "message": f"Attendance session for '{schedule.course_name}' is not currently open.",
                "face_detected": False,
                "similarity_score": 0.0,
            }

        # 1. Geofence Radar Check (uses teacher's session anchor/radius or bypass mode)
        target_lat = (
            active_session.session_lat
            if (active_session and active_session.session_lat is not None)
            else schedule.lat
        )
        target_lng = (
            active_session.session_lng
            if (active_session and active_session.session_lng is not None)
            else schedule.lng
        )
        target_radius = (
            active_session.allowed_radius_m
            if (active_session and active_session.allowed_radius_m is not None)
            else schedule.allowed_radius_m
        )
        skip_geofence = bool(active_session and active_session.bypass_geofence == "yes")

        distance = calculate_distance(lat, lng, target_lat, target_lng)
        if not skip_geofence and distance > target_radius:
            return {
                "status": "failed",
                "message": f"Geofence radar failed! You are {round(distance, 1)}m away from the teacher's active class zone (Allowed: {int(target_radius)}m).",
                "distance_meters": round(distance, 1),
                "face_detected": False,
            }

        # 2. Duplicate Check-In Prevention (scoped to active session if open, else IST day)
        if active_session:
            existing_att = (
                db.query(models.Attendance)
                .filter(
                    models.Attendance.student_id == target_student_id,
                    models.Attendance.session_id == active_session.id,
                )
                .first()
            )
        else:
            ist_now = datetime.now(IST)
            ist_day_start_utc = (
                ist_now.replace(hour=0, minute=0, second=0, microsecond=0)
                .astimezone(timezone.utc)
                .replace(tzinfo=None)
            )
            existing_att = (
                db.query(models.Attendance)
                .filter(
                    models.Attendance.student_id == target_student_id,
                    models.Attendance.schedule_id == schedule_id,
                    models.Attendance.timestamp >= ist_day_start_utc,
                )
                .first()
            )

        if existing_att:
            return {
                "status": "already_marked",
                "message": f"Attendance is already marked Present for this session (at {to_ist_str(existing_att.timestamp)}).",
                "distance_meters": round(distance, 1),
                "similarity_score": 1.0,
                "face_detected": True,
            }

        # 3. AI Biometric Face Detection & SFace Verification
        temp_selfie_path = os.path.join(UPLOAD_DIR, f"temp_checkin_{target_student_id}_{int(datetime.utcnow().timestamp()*1000)}.jpg")
        with open(temp_selfie_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        img_ref = cv2.imread(user.face_encoding)
        img_live = cv2.imread(temp_selfie_path)

        if os.path.exists(temp_selfie_path):
            os.remove(temp_selfie_path)
            temp_selfie_path = None

        if img_ref is None or img_live is None:
            return {"status": "error", "message": "Could not decode uploaded camera image."}

        is_verified, score, msg, face_detected = process_face_verification(img_live, img_ref)

        if not face_detected:
            return {
                "status": "failed",
                "message": msg,
                "face_detected": False,
                "similarity_score": 0.0,
                "distance_meters": round(distance, 1),
            }

        if not is_verified:
            return {
                "status": "failed",
                "message": msg,
                "face_detected": True,
                "similarity_score": score,
                "distance_meters": round(distance, 1),
            }

        # 4. Success: Record attendance tied to session
        new_attendance = models.Attendance(
            student_id=target_student_id,
            schedule_id=schedule_id,
            session_id=active_session.id if active_session else None,
            status="Present",
        )
        db.add(new_attendance)
        db.commit()
        db.refresh(new_attendance)

        return {
            "status": "success",
            "message": f"Biometric Verified ({int(score * 100)}% match)! Attendance recorded Present for {user.name}.",
            "distance_meters": round(distance, 1),
            "similarity_score": score,
            "face_detected": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        if temp_selfie_path and os.path.exists(temp_selfie_path):
            os.remove(temp_selfie_path)
        return {"status": "error", "message": str(e)}


# --- Attendance Logs Endpoint (Scoped by Role & Assigned Subject) ---
@app.get("/attendance")
def get_attendance_logs(
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(models.Attendance)
    if current_user.role != "professor":
        query = query.filter(models.Attendance.student_id == current_user.id)
    elif current_user.is_admin != "yes":
        query = query.join(
            models.Schedule, models.Attendance.schedule_id == models.Schedule.id
        ).filter(
            (models.Schedule.prof_id == current_user.id)
            | (models.Schedule.co_prof_id == current_user.id)
        )
    records = query.order_by(models.Attendance.timestamp.desc()).all()

    result = []
    for r in records:
        student_name = r.student.name if r.student else f"Student #{r.student_id}"
        enrollment_no = r.student.enrollment_no if r.student else None
        course_name = r.schedule.course_name if r.schedule else f"Schedule #{r.schedule_id}"
        result.append(
            {
                "id": r.id,
                "student_id": r.student_id,
                "student_name": student_name,
                "enrollment_no": enrollment_no,
                "schedule_id": r.schedule_id,
                "session_id": r.session_id,
                "course_name": course_name,
                "timestamp": to_ist_str(r.timestamp),
                "status": r.status,
            }
        )
    return result


# --- Users & Faculty Directory (Faculty Only) ---
@app.get("/users")
def get_users(
    current_prof: models.User = Depends(auth.get_current_professor),
    db: Session = Depends(get_db),
):
    users = db.query(models.User).order_by(models.User.id.asc()).all()
    return [serialize_user(u) for u in users]


@app.get("/faculty")
def get_faculty_list(
    current_prof: models.User = Depends(auth.get_current_professor),
    db: Session = Depends(get_db),
):
    faculty = (
        db.query(models.User)
        .filter(models.User.role == "professor")
        .order_by(models.User.id.asc())
        .all()
    )
    return [serialize_user(f) for f in faculty]


# ============================================================
#  ATTENDANCE SESSION MANAGEMENT (Subject-Teacher Locked)
# ============================================================


@app.post("/sessions/open")
def open_attendance_session(
    schedule_id: int,
    allow_demo_gps: bool = False,
    bypass_geofence: bool = False,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_m: Optional[float] = None,
    current_prof: models.User = Depends(auth.get_current_professor),
    db: Session = Depends(get_db),
):
    """Assigned subject professor (or Coordinator Admin) opens attendance for a class."""
    schedule = db.query(models.Schedule).filter(models.Schedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if not can_manage_schedule(current_prof, schedule):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: '{schedule.course_name}' is assigned to {schedule.faculty_name or 'another faculty member'}.",
        )

    existing = (
        db.query(models.AttendanceSession)
        .filter(
            models.AttendanceSession.schedule_id == schedule_id,
            models.AttendanceSession.is_active == "yes",
        )
        .first()
    )
    if existing:
        return {
            "status": "already_open",
            "message": f"Attendance for '{schedule.course_name}' is already open.",
            "session_id": existing.id,
        }

    effective_lat = lat if lat is not None else schedule.lat
    effective_lng = lng if lng is not None else schedule.lng
    effective_radius = max(20.0, min(5000.0, float(radius_m))) if radius_m is not None else schedule.allowed_radius_m

    session = models.AttendanceSession(
        schedule_id=schedule_id,
        opened_by=current_prof.id,
        allow_demo_gps="yes" if allow_demo_gps else "no",
        session_lat=effective_lat,
        session_lng=effective_lng,
        allowed_radius_m=effective_radius,
        bypass_geofence="yes" if bypass_geofence else "no",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {
        "status": "opened",
        "message": f"Attendance OPENED for '{schedule.course_name}'",
        "session_id": session.id,
        "schedule_id": schedule_id,
        "course_name": schedule.course_name,
        "opened_at": to_ist_str(session.opened_at),
        "allow_demo_gps": session.allow_demo_gps == "yes",
        "bypass_geofence": session.bypass_geofence == "yes",
        "lat": effective_lat,
        "lng": effective_lng,
        "allowed_radius_m": effective_radius,
    }


@app.post("/sessions/close")
def close_attendance_session(
    schedule_id: int,
    current_prof: models.User = Depends(auth.get_current_professor),
    db: Session = Depends(get_db),
):
    """Assigned subject professor (or Coordinator Admin) closes attendance for a class."""
    schedule = db.query(models.Schedule).filter(models.Schedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if not can_manage_schedule(current_prof, schedule):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: '{schedule.course_name}' is assigned to {schedule.faculty_name or 'another faculty member'}.",
        )

    session = (
        db.query(models.AttendanceSession)
        .filter(
            models.AttendanceSession.schedule_id == schedule_id,
            models.AttendanceSession.is_active == "yes",
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="No active session found for this class")

    session.is_active = "no"
    session.closed_at = datetime.utcnow()
    db.commit()
    return {
        "status": "closed",
        "message": f"Attendance CLOSED for '{schedule.course_name}'",
        "closed_at": to_ist_str(session.closed_at),
    }


@app.get("/sessions/active")
def get_active_sessions(
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Returns all currently open attendance sessions for authenticated users."""
    sessions = (
        db.query(models.AttendanceSession)
        .filter(models.AttendanceSession.is_active == "yes")
        .all()
    )
    result = []
    for s in sessions:
        schedule = s.schedule
        prof = s.professor
        result.append(
            {
                "session_id": s.id,
                "schedule_id": s.schedule_id,
                "course_name": schedule.course_name if schedule else f"Schedule #{s.schedule_id}",
                "full_name": schedule.full_name if schedule else "",
                "course_type": schedule.course_type if schedule else "theory",
                "room_or_lab": schedule.room_or_lab if schedule else "",
                "faculty_name": schedule.faculty_name if schedule else "",
                "target_group": schedule.target_group if schedule else "All",
                "time_slot": schedule.time_slot if schedule else "",
                "opened_by_name": prof.name if prof else f"Professor #{s.opened_by}",
                "opened_at": to_ist_str(s.opened_at),
                "lat": s.session_lat if s.session_lat is not None else (schedule.lat if schedule else None),
                "lng": s.session_lng if s.session_lng is not None else (schedule.lng if schedule else None),
                "allowed_radius_m": (
                    s.allowed_radius_m
                    if s.allowed_radius_m is not None
                    else (schedule.allowed_radius_m if schedule else 100.0)
                ),
                "allow_demo_gps": (s.allow_demo_gps == "yes"),
                "bypass_geofence": (s.bypass_geofence == "yes"),
            }
        )
    return result


@app.get("/sessions/history")
def get_session_history(
    current_prof: models.User = Depends(auth.get_current_professor),
    db: Session = Depends(get_db),
):
    """Returns session audit logs (all for Coordinator/HOD, assigned subjects only for faculty)."""
    query = db.query(models.AttendanceSession)
    if current_prof.is_admin != "yes":
        query = query.join(
            models.Schedule, models.AttendanceSession.schedule_id == models.Schedule.id
        ).filter(
            (models.Schedule.prof_id == current_prof.id)
            | (models.Schedule.co_prof_id == current_prof.id)
        )
    sessions = query.order_by(models.AttendanceSession.opened_at.desc()).all()
    result = []
    for s in sessions:
        schedule = s.schedule
        prof = s.professor
        result.append(
            {
                "session_id": s.id,
                "schedule_id": s.schedule_id,
                "course_name": schedule.course_name if schedule else f"Schedule #{s.schedule_id}",
                "opened_by_name": prof.name if prof else f"Professor #{s.opened_by}",
                "opened_at": to_ist_str(s.opened_at),
                "closed_at": to_ist_str(s.closed_at),
                "is_active": s.is_active,
                "allow_demo_gps": (s.allow_demo_gps == "yes"),
            }
        )
    return result
