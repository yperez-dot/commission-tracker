import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { formatDateTime } from '../utils/dateFormat';

export default function Agents({ user }) {
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent' });
  const [status, setStatus] = useState(null);

  useEffect(() => { loadAgents(); }, []);

  async function loadAgents() {
    try {
      const data = await apiFetch('/auth/agents');
      setAgents(data);
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    try {
      await apiFetch('/auth/agents', { method: 'POST', body: JSON.stringify(form) });
      setStatus({ type: 'success', msg: `Agent ${form.name} added successfully` });
      setForm({ name: '', email: '', password: '', role: 'agent' });
      setShowForm(false);
      loadAgents();
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    }
  }

  const initials = name => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <>
      <div className="page-header">
        <div className="page-title">Agents</div>
        <div className="page-sub">Manage who has access to the tracker</div>
      </div>
      <div className="page-body">
        {status && (
          <div className={`alert alert-${status.type === 'error' ? 'error' : 'success'}`} style={{marginBottom:14}}>
            {status.msg}
            <button onClick={() => setStatus(null)} style={{marginLeft:'auto', background:'none', border:'none', cursor:'pointer', fontSize:14}}>×</button>
          </div>
        )}

        <div style={{display:'flex', justifyContent:'flex-end', marginBottom:12}}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add agent'}
          </button>
        </div>

        {showForm && (
          <div className="card" style={{marginBottom:14}}>
            <div className="card-title">Add new agent</div>
            <form onSubmit={handleAdd}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                <div className="form-group">
                  <label className="form-label">Full name</label>
                  <input className="form-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Jill Taylor" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="jill@healthexps.com" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Temporary password</label>
                  <input className="form-input" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="min 8 characters" required minLength={6} />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-input" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                    <option value="agent">Agent (sees own data only)</option>
                    <option value="admin">Admin (sees all data)</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-sm">Add agent</button>
            </form>
          </div>
        )}

        <div className="card" style={{padding:0}}>
          {!agents.length ? (
            <div className="empty-state">
              <div className="empty-sub">No agents found</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Agent</th><th>Email</th><th>Role</th><th>Joined</th></tr>
                </thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.id}>
                      <td>
                        <div style={{display:'flex', alignItems:'center', gap:10}}>
                          <div style={{width:32, height:32, borderRadius:'50%', background:'var(--blue-light)', color:'var(--blue)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:600, fontSize:12, flexShrink:0}}>
                            {initials(a.name)}
                          </div>
                          <span style={{fontWeight:500}}>{a.name}</span>
                          {a.id === user.id && <span className="badge badge-blue" style={{fontSize:10}}>you</span>}
                        </div>
                      </td>
                      <td style={{color:'var(--text-muted)', fontSize:13}}>{a.email}</td>
                      <td><span className={`badge ${a.role === 'admin' ? 'badge-blue' : 'badge-gray'}`}>{a.role}</span></td>
                      <td style={{fontSize:12, color:'var(--text-muted)'}}>{formatDateTime(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
