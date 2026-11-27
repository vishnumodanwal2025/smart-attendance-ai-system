import React from 'react';
import { ShieldCheck, Clock, Camera, Calendar, FileText } from 'lucide-react';

export default function TabNav({ activeTab, setActiveTab, currentUser }) {
  const isFaculty = currentUser?.role === 'professor';
  const isCoordinator = isFaculty && currentUser?.is_admin === 'yes';

  return (
    <nav className="tab-nav">
      <button
        className={`nav-tab-btn ${activeTab === 'checkin' ? 'active' : ''}`}
        id="tabBtn-checkin"
        onClick={() => setActiveTab('checkin')}
      >
        <ShieldCheck size={16} />
        Live Check-In
      </button>

      {isFaculty && (
        <button
          className={`nav-tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
          id="tabBtn-sessions"
          onClick={() => setActiveTab('sessions')}
        >
          <Clock size={16} />
          Manage Attendance
        </button>
      )}

      {isCoordinator && (
        <button
          className={`nav-tab-btn ${activeTab === 'enroll' ? 'active' : ''}`}
          id="tabBtn-enroll"
          onClick={() => setActiveTab('enroll')}
        >
          <Camera size={16} />
          Face Enrollment
        </button>
      )}

      <button
        className={`nav-tab-btn ${activeTab === 'schedules' ? 'active' : ''}`}
        id="tabBtn-schedules"
        onClick={() => setActiveTab('schedules')}
      >
        <Calendar size={16} />
        Class Timetable &amp; Labs
      </button>

      <button
        className={`nav-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
        id="tabBtn-history"
        onClick={() => setActiveTab('history')}
      >
        <FileText size={16} />
        Attendance Logs
      </button>
    </nav>
  );
}
