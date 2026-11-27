import React, { useState, useEffect, useCallback } from 'react';
import './index.css';

import { API_BASE, STATIC_SCHEDULE_DATA } from './constants/scheduleData';
import AuthOverlay from './components/AuthOverlay';
import Topbar from './components/Topbar';
import TabNav from './components/TabNav';
import LiveCheckinPanel from './components/LiveCheckinPanel';
import ManageSessionsPanel from './components/ManageSessionsPanel';
import FaceEnrollmentPanel from './components/FaceEnrollmentPanel';
import TimetablePanel from './components/TimetablePanel';
import AttendanceLogsPanel from './components/AttendanceLogsPanel';
import Toast from './components/Toast';

export default function App() {
  const [authToken, setAuthToken] = useState(() => {
    try {
      return localStorage.getItem('glbajaj_token') || null;
    } catch {
      return null;
    }
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(() => Boolean(localStorage.getItem('glbajaj_token')));

  const [activeTab, setActiveTab] = useState('checkin');
  const [backendOnline, setBackendOnline] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  const [availableSchedules, setAvailableSchedules] = useState(STATIC_SCHEDULE_DATA);
  const [enrolledStudents, setEnrolledStudents] = useState([]);
  const [facultyList, setFacultyList] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [toast, setToast] = useState({ show: false, type: 'info', message: '' });

  const showToast = useCallback((type, message) => {
    setToast({ show: true, type, message });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, 3800);
  }, []);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    setCurrentUser(null);
    setEnrolledStudents([]);
    setFacultyList([]);
    setActiveSessions([]);
    setAttendanceLogs([]);
    document.body.classList.remove('role-student', 'role-professor');
    try {
      localStorage.removeItem('glbajaj_token');
      localStorage.removeItem('glbajaj_user');
    } catch {}
  }, []);

  const authFetch = useCallback(
    async (path, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (authToken) {
        headers.set('Authorization', `Bearer ${authToken}`);
      }
      const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      if (res.status === 401 && authToken) {
        clearSession();
        showToast('warning', 'Session expired. Please sign in again.');
      }
      return res;
    },
    [authToken, clearSession, showToast]
  );

  // Validate stored JWT token on mount
  useEffect(() => {
    let cancelled = false;
    const verifyToken = async () => {
      if (!authToken) {
        setAuthChecking(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!cancelled && res.ok) {
          const user = await res.json();
          setCurrentUser(user);
          document.body.classList.remove('role-student', 'role-professor');
          document.body.classList.add('role-' + user.role);
        } else if (!cancelled) {
          clearSession();
        }
      } catch {
        // Keep token if backend temporarily unreachable; don't trust unverified localStorage role
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    };
    verifyToken();
    return () => {
      cancelled = true;
    };
  }, [authToken, clearSession]);

  // Check backend health
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`, {
        signal: AbortSignal.timeout(4000)
      });
      setBackendOnline(res.ok);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const timer = setInterval(checkHealth, 15000);
    return () => clearInterval(timer);
  }, [checkHealth]);

  // Load schedules (authoritative backend data merged with UI color/icon)
  const loadSchedules = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/schedules`);
      if (res.ok) {
        const backendData = await res.json();
        const merged = backendData.map((b) => {
          const uiMeta = STATIC_SCHEDULE_DATA.find((st) => st.id === b.id);
          return uiMeta ? { ...uiMeta, ...b } : b;
        });
        if (merged.length > 0) setAvailableSchedules(merged);
      }
    } catch {
      setAvailableSchedules(STATIC_SCHEDULE_DATA);
    }
  }, []);

  // Load students & faculty (Professor only)
  const loadUsers = useCallback(async () => {
    if (!currentUser || currentUser.role !== 'professor') return;
    try {
      const [resUsers, resFaculty] = await Promise.all([
        authFetch('/users'),
        authFetch('/faculty')
      ]);
      if (resUsers.ok) {
        const users = await resUsers.json();
        setEnrolledStudents(users.filter((u) => u.role === 'student'));
      }
      if (resFaculty.ok) {
        const fac = await resFaculty.json();
        setFacultyList(Array.isArray(fac) ? fac : []);
      }
    } catch {
      setEnrolledStudents([]);
    }
  }, [currentUser, authFetch]);

  // Load active sessions (Authenticated)
  const loadActiveSessions = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await authFetch('/sessions/active');
      if (res.ok) {
        const data = await res.json();
        setActiveSessions(Array.isArray(data) ? data : []);
      }
    } catch {
      setActiveSessions([]);
    }
  }, [authToken, authFetch]);

  // Load attendance logs (Authenticated, scoped by role on backend)
  const loadAttendanceLogs = useCallback(async () => {
    if (!authToken) return;
    setLoadingLogs(true);
    try {
      const res = await authFetch('/attendance');
      if (res.ok) {
        const logs = await res.json();
        setAttendanceLogs(Array.isArray(logs) ? logs : []);
      }
    } catch {
      setAttendanceLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [authToken, authFetch]);

  useEffect(() => {
    if (currentUser && authToken) {
      loadSchedules();
      loadUsers();
      loadActiveSessions();
      loadAttendanceLogs();

      let sessionPollTimer = null;
      if (currentUser.role === 'student') {
        sessionPollTimer = setInterval(loadActiveSessions, 10000);
      }
      return () => {
        if (sessionPollTimer) clearInterval(sessionPollTimer);
      };
    }
  }, [currentUser, authToken, loadSchedules, loadUsers, loadActiveSessions, loadAttendanceLogs]);

  const handleLoginSuccess = (user, token) => {
    setAuthToken(token);
    setCurrentUser(user);
    document.body.classList.remove('role-student', 'role-professor');
    document.body.classList.add('role-' + user.role);
    try {
      localStorage.setItem('glbajaj_token', token);
    } catch {}
    setActiveTab('checkin');
  };

  const handleLogout = () => {
    clearSession();
    showToast('info', 'Logged out.');
  };

  if (authChecking) {
    return (
      <div id="loginOverlay" style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
        Verifying session...
      </div>
    );
  }

  return (
    <>
      {!currentUser ? (
        <AuthOverlay
          onLoginSuccess={handleLoginSuccess}
          showToast={showToast}
        />
      ) : (
        <div id="appShell" className="visible">
          <Topbar
            backendOnline={backendOnline}
            cameraActive={cameraActive}
            currentUser={currentUser}
            onLogout={handleLogout}
          />

          <TabNav
            activeTab={activeTab}
            currentUser={currentUser}
            setActiveTab={(tab) => {
              if (tab === 'sessions' && currentUser.role !== 'professor') return;
              if (tab === 'enroll' && !(currentUser.role === 'professor' && currentUser.is_admin === 'yes')) return;
              setActiveTab(tab);
            }}
          />

          <main className="app-main-content">
            {activeTab === 'checkin' && (
              <LiveCheckinPanel
                currentUser={currentUser}
                authFetch={authFetch}
                activeSessions={activeSessions}
                availableSchedules={availableSchedules}
                enrolledStudents={enrolledStudents}
                onRefreshSessions={loadActiveSessions}
                onAttendanceMarked={loadAttendanceLogs}
                showToast={showToast}
                setCameraActive={setCameraActive}
              />
            )}

            {activeTab === 'sessions' && currentUser.role === 'professor' && (
              <ManageSessionsPanel
                currentUser={currentUser}
                authFetch={authFetch}
                availableSchedules={availableSchedules}
                facultyList={facultyList}
                showToast={showToast}
                onSessionUpdated={loadActiveSessions}
                onSchedulesUpdated={loadSchedules}
              />
            )}

            {activeTab === 'enroll' && currentUser.role === 'professor' && currentUser.is_admin === 'yes' && (
              <FaceEnrollmentPanel
                currentUser={currentUser}
                authToken={authToken}
                authFetch={authFetch}
                enrolledStudents={enrolledStudents}
                facultyList={facultyList}
                onStudentEnrolled={loadUsers}
                showToast={showToast}
              />
            )}

            {activeTab === 'schedules' && (
              <TimetablePanel availableSchedules={availableSchedules} />
            )}

            {activeTab === 'history' && (
              <AttendanceLogsPanel
                currentUser={currentUser}
                attendanceLogs={attendanceLogs}
                loadingLogs={loadingLogs}
                onRefreshLogs={loadAttendanceLogs}
              />
            )}
          </main>
        </div>
      )}

      <Toast toast={toast} />
    </>
  );
}
