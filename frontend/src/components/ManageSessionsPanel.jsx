import React, { useState, useEffect } from 'react';
import { RefreshCw, Lock, MapPin } from 'lucide-react';

export default function ManageSessionsPanel({
  currentUser,
  authFetch,
  availableSchedules,
  facultyList,
  showToast,
  onSessionUpdated,
  onSchedulesUpdated
}) {
  const isAdmin = currentUser?.is_admin === 'yes';

  const [activeSessions, setActiveSessions] = useState([]);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  // Per-schedule open controls
  const [locationModeMap, setLocationModeMap] = useState({}); // 'teacher_gps' | 'campus' | 'bypass'
  const [radiusMap, setRadiusMap] = useState({});             // '150' | '300' | '1000'
  const [demoGpsMap, setDemoGpsMap] = useState({});

  const fetchSessionData = async () => {
    setLoading(true);
    try {
      const [resActive, resHist] = await Promise.all([
        authFetch('/sessions/active'),
        authFetch('/sessions/history')
      ]);
      const activeData = resActive.ok ? await resActive.json() : [];
      const histData = resHist.ok ? await resHist.json() : [];
      setActiveSessions(Array.isArray(activeData) ? activeData : []);
      setSessionHistory(Array.isArray(histData) ? histData : []);
    } catch (err) {
      console.warn('Error fetching session data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessionData();
  }, []);

  const getTeacherPosition = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Browser geolocation is unavailable.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => reject(new Error(err.message || 'Location permission denied.')),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

  const openSession = async (scheduleId) => {
    setActionLoadingId(scheduleId);
    const locMode = locationModeMap[scheduleId] || 'teacher_gps';
    const radiusM = Number(radiusMap[scheduleId] || 300);
    const allowDemo = Boolean(demoGpsMap[scheduleId]);

    try {
      const params = new URLSearchParams({
        schedule_id: String(scheduleId),
        allow_demo_gps: String(allowDemo),
        bypass_geofence: String(locMode === 'bypass'),
        radius_m: String(radiusM)
      });

      if (locMode === 'teacher_gps') {
        try {
          const pos = await getTeacherPosition();
          params.set('lat', String(pos.lat));
          params.set('lng', String(pos.lng));
        } catch (gpsErr) {
          showToast(
            'warning',
            `Could not read teacher GPS (${gpsErr.message}). Switch to "Demo / Skip Geofence" or "Allow Desktop Test GPS" if testing indoors.`
          );
          setActionLoadingId(null);
          return;
        }
      }

      const res = await authFetch(`/sessions/open?${params.toString()}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.detail || data.message || 'Not authorized to open this class.');
        return;
      }
      showToast('success', data.message || 'Attendance session opened.');
      await fetchSessionData();
      onSessionUpdated?.();
    } catch (err) {
      showToast('error', 'Error: ' + err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const closeSession = async (scheduleId) => {
    setActionLoadingId(scheduleId);
    try {
      const res = await authFetch(`/sessions/close?schedule_id=${scheduleId}`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.detail || data.message || 'Not authorized to close this class.');
        return;
      }
      showToast('info', data.message || 'Attendance session closed.');
      await fetchSessionData();
      onSessionUpdated?.();
    } catch (err) {
      showToast('error', 'Error: ' + err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAssignFaculty = async (scheduleId, newProfId) => {
    if (!newProfId) return;
    try {
      const res = await authFetch(`/schedules/${scheduleId}/assign-faculty`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prof_id: Number(newProfId) })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message);
        onSchedulesUpdated?.();
      } else {
        showToast('error', data.detail || 'Could not reassign faculty.');
      }
    } catch (err) {
      showToast('error', err.message);
    }
  };

  const activeIds = new Set(activeSessions.map((a) => a.schedule_id));

  return (
    <div className="tab-panel active">
      {/* Banner */}
      <div className="page-hero-banner" style={{ background: 'linear-gradient(135deg, #1B5E20 0%, #2E7D32 100%)' }}>
        <div>
          <div className="page-hero-title">Manage Attendance Sessions</div>
          <div className="page-hero-sub">
            Anchor attendance to your live room GPS, widen radius for merged classes, or run face-only demo mode
          </div>
          <div className="page-hero-tags">
            <span className="hero-tag">
              {isAdmin ? 'Coordinator Admin Access' : `Logged in as ${currentUser?.name}`}
            </span>
            <span className="hero-tag">Teacher-Anchored Dynamic Geofence</span>
          </div>
        </div>
        <button
          className="tt-filter-btn"
          style={{ background: '#fff', color: 'var(--success)', fontWeight: 800 }}
          onClick={fetchSessionData}
          disabled={loading}
        >
          <RefreshCw size={14} style={{ display: 'inline', marginRight: 6 }} />
          Refresh Sessions
        </button>
      </div>

      {/* Faculty Control Grid */}
      <div className="dashboard-card">
        <div className="card-head">
          <div>
            <div className="card-heading">Class &amp; Lab Attendance Controller</div>
            <div className="card-subheading">
              Choose whether students must be near your current live location, near Block-B, or in Face-Only Demo mode.
            </div>
          </div>
        </div>

        <div className="faculty-control-grid">
          {availableSchedules.map((sched) => {
            const isOpen = activeIds.has(sched.id);
            const activeData = activeSessions.find((a) => a.schedule_id === sched.id);
            const isLab = sched.course_type === 'lab';
            const isActing = actionLoadingId === sched.id;
            const isAssigned =
              sched.prof_id === currentUser?.id ||
              (sched.co_prof_id && sched.co_prof_id === currentUser?.id);
            const canManage = isAssigned || isAdmin;
            const locMode = locationModeMap[sched.id] || 'teacher_gps';
            const radiusVal = radiusMap[sched.id] || '300';

            return (
              <div
                key={sched.id}
                className={`faculty-class-card ${isOpen ? 'active-open' : ''}`}
                style={!canManage ? { opacity: 0.78 } : undefined}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
                      {sched.course_name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {sched.full_name || ''}
                    </div>
                  </div>
                  <span className={`badge ${isOpen ? 'badge-success' : 'badge-neutral'}`}>
                    {isOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>
                    <strong>Assigned Faculty:</strong> {sched.faculty_name || 'Unassigned'}
                  </div>
                  <div>
                    <strong>Type:</strong> {isLab ? 'Lab Session' : 'Theory'} &bull;{' '}
                    <strong>Room:</strong> {sched.room_or_lab || 'Room 242'}
                  </div>
                  <div>
                    <strong>Timing:</strong> {sched.time_slot || 'N/A'}
                  </div>
                  {sched.target_group && (
                    <div>
                      <strong>Batch:</strong> {sched.target_group}
                    </div>
                  )}
                  {isOpen && (
                    <div style={{ color: 'var(--success)', fontWeight: 700 }}>
                      Active since {activeData?.opened_at || ''}
                      {activeData?.bypass_geofence
                        ? ' • Flexible Room (Face-Only)'
                        : ` • Radius ${Math.round(activeData?.allowed_radius_m || 100)}m`}
                      {activeData?.allow_demo_gps ? ' • Test GPS' : ''}
                    </div>
                  )}
                </div>

                {/* Coordinator faculty assignment selector */}
                {isAdmin && facultyList.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <label className="field-label" style={{ fontSize: 11 }}>
                      Coordinator: Reassign Faculty
                    </label>
                    <select
                      className="field-select"
                      style={{ padding: '6px 8px', fontSize: 12 }}
                      value={sched.prof_id || ''}
                      onChange={(e) => handleAssignFaculty(sched.id, e.target.value)}
                    >
                      {facultyList.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  {!canManage ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-surface)',
                        color: 'var(--text-muted)',
                        fontSize: 12,
                        fontWeight: 700
                      }}
                    >
                      <Lock size={14} />
                      <span>Locked • Assigned to {sched.faculty_name || 'another teacher'}</span>
                    </div>
                  ) : isOpen ? (
                    <button
                      className="auth-btn danger"
                      onClick={() => closeSession(sched.id)}
                      disabled={isActing}
                    >
                      {isActing && <span className="btn-loader"></span>}
                      Close Attendance
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label className="field-label" style={{ fontSize: 11 }}>
                          <MapPin size={11} style={{ display: 'inline', marginRight: 4 }} />
                          Class Zone / Room Mode
                        </label>
                        <select
                          className="field-select"
                          style={{ padding: '6px 8px', fontSize: 12 }}
                          value={locMode}
                          onChange={(e) =>
                            setLocationModeMap((prev) => ({ ...prev, [sched.id]: e.target.value }))
                          }
                        >
                          <option value="teacher_gps">My Live Location (Any Room / Merged Class)</option>
                          <option value="campus">Fixed GL Bajaj Campus (Block-B)</option>
                          <option value="bypass">Skip Geofence (Face-Only Demo / Online)</option>
                        </select>
                      </div>

                      {locMode !== 'bypass' && (
                        <div>
                          <label className="field-label" style={{ fontSize: 11 }}>
                            Allowed Radius
                          </label>
                          <select
                            className="field-select"
                            style={{ padding: '6px 8px', fontSize: 12 }}
                            value={radiusVal}
                            onChange={(e) =>
                              setRadiusMap((prev) => ({ ...prev, [sched.id]: e.target.value }))
                            }
                          >
                            <option value="150">150m (Same Classroom)</option>
                            <option value="300">300m (Merged Class / Adjacent Block)</option>
                            <option value="1000">1000m (Whole Campus / GPS Drift Safe)</option>
                          </select>
                        </div>
                      )}

                      {locMode === 'campus' && (
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(demoGpsMap[sched.id])}
                            onChange={(e) =>
                              setDemoGpsMap((prev) => ({ ...prev, [sched.id]: e.target.checked }))
                            }
                          />
                          <span>Allow Desktop Test GPS (for PCs without GPS)</span>
                        </label>
                      )}

                      <button
                        className="auth-btn success"
                        onClick={() => openSession(sched.id)}
                        disabled={isActing}
                      >
                        {isActing && <span className="btn-loader"></span>}
                        {!isAssigned && isAdmin ? 'Coordinator Override: Open' : 'Open Attendance'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Session History Audit Table */}
      <div className="dashboard-card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-heading">Session History</div>
            <div className="card-subheading">Recent open/close logs for compliance and auditing</div>
          </div>
        </div>

        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Class / Lab</th>
                <th>Opened By</th>
                <th>Opened At</th>
                <th>Closed At</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessionHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No sessions recorded yet.
                  </td>
                </tr>
              ) : (
                sessionHistory.map((r) => (
                  <tr key={r.session_id}>
                    <td><strong>{r.course_name}</strong></td>
                    <td>{r.opened_by_name || 'Faculty'}</td>
                    <td className="mono">{r.opened_at || '--'}</td>
                    <td className="mono">
                      {r.closed_at ? (
                        r.closed_at
                      ) : (
                        <span style={{ color: 'var(--success)', fontWeight: 700 }}>Still Open</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${r.is_active === 'yes' ? 'badge-success' : 'badge-neutral'}`}>
                        {r.is_active === 'yes' ? 'Open' : 'Closed'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
