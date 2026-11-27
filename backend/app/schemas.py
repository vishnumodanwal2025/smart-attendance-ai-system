from pydantic import BaseModel, EmailStr
from typing import Optional


class Token(BaseModel):
    access_token: str
    token_type: str


class SimpleLogin(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str = "student"
    is_admin: Optional[str] = "no"
    enrollment_no: Optional[str] = None
    section: Optional[str] = None
    group: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    is_admin: Optional[str] = "no"
    enrollment_no: Optional[str] = None
    section: Optional[str] = None
    group: Optional[str] = None

    class Config:
        from_attributes = True


class PasswordResetRequest(BaseModel):
    new_password: Optional[str] = None


class ScheduleCreate(BaseModel):
    course_name: str
    lat: float
    lng: float
    allowed_radius_m: float = 100.0
    full_name: Optional[str] = None
    course_type: Optional[str] = "theory"
    room_or_lab: Optional[str] = None
    faculty_name: Optional[str] = None
    target_group: Optional[str] = "All"
    time_slot: Optional[str] = None
    prof_id: Optional[int] = None
    co_prof_id: Optional[int] = None


class ScheduleAssignFaculty(BaseModel):
    prof_id: int
    co_prof_id: Optional[int] = None


class ScheduleResponse(ScheduleCreate):
    id: int
    prof_id: int
    co_prof_id: Optional[int] = None

    class Config:
        from_attributes = True
