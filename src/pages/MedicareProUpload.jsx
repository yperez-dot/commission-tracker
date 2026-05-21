import React, { useState } from 'react';

export default function MedicareProUpload() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // Simple CSV parser (browser-friendly)
  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }
    
    return rows;
  }

  // Handle file selection
  async function handleFileSelect(selectedFile) {
    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setError('❌ File must be CSV format');
      return;
    }

    setFile(selectedFile);
    setError(null);
    setSuccess(null);

    // Preview first 5 rows
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = e.target.result;
        const rows = parseCSV(csv);
        setPreview(rows.slice(0, 5));
      } catch (err) {
        setError('❌ Error reading CSV: ' + err.message);
      }
    };
    reader.readAsText(selectedFile);
  }

  // Handle upload
  async function handleUpload() {
    if (!file) {
      setError('❌ Please select a file');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/medicarepro/upload', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }

      const result = await response.json();
      setSuccess(`✅ Successfully imported ${result.inserted} records from MedicarePro!`);
      setFile(null);
      setPreview([]);
    } catch (err) {
      setError('❌ Upload error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Drag & drop handlers
  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">📊 Upload MedicarePro Sales</div>
        <div className="page-sub">Import your monthly client list from MedicarePro</div>
      </div>

      <div className="page-body">
        {/* Upload Area */}
        <div
          className="card"
          style={{
            border: dragOver ? '2px dashed var(--blue)' : '2px dashed var(--border)',
            background: dragOver ? 'var(--blue-light)' : 'transparent',
            padding: '40px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Drag & drop your MedicarePro CSV here
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Or click below to select a file
          </div>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            Choose File
            <input
              type="file"
              accept=".csv"
              onChange={(e) => e.target.files[0] && handleFileSelect(e.target.files[0])}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {/* Selected File */}
        {file && (
          <div className="card" style={{ marginTop: 20, background: 'var(--blue-light)', border: '1px solid var(--blue)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--blue-dark)' }}>
                  ✅ Selected: {file.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 4 }}>
                  Size: {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setFile(null);
                  setPreview([]);
                }}
                style={{ background: 'var(--red)', color: 'white' }}
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {/* Preview */}
        {preview.length > 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              Preview (first 5 rows):
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Policy Type</th>
                    <th>Effective Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{row.Name || '—'}</td>
                      <td>{row.Company || '—'}</td>
                      <td style={{ fontSize: 12 }}>{row['Policy Type'] || '—'}</td>
                      <td style={{ fontSize: 12 }}>{row['Effective Date'] || '—'}</td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background:
                              row.Status === 'Active'
                                ? 'var(--green-light)'
                                : row.Status === 'Canceled'
                                ? 'var(--red-light)'
                                : 'var(--text-muted)',
                            color:
                              row.Status === 'Active'
                                ? 'var(--green-dark)'
                                : row.Status === 'Canceled'
                                ? 'var(--red-dark)'
                                : 'var(--text)',
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600
                          }}
                        >
                          {row.Status || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="card"
            style={{
              marginTop: 20,
              background: 'var(--red-light)',
              border: '1px solid var(--red)',
              color: 'var(--red-dark)'
            }}
          >
            {error}
          </div>
        )}
