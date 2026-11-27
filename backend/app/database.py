import os
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger("uvicorn")

# Anchor SQLite database to project root so running from root or backend/ uses the same DB.
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_DB_PATH = os.path.join(PROJECT_ROOT, "attendance.db")
DEFAULT_SQLITE_URL = f"sqlite:///{DEFAULT_DB_PATH}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)


def get_engine():
    if DATABASE_URL.startswith("sqlite"):
        return create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

    # Try PostgreSQL or remote database with timeout
    try:
        eng = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"connect_timeout": 5})
        with eng.connect():
            pass
        print("[DB] Connected to remote database.")
        return eng
    except Exception as e:
        print(f"[DB Warning] Could not connect to {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL}: {e}")
        print("[DB Notice] Falling back to local SQLite database (attendance.db).")
        return create_engine(DEFAULT_SQLITE_URL, connect_args={"check_same_thread": False})


engine = get_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
