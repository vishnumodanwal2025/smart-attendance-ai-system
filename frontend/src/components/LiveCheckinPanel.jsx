import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Camera, AlertCircle, Lock, MapPin } from 'lucide-react';
import { CAMPUS_COORDINATES, calculateHaversine } from '../constants/scheduleData';

export default function LiveCheckinPanel({
  currentUser,
  authFetch,
  activeSessions,
  availableSchedules,
  enrolledStudents,
  onRefreshSessions,
  onAttendanceMarked,
  showToast,
  setCameraActive,
}) {
  const isFaculty = currentUser?.role === 'professor';
  const isAdmin = currentUser?.is_admin === 'yes';
  const shouldUseCamera = isFaculty || activeSessions.length > 0;

  /* ─── GPS / Geofence ─────────────────────────────────────── */
  const [useDemoGps, setUseDemoGps] = useState(false);
  const [currentPosition, setCurrentPos] = useState(null);
  const [gpsError, setGpsError] = useState('');

  /* ─── Student check-in state ─────────────────────────────── */
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [studentVerifying, setStudentVerifying] = useState(false);
  const [checkinResult, setCheckinResult] = useState(null);

  /* ─── Faculty direct check-in state ──────────────────────── */
  const manageableSchedules = availableSchedules.filter(
    (s) => isAdmin || s.prof_id === currentUser?.id || s.co_prof_id === currentUser?.id
  );
  const [profStudentId, setProfStudentId] = useState('');
  const [profScheduleId, setProfScheduleId] = useState('');
  const [profVerifying, setProfVerifying] = useState(false);
  const [profResult, setProfResult] = useState(null);

  /* ─── Webcam refs ────────────────────────────────────────── */
  const studentVideoRef = useRef(null);
  const profVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const cameraRequestIdRef = useRef(0);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    if (enrolledStudents.length > 0 && !profStudentId) {
      setProfStudentId(String(enrolledStudents[0].id));
    }
  }, [enrolledStudents, profStudentId]);

  useEffect(() => {
    if (activeSessions.length > 0) {
      if (!selectedScheduleId || !activeSessions.some((s) => s.schedule_id === Number(selectedScheduleId))) {
        setSelectedScheduleId(String(activeSessions[0].schedule_id));
      }
    } else {
      setSelectedScheduleId('');
    }
  }, [activeSessions, selectedScheduleId]);

  useEffect(() => {
    if (manageableSchedules.length > 0) {
      if (!profScheduleId || !manageableSchedules.some((s) => s.id === Number(profScheduleId))) {
        setProfScheduleId(String(manageableSchedules[0].id));
      }
    }
  }, [availableSchedules, currentUser]);

  const activeSelectedSession =
    activeSessions.find((s) => s.schedule_id === Number(selectedScheduleId)) ||
    activeSessions[0] ||
    null;

  const sessionAllowsDemoGps = Boolean(activeSelectedSession?.allow_demo_gps);
  const sessionBypassesGeofence = Boolean(activeSelectedSession?.bypass_geofence);

  // Reset demo GPS when switching to a session that disallows it
  useEffect(() => {
    if (!sessionAllowsDemoGps && useDemoGps) {
      setUseDemoGps(false);
    }
  }, [sessionAllowsDemoGps, useDemoGps]);

  const requestRealGps = useCallback(() => {
    setGpsError('');
    if (!navigator.geolocation) {
      setGpsError('Browser geolocation is unavailable.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsError('');
      },
      (err) => {
        setCurrentPos(null);
        setGpsError(err.message || 'Location permission denied.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    if (isFaculty || sessionBypassesGeofence) return;
    if (useDemoGps && sessionAllowsDemoGps) {
      setCurrentPos(CAMPUS_COORDINATES);
      setGpsError('');
    } else {
      requestRealGps();
    }
  }, [isFaculty, sessionBypassesGeofence, useDemoGps, sessionAllowsDemoGps, requestRealGps]);

  /* ─── Webcam ─────────────────────────────────────────────── */
  const startCamera = useCallback(async () => {
    const requestId = ++cameraRequestIdRef.current;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is unavailable in this browser or page context.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      if (cameraRequestIdRef.current !== requestId) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (studentVideoRef.current) studentVideoRef.current.srcObject = stream;
      if (profVideoRef.current) profVideoRef.current.srcObject = stream;
      setCameraBlocked(false);
      setCameraError('');
      setCameraActive(true);
    } catch (err) {
      if (cameraRequestIdRef.current !== requestId) return;
      console.warn('Camera error:', err);
      setCameraBlocked(true);
      setCameraError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      setCameraActive(false);
    }
  }, [setCameraActive]);

  const attachStudentVideo = useCallback((video) => {
    studentVideoRef.current = video;
    if (video && streamRef.current) video.srcObject = streamRef.current;
  }, []);

  const attachProfVideo = useCallback((video) => {
    profVideoRef.current = video;
    if (video && streamRef.current) video.srcObject = streamRef.current;
  }, []);

  useEffect(() => {
    if (!shouldUseCamera) return undefined;
    const startTimer = setTimeout(() => {
      startCamera();
    }, 0);
    return () => {
      clearTimeout(startTimer);
      cameraRequestIdRef.current += 1;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (studentVideoRef.current) studentVideoRef.current.srcObject = null;
      if (profVideoRef.current) profVideoRef.current.srcObject = null;
      setCameraActive(false);
    };
  }, [startCamera, shouldUseCamera, setCameraActive]);

  /* ─── Distance (Active session anchor overrides static schedule) ── */
  const currentSched =
    activeSelectedSession ||
    availableSchedules.find((s) => s.id === Number(selectedScheduleId));

  const distance =
    currentSched && currentPosition
      ? calculateHaversine(
          currentPosition.lat,
          currentPosition.lng,
          currentSched.lat ?? CAMPUS_COORDINATES.lat,
          currentSched.lng ?? CAMPUS_COORDINATES.lng
        )
      : null;

  const allowedRadius = currentSched?.allowed_radius_m || 100;
  const isInsideRadar = sessionBypassesGeofence || (distance !== null && distance <= allowedRadius);

  /* ─── Frame capture helper ───────────────────────────────── */
  const captureFrameBlob = (videoEl) => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = videoEl?.videoWidth || 640;
      canvas.height = videoEl?.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (videoEl && ctx) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      }
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.94);
    });
  };

  /* ─── Student Check-In ───────────────────────────────────── */
  const handleStudentCheckin = async () => {
    if (!selectedScheduleId) {
      setCheckinResult({ status: 'warning', title: 'No Class Selected', message: 'Please select an active session.', similarity: null });
      return;
    }
    if (!currentPosition && !sessionBypassesGeofence) {
      setCheckinResult({
        status: 'warning',
        title: 'Location Required',
        message: gpsError || 'Allow browser location access (or ask faculty to open session with Live Location / Demo mode).',
        similarity: null
      });
      return;
    }
    setStudentVerifying(true);
    setCheckinResult(null);
    try {
      const blob = await captureFrameBlob(studentVideoRef.current);
      const formData = new FormData();
      formData.append('file', blob, 'checkin_selfie.jpg');

      const latParam = currentPosition?.lat ?? 0;
      const lngParam = currentPosition?.lng ?? 0;
      const url = `/attendance/unified-check-in?schedule_id=${selectedScheduleId}&lat=${latParam}&lng=${lngParam}`;
      const res = await authFetch(url, { method: 'POST', body: formData });
      const data = await res.json();
      setStudentVerifying(false);

      if (data.status === 'success') {
        const pct = data.similarity_score !== undefined ? Math.min(100, Math.round(data.similarity_score * 100)) : null;
        setCheckinResult({ status: 'success', title: 'Attendance Verified Successfully!', message: data.message || 'Marked Present.', similarity: pct });
        showToast('success', 'Attendance Marked: Present');
        onAttendanceMarked?.();
      } else if (data.status === 'already_marked') {
        setCheckinResult({ status: 'warning', title: 'Already Recorded', message: data.message, similarity: null });
        showToast('info', 'Already marked for this session.');
      } else if (data.face_detected === false) {
        setCheckinResult({ status: 'error', title: 'Verification Blocked', message: data.detail || data.message || 'Look straight into the camera in good lighting.', similarity: null });
        showToast('error', data.detail || data.message || 'Verification blocked.');
      } else {
        const pct = data.similarity_score !== undefined ? Math.min(100, Math.round(data.similarity_score * 100)) : null;
        setCheckinResult({ status: 'error', title: 'Check-In Denied', message: data.detail || data.message || 'Verification failed.', similarity: pct });
        showToast('error', data.detail || data.message || 'Verification failed.');
      }
    } catch (err) {
      setStudentVerifying(false);
      setCheckinResult({ status: 'error', title: 'Network Error', message: err.message, similarity: null });
    }
  };

  /* ─── Faculty Direct Check-In ────────────────────────────── */
  const handleProfCheckin = async () => {
    if (!profStudentId || !profScheduleId) {
      setProfResult({ status: 'warning', title: 'Missing Selection', message: 'Select both student and assigned class.' });
      return;
    }
    setProfVerifying(true);
    setProfResult(null);
    try {
      const blob = await captureFrameBlob(profVideoRef.current || studentVideoRef.current);
      const formData = new FormData();
      formData.append('file', blob, 'faculty_checkin.jpg');

      const url = `/attendance/unified-check-in?student_id=${profStudentId}&schedule_id=${profScheduleId}&lat=${CAMPUS_COORDINATES.lat}&lng=${CAMPUS_COORDINATES.lng}&require_active_session=false`;
      const res = await authFetch(url, { method: 'POST', body: formData });
      const data = await res.json();
      setProfVerifying(false);

      if (data.status === 'success') {
        const pct = data.similarity_score !== undefined ? Math.min(100, Math.round(data.similarity_score * 100)) : null;
        setProfResult({ status: 'success', title: 'Verified', message: data.message, similarity: pct });
        showToast('success', 'Attendance recorded.');
        onAttendanceMarked?.();
      } else if (data.status === 'already_marked') {
        setProfResult({ status: 'warning', title: 'Already Marked', message: data.message, similarity: null });
      } else if (data.face_detected === false) {
        setProfResult({ status: 'error', title: 'Verification Blocked', message: data.detail || data.message || 'No face in frame.', similarity: null });
      } else {
        const pct = data.similarity_score !== undefined ? Math.min(100, Math.round(data.similarity_score * 100)) : null;
        setProfResult({ status: 'error', title: 'Verification Failed', message: data.detail || data.message, similarity: pct });
      }
    } catch (err) {
      setProfVerifying(false);
      setProfResult({ status: 'error', title: 'Error', message: err.message, similarity: null });
    }
  };

  return (
    <div className="tab-panel active">
      {/* Hero */}
      <div className="page-hero-banner">
        <div>
          <div className="page-hero-title">Live Attendance Verification</div>
          <div className="page-hero-sub">AI Biometric Face Verification + Campus Geofence Radar System</div>
          <div className="page-hero-tags">
            <span className="hero-tag">Room 242 (Block-B)</span>
            <span className="hero-tag">Section H &bull; Year 2 &bull; Sem III</span>
            <span className="hero-tag">CSE-AIML &amp; CS</span>
          </div>
        </div>
      </div>

      {/* ── STUDENT VIEW ──────────────────────────────────────── */}
      {!isFaculty && (
        <>
          {activeSessions.length === 0 ? (
            <div className="session-empty-gate">
              <div className="gate-icon-circle">
                <AlertCircle size={34} />
              </div>
              <div className="gate-title">Attendance Session Not Active</div>
              <div className="gate-desc">
                Your professor has not opened attendance yet. It will appear here automatically when opened.
              </div>
              <button
                className="auth-btn primary"
                style={{ width: 'auto', padding: '10px 24px' }}
                onClick={onRefreshSessions}
              >
                <RefreshCw size={14} style={{ display: 'inline', marginRight: 6 }} />
                Refresh Status Now
              </button>
            </div>
          ) : (
            <>
              {activeSelectedSession && (
                <div className="active-session-spotlight">
                  <div className="session-spotlight-left">
                    <div className="live-pulse-dot" />
                    <div>
                      <div className="spotlight-class-name">
                        {activeSelectedSession.course_name}
                        {activeSelectedSession.full_name ? ` (${activeSelectedSession.full_name})` : ''}
                      </div>
                      <div className="spotlight-class-meta">
                        Opened by {activeSelectedSession.opened_by_name || 'Professor'} at {activeSelectedSession.opened_at || ''}
                        {activeSelectedSession.room_or_lab ? ` • ${activeSelectedSession.room_or_lab}` : ''}
                        {activeSelectedSession.target_group ? ` • ${activeSelectedSession.target_group}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="badge badge-success">Session Open</span>
                    <span className={`badge ${activeSelectedSession.course_type === 'lab' ? 'badge-lab' : 'badge-theory'}`}>
                      {activeSelectedSession.course_type === 'lab' ? 'Lab Session' : 'Theory Class'}
                    </span>
                  </div>
                </div>
              )}

              <div className="checkin-layout-grid">
                {/* Left: Authenticated Student & Geofence */}
                <div className="dashboard-card card-blue">
                  <div className="card-head">
                    <div>
                      <div className="card-heading">1. Identity &amp; Geofence Verification</div>
                      <div className="card-subheading">Locked to your signed-in student account</div>
                    </div>
                  </div>

                  {/* Authenticated Identity Card (no dropdown spoofing!) */}
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      marginBottom: 14,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>
                        {currentUser.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {currentUser.enrollment_no || currentUser.email}
                        {currentUser.section ? ` • Sec ${currentUser.section}` : ''}
                        {currentUser.group ? ` (${currentUser.group})` : ''}
                      </div>
                    </div>
                    <span className={`badge ${currentUser.has_face_encoding ? 'badge-success' : 'badge-warning'}`}>
                      {currentUser.has_face_encoding ? 'Face Enrolled' : 'No Face Baseline'}
                    </span>
                  </div>

                  <div className="field-group">
                    <label className="field-label">Active Class / Lab Session</label>
                    <select
                      className="field-select"
                      value={selectedScheduleId}
                      onChange={(e) => setSelectedScheduleId(e.target.value)}
                    >
                      {activeSessions.map((sess) => (
                        <option key={sess.session_id} value={sess.schedule_id}>
                          {sess.course_name} {sess.course_type === 'lab' ? '[LAB]' : '[Theory]'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Geofence radar */}
                  <div className="radar-box">
                    <div className="radar-header-row">
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Geofence Radar</span>
                      <span className={`badge ${isInsideRadar ? 'badge-success' : 'badge-error'}`}>
                        {sessionBypassesGeofence
                          ? 'Flexible Room / Demo Mode'
                          : currentPosition === null
                            ? 'GPS Unavailable'
                            : isInsideRadar
                              ? 'Inside Class Zone'
                              : `${distance.toFixed(0)}m Away (Outside)`}
                      </span>
                    </div>

                    {sessionBypassesGeofence ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Faculty opened this session in <strong>Face-Only Demo / Flexible Room</strong> mode. Geofence check is bypassed; strict AI face matching is enforced.
                      </div>
                    ) : sessionAllowsDemoGps ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={useDemoGps} onChange={(e) => setUseDemoGps(e.target.checked)} />
                        <span>Faculty enabled Test Mode: Use Campus Coordinates (27.6465° N, 77.5519° E)</span>
                      </label>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                        <span>
                          <MapPin size={12} style={{ display: 'inline', marginRight: 4 }} />
                          Matched against teacher&apos;s active room coordinates (Radius: {Math.round(allowedRadius)}m)
                        </span>
                        <button
                          type="button"
                          className="tt-filter-btn"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={requestRealGps}
                        >
                          Refresh GPS
                        </button>
                      </div>
                    )}

                    {gpsError && !useDemoGps && !sessionBypassesGeofence && (
                      <div style={{ fontSize: 12, color: 'var(--error)', fontWeight: 600 }}>
                        {gpsError}
                      </div>
                    )}

                    {currentPosition && !sessionBypassesGeofence && (
                      <>
                        <div className="coord-chips-row">
                          <span className="coord-chip">Lat: <strong>{currentPosition.lat.toFixed(6)}</strong></span>
                          <span className="coord-chip">Lng: <strong>{currentPosition.lng.toFixed(6)}</strong></span>
                        </div>
                        <div className="distance-stat-card">
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Radar Distance:</span>
                          <span className="distance-value-text">{distance.toFixed(1)} m (Radius: {Math.round(allowedRadius)} m)</span>
                        </div>
                      </>
                    )}
                  </div>

                  {checkinResult && (
                    <div className={`verify-result-box show ${checkinResult.status}`}>
                      <div className="verify-result-title">{checkinResult.title}</div>
                      <div>{checkinResult.message}</div>
                      {checkinResult.similarity !== null && (
                        <div className="similarity-bar-wrap show">
                          <div className="sim-labels-row">
                            <span>Face Biometric Match:</span>
                            <strong>{checkinResult.similarity}%</strong>
                          </div>
                          <div className="sim-track">
                            <div className="sim-fill" style={{ width: `${checkinResult.similarity}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Biometric Camera */}
                <div className="dashboard-card card-teal">
                  <div className="card-head">
                    <div>
                      <div className="card-heading">2. Biometric Facial Verification</div>
                      <div className="card-subheading">Look into camera and align face inside the frame</div>
                    </div>
                    <button className="tt-filter-btn" style={{ padding: '6px 14px', fontSize: 11 }} onClick={startCamera}>
                      <Camera size={12} style={{ display: 'inline', marginRight: 4 }} />
                      Restart Cam
                    </button>
                  </div>

                  <div className="camera-viewport">
                    <video ref={attachStudentVideo} autoPlay playsInline muted />
                    <div className="camera-reticle-overlay">
                      <div className="face-target-reticle">
                        <div className="radar-scan-line" />
                      </div>
                    </div>
                    {cameraBlocked && (
                      <div className="camera-blocked-fallback" style={{ display: 'flex' }}>
                        <AlertCircle size={40} />
                        <div>
                          Camera could not start.
                          <br />
                          {cameraError || 'Check browser camera permissions.'}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    className="auth-btn primary"
                    style={{ padding: 14, fontSize: 14 }}
                    onClick={handleStudentCheckin}
                    disabled={studentVerifying}
                  >
                    {studentVerifying && <span className="btn-loader" />}
                    <span>
                      {studentVerifying ? 'Verifying Face & Radar...' : 'Capture Face & Verify Attendance'}
                    </span>
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── FACULTY DIRECT CHECK-IN VIEW ──────────────────────── */}
      {isFaculty && (
        <div className="dashboard-card card-red" style={{ marginBottom: 24 }}>
          <div className="card-head">
            <div>
              <div className="card-heading">Faculty Direct Attendance Verification</div>
              <div className="card-subheading">Verify a student directly for one of your assigned classes</div>
            </div>
            <button className="tt-filter-btn" style={{ padding: '6px 14px', fontSize: 11 }} onClick={startCamera}>
              <Camera size={12} style={{ display: 'inline', marginRight: 4 }} />
              Restart Cam
            </button>
          </div>

          {manageableSchedules.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              <Lock size={20} style={{ display: 'block', margin: '0 auto 8px' }} />
              No courses are currently assigned to your faculty account. Ask the Coordinator to assign your subject.
            </div>
          ) : (
            <div className="checkin-layout-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field-group">
                  <label className="field-label">Select Student</label>
                  <select className="field-select" value={profStudentId} onChange={(e) => setProfStudentId(e.target.value)}>
                    {enrolledStudents.map((stu) => (
                      <option key={stu.id} value={stu.id}>
                        {stu.name}{stu.enrollment_no ? ` (${stu.enrollment_no})` : ''}
                        {stu.group ? ` - ${stu.group}` : ''}
                        {stu.has_face_encoding ? ' [Face Saved]' : ' [No Face]'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label className="field-label">Select Your Assigned Class / Lab</label>
                  <select className="field-select" value={profScheduleId} onChange={(e) => setProfScheduleId(e.target.value)}>
                    {manageableSchedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.course_name} - {s.full_name || ''} ({s.course_type === 'lab' ? 'LAB' : 'Theory'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="radar-box">
                  <div className="radar-header-row">
                    <span style={{ fontSize: 13, fontWeight: 800 }}>Classroom Verification Mode</span>
                    <span className="badge badge-success">Faculty Authorized</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Coordinates anchored to GL Bajaj Academic Block.
                  </div>
                </div>

                {profResult && (
                  <div className={`verify-result-box show ${profResult.status}`}>
                    <div className="verify-result-title">{profResult.title}</div>
                    <div>{profResult.message}</div>
                    {profResult.similarity !== null && profResult.similarity !== undefined && (
                      <div className="similarity-bar-wrap show">
                        <div className="sim-labels-row">
                          <span>Biometric Match Score:</span>
                          <strong>{profResult.similarity}%</strong>
                        </div>
                        <div className="sim-track">
                          <div className="sim-fill" style={{ width: `${profResult.similarity}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="camera-viewport">
                  <video ref={attachProfVideo} autoPlay playsInline muted />
                  <div className="camera-reticle-overlay">
                    <div className="face-target-reticle">
                      <div className="radar-scan-line" />
                    </div>
                  </div>
                  {cameraBlocked && (
                    <div className="camera-blocked-fallback" style={{ display: 'flex' }}>
                      <AlertCircle size={40} />
                      <div>
                        Camera could not start.
                        <br />
                        {cameraError || 'Check browser camera permissions.'}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  className="auth-btn danger"
                  style={{ padding: 14, fontSize: 14 }}
                  onClick={handleProfCheckin}
                  disabled={profVerifying}
                >
                  {profVerifying && <span className="btn-loader" />}
                  <span>Capture &amp; Verify Student</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
