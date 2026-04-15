import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

const ROLES = ['admin', 'agent'];

export default function AdminUsers({ user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent', agency: '' });
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await apiFetch('/auth/users');
      setUsers(data);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function createUser(e) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      setStatus('Name, email and password are required.');
      return;
    }
    setCreating(true);
    setStatus('');
    try {
      await apiFetch('/auth/users', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setStatus(`✓ Account created for ${form.name}`);
      setForm({ name: '', email: '', password: '', role: 'agent', agency: '' });
      setShowForm(false);
      loadUsers();
    } catch(e) {
      setStatus('Error: ' + e.message);
    } finally { setCreating(false); }
  }

  async function deleteUser(id, name) {
    try {
      await apiFetch(`/auth/users/${id}`, { method: 'DELETE' });
      setUsers(prev => prev.filter(u => u.id !== id));
      setConfirmDelete(null);
    } catch(e) { console.error(e); }
  }

  async function resetPassword(id) {
    const newPass = prompt('Enter new password:');
    if (!newPass) return;
    try {
      await apiFetch(`/auth/users/${id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newPass })
      });
      alert('Password updated.');
    } catch(e) { alert('Error: ' + e.message); }
  }

  if (user.role !== 'admin') {
    return (
      <div className="page-body">
        <div className="empty-state">
          <div className="empty-icon">🔒</div>
          <div className="empty-title">Admin only</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {confirmDelete && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--bg)',borderRadius:12,padding:24,width:360,border:'0.5px solid var(--border)',boxShadow:'0 8px 32px rgba(0,0,0,0.15)'}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:8}}>Delete account?</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:16}}>
              This will permanently delete <strong>{confirmDelete.name}</strong> ({confirmDelete.email}). Their data will remain.
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setConfirmDelete(null)} className="btn">Cancel</button>
              <button onClick={()=>deleteUser(confirmDelete.id, confirmDelete.name)} className="btn btn-danger">Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">User Accounts</div>
        <div className="page-sub">Manage OliComm access for your team and agency partners</div>
      </div>
      <div className="page-body">

        {status && (
          <div style={{marginBottom:14,padding:'10px 14px',background:'var(--bg-subtle)',border:'0.5px solid var(--border)',borderRadius:8,fontSize:13,color:'var(--text)',display:'flex',alignItems:'center'}}>
            {status}
            <button onClick={()=>setStatus('')} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',fontSize:16,color:'var(--text-muted)'}}>×</button>
          </div>
        )}

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <span style={{fontSize:13,color:'var(--text-muted)'}}>{users.length} account{users.length!==1?'s':''}</span>
          <button className="btn btn-primary" onClick={()=>setShowForm(s=>!s)}>
            {showForm ? '✕ Cancel' : '+ New account'}
          </button>
        </div>

        {showForm && (
          <div className="card" style={{marginBottom:16}}>
            <div className="card-title">Create new account</div>
            <form onSubmit={createUser}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div>
                  <div className="form-label">Full name</div>
                  <input className="form-input" placeholder="Yaceli Rodriguez" value={form.name}
                    onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
                </div>
                <div>
                  <div className="form-label">Email (login)</div>
                  <input className="form-input" type="email" placeholder="yaceli@levelupinsurancegroup.com"
                    value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} />
                </div>
                <div>
                  <div className="form-label">Password</div>
                  <input className="form-input" type="password" placeholder="Temporary password"
                    value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} />
                </div>
                <div>
                  <div className="form-label">Agency name</div>
                  <input className="form-input" placeholder="Broker Society Insurance"
                    value={form.agency} onChange={e=>setForm(f=>({...f,agency:e.target.value}))} />
                </div>
                <div>
                  <div className="form-label">Role</div>
                  <select className="filter-select" style={{width:'100%'}} value={form.role}
                    onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
                    {ROLES.map(r=><option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
                {form.role==='agent'
                  ? '⚠️ Agent accounts only see records where the agent name matches their login name.'
                  : '⚠️ Admin accounts see all data across all agents.'}
              </div>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create account →'}
              </button>
            </form>
          </div>
        )}

        <div className="card" style={{padding:0}}>
          {loading ? (
            <div className="empty-state"><div className="empty-title" style={{color:'var(--text-muted)'}}>Loading...</div></div>
          ) : users.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">👤</div>
              <div className="empty-title">No accounts yet</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Agency</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u,i)=>(
                    <tr key={u.id}>
                      <td style={{color:'var(--text-muted)',fontSize:11}}>{i+1}</td>
                      <td style={{fontWeight:500}}>{u.name}</td>
                      <td style={{fontSize:12,color:'var(--text-muted)'}}>{u.email}</td>
                      <td style={{fontSize:12,color:'var(--text-muted)'}}>{u.agency||'—'}</td>
                      <td>
                        <span style={{
                          background: u.role==='admin' ? 'var(--accent-light)' : 'var(--bg-subtle)',
                          color: u.role==='admin' ? 'var(--accent-dark)' : 'var(--text-muted)',
                          borderRadius:4, padding:'2px 8px', fontSize:11, fontWeight:500
                        }}>{u.role}</span>
                      </td>
                      <td style={{fontSize:11,color:'var(--text-muted)'}}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <div style={{display:'flex',gap:6}}>
                          <button onClick={()=>resetPassword(u.id)}
                            style={{background:'none',border:'0.5px solid var(--border)',borderRadius:6,padding:'3px 10px',fontSize:11,cursor:'pointer',color:'var(--text)'}}>
                            Reset pw
                          </button>
                          {u.id !== user.id && (
                            <button onClick={()=>setConfirmDelete(u)} className="btn btn-danger" style={{fontSize:11,padding:'3px 10px'}}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
