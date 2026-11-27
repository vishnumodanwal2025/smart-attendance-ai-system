import React, { useState, useRef, useEffect } from 'react';
import { Upload, Camera, UserPlus, Users, Trash2, RefreshCw, KeyRound, Copy, Award } from 'lucide-react';
import { API_BASE } from '../constants/scheduleData';

export default function FaceEnrollmentPanel({
  currentUser,
  authToken,
  authFetch,
  enrolledStudents,
  facultyList,
  onStudentEnrolled,
  showToast
}) {
  const isAdmin = currentUser?.is_admin === 'yes';

  const [actionMode, setActionMode] = useState('new'); // 'new' | 'existing'
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [enrollMode, setEnrollMode] = useState('camera'); // 'upload' | 'camera'

  // New student fields
  const [newName, setNewName] = useState('');
  const [newEnrollNo, setNewEnrollNo] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newGroup, setNewGroup] = useState('G1');
  const [newSection, setNewSection] = useState('H');

  // Shareable credentials popup/banner
  const [issuedCredentials, setIssuedCredentials] = useState(null);

  // Coordinator-only Add Faculty state
  const [facName, setFacName] = useState('');
  const [facEmail, setFacEmail] = useState('');
  const [facPass, setFacPass] = useState('');
  const [facLoading, setFacLoading] = useState(false);

  const [selectedFile, setSelectedFile] = useState(null);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [resettingId, setResettingId] = useState(null);
  const [resultBox, setResultBox] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (enrolledStudents.length > 0 && !selectedStudentId) {
      setSelectedStudentId(String(enrolledStudents[0].id));
    }
  }, [enrolledStudents, selectedStudentId]);

  const startCamera = async () => {
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      showToast('error', 'Camera access blocked. Check browser permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (enrollMode === 'camera' && !capturedBlob) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [enrollMode, capturedBlob]);

  const captureSnapshot = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      setCapturedBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      stopCamera();
    }, 'image/jpeg', 0.94);
  };

  const retakeSnapshot = () => {
    setCapturedBlob(null);
    setPreviewUrl('');
  };

  const copyCredentials = (creds) => {
    const text = `GL Bajaj Attendance Login\nID / Email: ${creds.login_id} (or ${creds.email})\nPassword: ${creds.initial_password || creds.new_password}`;
    navigator.clipboard?.writeText(text);
    showToast('success', 'Student credentials copied to clipboard!');
  };

  const handleEnrollSubmit = async () => {
    setResultBox(null);

    if (actionMode === 'new' && !newName.trim()) {
      setResultBox({
        status: 'warning',
        title: 'Missing Student Name',
        message: 'Please enter the student full name.'
      });
      return;
    }

    if (actionMode === 'existing' && !selectedStudentId) {
      setResultBox({
        status: 'warning',
        title: 'No Student Selected',
        message: 'Please select an existing student.'
      });
      return;
    }

    const fileToSend = enrollMode === 'camera' ? capturedBlob : selectedFile;
    if (!fileToSend) {
      setResultBox({
        status: 'warning',
        title: 'No Photo',
        message: enrollMode === 'camera'
          ? 'Please capture a clear camera snapshot first.'
          : 'Please choose a face photo to upload.'
      });
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', fileToSend, 'face_baseline.jpg');

    try {
      let path = '';
      if (actionMode === 'new') {
        const params = new URLSearchParams({
          name: newName.trim(),
          enrollment_no: newEnrollNo.trim(),
          email: newEmail.trim(),
          password: newPassword.trim(),
          section: newSection,
          group: newGroup
        });
        path = `/students/enroll-with-face?${params.toString()}`;
      } else {
        path = `/users/${selectedStudentId}/upload-face`;
      }

      const res = await authFetch(path, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setLoading(false);

      if (res.ok && data.status === 'success') {
        setResultBox({
          status: 'success',
          title: actionMode === 'new' ? 'Student Added & Face Saved!' : 'Face Updated Successfully!',
          message: data.message
        });
        if (data.credentials) {
          setIssuedCredentials({
            studentName: data.student?.name || newName.trim(),
            ...data.credentials
          });
        }
        showToast('success', data.message);
        onStudentEnrolled?.();
        if (actionMode === 'new') {
          setNewName('');
          setNewEnrollNo('');
          setNewEmail('');
          setNewPassword('');
        }
        setCapturedBlob(null);
        setPreviewUrl('');
        setSelectedFile(null);
      } else {
        setResultBox({
          status: 'error',
          title: 'Photo Rejected',
          message: data.detail || data.message || 'Could not detect a clear single face in photo.'
        });
        showToast('error', data.detail || data.message || 'Face quality check failed.');
      }
    } catch (err) {
      setLoading(false);
      setResultBox({
        status: 'error',
        title: 'Network Error',
        message: err.message
      });
    }
  };

  const handleResetPassword = async (stu) => {
    setResettingId(stu.id);
    try {
      const res = await authFetch(`/users/${stu.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.credentials) {
        setIssuedCredentials({
          studentName: stu.name,
          ...data.credentials
        });
        showToast('success', `Generated new password for ${stu.name}.`);
      } else {
        showToast('error', data.detail || 'Could not reset password.');
      }
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setResettingId(null);
    }
  };

  const handleDeleteStudent = async (stu) => {
    if (!window.confirm(`Remove "${stu.name}" and their stored face photo?`)) return;
    setDeletingId(stu.id);
    try {
      const res = await authFetch(`/users/${stu.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast('info', data.message || `Removed ${stu.name}.`);
        onStudentEnrolled?.();
      } else {
        showToast('error', data.detail || 'Could not delete student.');
      }
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateFaculty = async (e) => {
    e.preventDefault();
    if (!facName.trim() || !facEmail.trim() || facPass.length < 4) {
      showToast('warning', 'Provide faculty name, email, and password (min 4 chars).');
      return;
    }
    setFacLoading(true);
    try {
      const res = await authFetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: facName.trim(),
          email: facEmail.trim(),
          password: facPass,
          role: 'professor',
          is_admin: 'no',
          section: 'H',
          group: 'All'
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', `Faculty account created for ${data.name}.`);
        setFacName('');
        setFacEmail('');
        setFacPass('');
        onStudentEnrolled?.();
      } else {
        showToast('error', data.detail || 'Failed to create faculty account.');
      }
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setFacLoading(false);
    }
  };

  return (
    <div className="tab-panel active">
      {/* Banner */}
      <div className="page-hero-banner" style={{ background: 'linear-gradient(135deg, var(--accent) 0%, #e74c3c 100%)' }}>
        <div>
          <div className="page-hero-title">Biometric Face Enrollment &amp; Student Credentials</div>
          <div className="page-hero-sub">
            Provision student accounts, share login credentials, and save validated face baselines to local system storage
          </div>
          <div className="page-hero-tags">
            <span className="hero-tag">Faculty-Controlled Onboarding</span>
            <span className="hero-tag">Protected Local Photo Storage</span>
          </div>
        </div>
      </div>

      {/* Shareable Credentials Banner */}
      {issuedCredentials && (
        <div className="verify-result-box show success" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="verify-result-title">
                Share Login Credentials with {issuedCredentials.studentName}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                <strong>Login ID:</strong> <code className="mono">{issuedCredentials.login_id}</code> &bull;{' '}
                <strong>Email:</strong> <code className="mono">{issuedCredentials.email}</code> &bull;{' '}
                <strong>Password:</strong>{' '}
                <code className="mono" style={{ background: '#fff', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>
                  {issuedCredentials.initial_password || issuedCredentials.new_password}
                </code>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="auth-btn success"
                style={{ width: 'auto', padding: '8px 14px', fontSize: 12 }}
                onClick={() => copyCredentials(issuedCredentials)}
              >
                <Copy size={13} style={{ display: 'inline', marginRight: 6 }} />
                Copy Credentials
              </button>
              <button
                type="button"
                className="tt-filter-btn"
                style={{ padding: '8px 12px', fontSize: 12 }}
                onClick={() => setIssuedCredentials(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="checkin-layout-grid">
        {/* Left: Add / Update Student Face */}
        <div className="dashboard-card card-red">
          <div className="card-head">
            <div>
              <div className="card-heading">Register Student &amp; Face Baseline</div>
              <div className="card-subheading">
                Only clear, sharp, single-face photos are accepted for accurate attendance matching
              </div>
            </div>
          </div>

          {/* Action Mode Switch */}
          <div className="role-selector" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={`role-btn ${actionMode === 'new' ? 'active' : ''}`}
              onClick={() => { setActionMode('new'); setResultBox(null); }}
            >
              <UserPlus size={16} />
              Add New Student + Face
            </button>
            <button
              type="button"
              className={`role-btn ${actionMode === 'existing' ? 'active' : ''}`}
              onClick={() => { setActionMode('existing'); setResultBox(null); }}
            >
              <Users size={16} />
              Update Existing Student
            </button>
          </div>

          {actionMode === 'new' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
              <div className="field-group">
                <label className="field-label">Student Full Name *</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. Tushar Sharma"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', gap: 10 }}>
                <div className="field-group">
                  <label className="field-label">Roll / Enrollment No</label>
                  <input
                    className="field-input"
                    type="text"
                    placeholder="e.g. 25CSAIM076"
                    value={newEnrollNo}
                    onChange={(e) => setNewEnrollNo(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Section</label>
                  <select className="field-select" value={newSection} onChange={(e) => setNewSection(e.target.value)}>
                    <option value="H">Sec H</option>
                    <option value="A">Sec A</option>
                    <option value="B">Sec B</option>
                    <option value="C">Sec C</option>
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Group</label>
                  <select className="field-select" value={newGroup} onChange={(e) => setNewGroup(e.target.value)}>
                    <option value="G1">G1</option>
                    <option value="G2">G2</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field-group">
                  <label className="field-label">College Email (Optional)</label>
                  <input
                    className="field-input"
                    type="email"
                    placeholder="Auto-generated if blank"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Initial Password (Optional)</label>
                  <input
                    className="field-input"
                    type="text"
                    placeholder="Auto-generated if blank"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="field-group" style={{ marginBottom: 14 }}>
              <label className="field-label">Select Existing Student</label>
              <select
                className="field-select"
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                {enrolledStudents.map((stu) => (
                  <option key={stu.id} value={stu.id}>
                    {stu.name} {stu.enrollment_no ? `(${stu.enrollment_no})` : ''}
                    {stu.has_face_encoding ? ' [Face Saved]' : ' [No Face]'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="field-label" style={{ display: 'block', marginBottom: 8 }}>
              Photo Capture Mode
            </label>
            <div className="role-selector">
              <button
                type="button"
                className={`role-btn ${enrollMode === 'camera' ? 'active' : ''}`}
                onClick={() => setEnrollMode('camera')}
              >
                <Camera size={16} />
                Live Camera Capture
              </button>
              <button
                type="button"
                className={`role-btn ${enrollMode === 'upload' ? 'active' : ''}`}
                onClick={() => setEnrollMode('upload')}
              >
                <Upload size={16} />
                Upload Photo File
              </button>
            </div>
          </div>

          {enrollMode === 'upload' && (
            <div className="field-group" style={{ marginTop: 14 }}>
              <label className="field-label">Reference Face Photo (Clear Front-Facing JPEG/PNG)</label>
              <input
                className="field-input"
                type="file"
                accept="image/*"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
              <button
                className="auth-btn primary"
                style={{ marginTop: 12 }}
                onClick={handleEnrollSubmit}
                disabled={loading}
              >
                {loading && <span className="btn-loader"></span>}
                {actionMode === 'new' ? 'Create Student & Save Face Photo' : 'Update Face Reference'}
              </button>
            </div>
          )}

          {enrollMode === 'camera' && (
            <div style={{ marginTop: 14 }}>
              {!capturedBlob ? (
                <div>
                  <div className="camera-viewport" style={{ maxHeight: 280 }}>
                    <video ref={videoRef} autoPlay playsInline muted></video>
                    <div className="camera-reticle-overlay">
                      <div className="face-target-reticle">
                        <div className="radar-scan-line"></div>
                      </div>
                    </div>
                  </div>
                  <button
                    className="auth-btn danger"
                    style={{ marginTop: 10 }}
                    onClick={captureSnapshot}
                  >
                    Capture Accurate Photo
                  </button>
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      aspectRatio: '4/3',
                      maxHeight: 280,
                      borderRadius: 'var(--radius-lg)',
                      overflow: 'hidden',
                      border: '2px solid var(--success)'
                    }}
                  >
                    <img
                      src={previewUrl}
                      alt="Captured Face"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button className="tt-filter-btn" style={{ flex: 1 }} onClick={retakeSnapshot}>
                      Retake Photo
                    </button>
                    <button
                      className="auth-btn success"
                      style={{ flex: 1 }}
                      onClick={handleEnrollSubmit}
                      disabled={loading}
                    >
                      {loading && <span className="btn-loader"></span>}
                      {actionMode === 'new' ? 'Create Student & Save Face' : 'Update Face Baseline'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {resultBox && (
            <div className={`verify-result-box show ${resultBox.status}`} style={{ marginTop: 14 }}>
              <div className="verify-result-title">{resultBox.title}</div>
              <div>{resultBox.message}</div>
            </div>
          )}
        </div>

        {/* Right: Enrolled Students & Local Photo Storage Gallery */}
        <div className="dashboard-card card-blue">
          <div className="card-head">
            <div>
              <div className="card-heading">Enrolled Students ({enrolledStudents.length})</div>
              <div className="card-subheading">
                Protected face baselines &amp; credential management
              </div>
            </div>
            <button
              className="tt-filter-btn"
              style={{ padding: '6px 12px', fontSize: 11 }}
              onClick={() => onStudentEnrolled?.()}
            >
              <RefreshCw size={12} style={{ display: 'inline', marginRight: 4 }} />
              Refresh
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 540, overflowY: 'auto' }}>
            {enrolledStudents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                No students enrolled yet. Add your first student on the left!
              </div>
            ) : (
              enrolledStudents.map((stu) => (
                <div
                  key={stu.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-surface)'
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      background: '#e2e8f0',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      fontWeight: 700
                    }}
                  >
                    {stu.has_face_encoding && stu.face_url ? (
                      <img
                        src={`${API_BASE}${stu.face_url}&token=${encodeURIComponent(authToken || '')}`}
                        alt={stu.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      'No Img'
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>
                      {stu.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {stu.enrollment_no || stu.email}
                      {stu.group ? ` • ${stu.group}` : ''}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <span className={`badge ${stu.has_face_encoding ? 'badge-success' : 'badge-warning'}`}>
                        {stu.has_face_encoding ? 'Face Baseline Ready' : 'No Face Enrolled'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="tt-filter-btn"
                      style={{ padding: '6px 10px', fontSize: 11 }}
                      onClick={() => {
                        setActionMode('existing');
                        setSelectedStudentId(String(stu.id));
                        setResultBox(null);
                      }}
                    >
                      Update Photo
                    </button>
                    <button
                      type="button"
                      className="tt-filter-btn"
                      style={{ padding: '6px 8px', fontSize: 11 }}
                      onClick={() => handleResetPassword(stu)}
                      disabled={resettingId === stu.id}
                      title="Generate new password to share with student"
                    >
                      <KeyRound size={13} />
                    </button>
                    {stu.id !== 1 && (
                      <button
                        type="button"
                        className="tt-filter-btn"
                        style={{ padding: '6px 8px', color: 'var(--error)' }}
                        onClick={() => handleDeleteStudent(stu)}
                        disabled={deletingId === stu.id}
                        title="Delete student"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Coordinator-Only Faculty Onboarding */}
      {isAdmin && (
        <div className="dashboard-card" style={{ marginTop: 24 }}>
          <div className="card-head">
            <div>
              <div className="card-heading">
                <Award size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
                Coordinator Admin: Provision Faculty Account ({facultyList.length} Faculty)
              </div>
              <div className="card-subheading">
                Since public registration is disabled, only Coordinator/Admin can create new teacher logins
              </div>
            </div>
          </div>

          <form
            onSubmit={handleCreateFaculty}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}
          >
            <div className="field-group">
              <label className="field-label">Faculty Name *</label>
              <input
                className="field-input"
                type="text"
                placeholder="e.g. Dr. Priya Verma"
                value={facName}
                onChange={(e) => setFacName(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label">Faculty College Email *</label>
              <input
                className="field-input"
                type="email"
                placeholder="e.g. priya@glbajaj.ac.in"
                value={facEmail}
                onChange={(e) => setFacEmail(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label">Password *</label>
              <input
                className="field-input"
                type="text"
                placeholder="Min 4 characters"
                value={facPass}
                onChange={(e) => setFacPass(e.target.value)}
              />
            </div>
            <button type="submit" className="auth-btn primary" style={{ width: 'auto', padding: '11px 20px' }} disabled={facLoading}>
              {facLoading ? 'Creating...' : 'Create Faculty'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
