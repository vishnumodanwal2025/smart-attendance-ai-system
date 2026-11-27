import React, { useState } from 'react';
import { LogIn, User, Award, Shield, Lock } from 'lucide-react';
import { API_BASE } from '../constants/scheduleData';

export default function AuthOverlay({ onLoginSuccess, showToast }) {
  // Student Sign In inputs
  const [studentId, setStudentId] = useState('');
  const [studentPass, setStudentPass] = useState('');
  const [studentError, setStudentError] = useState('');
  const [studentLoading, setStudentLoading] = useState(false);

  // Faculty Sign In inputs
  const [profEmail, setProfEmail] = useState('');
  const [profPass, setProfPass] = useState('');
  const [profError, setProfError] = useState('');
  const [profLoading, setProfLoading] = useState(false);

  const handleStudentSignIn = async (e) => {
    e?.preventDefault();
    setStudentError('');

    const idVal = studentId.trim();
    if (!idVal || !studentPass) {
      setStudentError('Please provide both Student ID/Email and password.');
      return;
    }

    setStudentLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: idVal, password: studentPass })
      });
      const data = await res.json();
      setStudentLoading(false);

      if (res.ok && data.user && data.access_token) {
        if (data.user.role !== 'student') {
          setStudentError('This is a faculty account. Please sign in via Faculty Sign In.');
          return;
        }
        onLoginSuccess(data.user, data.access_token);
        showToast('success', `Welcome, ${data.user.name}!`);
      } else {
        setStudentError(data.detail || 'Invalid credentials.');
      }
    } catch (err) {
      setStudentLoading(false);
      setStudentError('Cannot reach backend server: ' + err.message);
    }
  };

  const handleProfSignIn = async (e) => {
    e?.preventDefault();
    setProfError('');

    const emailVal = profEmail.trim();
    if (!emailVal || !profPass) {
      setProfError('Please provide faculty email and password.');
      return;
    }

    setProfLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailVal, password: profPass })
      });
      const data = await res.json();
      setProfLoading(false);

      if (res.ok && data.user && data.access_token) {
        if (data.user.role !== 'professor') {
          setProfError('This is a student account. Please sign in via Student Sign In.');
          return;
        }
        onLoginSuccess(data.user, data.access_token);
        showToast('success', `Welcome, ${data.user.name}!`);
      } else {
        setProfError(data.detail || 'Invalid credentials.');
      }
    } catch (err) {
      setProfLoading(false);
      setProfError('Cannot reach backend server: ' + err.message);
    }
  };

  return (
    <div id="loginOverlay" role="dialog" aria-modal="true">
      <div className="auth-header">
        <div className="auth-logo-row">
          <div className="auth-logo-badge">
            <Shield size={32} color="#ffffff" strokeWidth={2.2} />
          </div>
          <div>
            <div className="auth-college-title">GL BAJAJ</div>
            <div className="auth-college-sub">Group of Institutions, Mathura</div>
          </div>
        </div>
        <div className="auth-dept-tag">
          Dept. of Computer Science &amp; Engineering &bull; CSE-AIML &amp; CS
        </div>
      </div>

      <div className="auth-card-container">
        <div
          style={{
            padding: '14px 24px',
            background: 'var(--bg-surface)',
            borderBottom: '1.5px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: 'var(--primary)' }}>
            <LogIn size={18} />
            <span>Institutional Portal Sign In</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <Lock size={13} />
            <span>Accounts are provisioned &amp; shared by Faculty Coordinator only</span>
          </div>
        </div>

        <div className="auth-content-area" id="authSignInArea">
          <div className="signin-panels-grid">
            {/* Student Login Box */}
            <form className="signin-box student-accent" onSubmit={handleStudentSignIn}>
              <div className="signin-box-header">
                <div className="signin-icon student">
                  <User size={22} />
                </div>
                <div>
                  <div className="signin-title">Student Sign In</div>
                  <div className="signin-sub">Use credentials shared by your faculty</div>
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">Student ID or College Email</label>
                <input
                  className="field-input"
                  type="text"
                  placeholder="e.g. 25CSAIM076 or student@college.edu"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  autoComplete="username"
                />
              </div>

              <div className="field-group">
                <label className="field-label">Password</label>
                <input
                  className="field-input"
                  type="password"
                  placeholder="Enter faculty-provided password"
                  value={studentPass}
                  onChange={(e) => setStudentPass(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

              {studentError && (
                <div className="auth-error show">{studentError}</div>
              )}

              <button type="submit" className="auth-btn primary" disabled={studentLoading}>
                {studentLoading && <span className="btn-loader"></span>}
                Sign In as Student
              </button>
            </form>

            {/* Professor Login Box */}
            <form className="signin-box prof-accent" onSubmit={handleProfSignIn}>
              <div className="signin-box-header">
                <div className="signin-icon prof">
                  <Award size={22} />
                </div>
                <div>
                  <div className="signin-title">Faculty Sign In</div>
                  <div className="signin-sub">Subject Teacher / Coordinator Admin</div>
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">Faculty College Email</label>
                <input
                  className="field-input"
                  type="email"
                  placeholder="e.g. bhanu@glbajaj.ac.in"
                  value={profEmail}
                  onChange={(e) => setProfEmail(e.target.value)}
                  autoComplete="username"
                />
              </div>

              <div className="field-group">
                <label className="field-label">Password</label>
                <input
                  className="field-input"
                  type="password"
                  placeholder="Enter your password"
                  value={profPass}
                  onChange={(e) => setProfPass(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

              {profError && (
                <div className="auth-error show">{profError}</div>
              )}

              <button type="submit" className="auth-btn danger" disabled={profLoading}>
                {profLoading && <span className="btn-loader"></span>}
                Sign In as Faculty
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="auth-footer">
        &copy; 2026 GL Bajaj Group of Institutions, Mathura &bull; B.Tech CSE-AIML &amp; CS (Sem III)
      </div>
    </div>
  );
}
