import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

// Default schema fallback fields (minimum 5, maximum 10 fields per assignment requirement)
const OBJECT_SCHEMA_MAP = {
  Account: ['Name', 'Type', 'Industry', 'Phone', 'AnnualRevenue'],
  Opportunity: ['Name', 'StageName', 'Amount', 'CloseDate', 'Probability'],
  Lead: ['FirstName', 'LastName', 'Company', 'Status', 'Email'],
  Contact: ['FirstName', 'LastName', 'Email', 'Phone', 'Title'],
  Case: ['CaseNumber', 'Subject', 'Status', 'Priority', 'Origin']
};

function App() {
  const [token, setToken] = useState(null);
  const [selectedObject, setSelectedObject] = useState('Account');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Form & Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [formData, setFormData] = useState({});

  const observer = useRef();
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const recordsCountRef = useRef(records.length);
  recordsCountRef.current = records.length;

  // 1. Session & Token Extraction
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('access_token');
    const instance = params.get('instance_url');

    if (accessToken && instance) {
      localStorage.setItem('sf_access_token', accessToken);
      localStorage.setItem('sf_instance_url', instance);
      setToken(accessToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const savedToken = localStorage.getItem('sf_access_token');
      if (savedToken) setToken(savedToken);
    }
  }, []);

  // 2. Fetch Records Function
  const fetchRecords = useCallback(async (objType, currentOffset, isReset = false) => {
    if (loadingRef.current) return;
    setLoading(true);

    try {
      const savedToken = localStorage.getItem('sf_access_token');
      const savedInstance = localStorage.getItem('sf_instance_url');

      const res = await axios.get(`${BACKEND_URL}/api/records/${objType}?offset=${currentOffset}`, {
        headers: {
          'Authorization': `Bearer ${savedToken}`,
          'x-instance-url': savedInstance
        }
      });

      const newRecords = res.data.records || [];
      setRecords(prev => (isReset ? newRecords : [...prev, ...newRecords]));
      setHasMore(newRecords.length === 20);
    } catch (err) {
      console.error('Error fetching records:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 3. Reset table when changing Object
  useEffect(() => {
    if (token) {
      setRecords([]);
      setHasMore(true);
      fetchRecords(selectedObject, 0, true);
    }
  }, [selectedObject, token, fetchRecords]);

  // 4. Infinite Scroll Observer
  const lastRecordElementRef = useCallback(
    node => {
      if (loading) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && hasMore) {
          fetchRecords(selectedObject, recordsCountRef.current, false);
        }
      });

      if (node) observer.current.observe(node);
    },
    [loading, hasMore, selectedObject, fetchRecords]
  );

  // Handle Form Submission (Create or Edit)
  const handleSubmit = async e => {
    e.preventDefault();
    const savedToken = localStorage.getItem('sf_access_token');
    const savedInstance = localStorage.getItem('sf_instance_url');
    const config = {
      headers: {
        'Authorization': `Bearer ${savedToken}`,
        'x-instance-url': savedInstance
      }
    };

    try {
      if (editingRecord) {
        await axios.patch(`${BACKEND_URL}/api/records/${selectedObject}/${editingRecord.Id}`, formData, config);
      } else {
        await axios.post(`${BACKEND_URL}/api/records/${selectedObject}`, formData, config);
      }
      setIsModalOpen(false);
      setEditingRecord(null);
      setFormData({});
      setRecords([]);
      fetchRecords(selectedObject, 0, true);
    } catch (err) {
      const errMsg = err.response?.data?.error?.[0]?.message || err.response?.data?.error || err.message;
      alert('Operation failed: ' + errMsg);
    }
  };

  // Handle Record Deletion
  const handleDelete = async id => {
    if (!window.confirm('Are you sure you want to delete this record?')) return;
    const savedToken = localStorage.getItem('sf_access_token');
    const savedInstance = localStorage.getItem('sf_instance_url');

    try {
      await axios.delete(`${BACKEND_URL}/api/records/${selectedObject}/${id}`, {
        headers: {
          'Authorization': `Bearer ${savedToken}`,
          'x-instance-url': savedInstance
        }
      });
      setRecords(prev => prev.filter(r => r.Id !== id));
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    setToken(null);
  };

  if (!token) {
    return (
      <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h1>Salesforce CRUD Application</h1>
        <button
          onClick={() => (window.location.href = `${BACKEND_URL}/auth/login`)}
          style={{
            padding: '12px 24px',
            backgroundColor: '#0070d2',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Login with Salesforce
        </button>
      </div>
    );
  }

  // Fallback to static schema fields if table has 0 records
  const columns = records.length > 0
    ? Object.keys(records[0]).filter(k => k !== 'attributes')
    : ['Id', ...(OBJECT_SCHEMA_MAP[selectedObject] || ['Name'])];

  // Fields visible in the Create / Edit Modal (exclude primary ID)
  const formFields = columns.filter(c => c !== 'Id');

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', backgroundColor: '#f4f6f9', minHeight: '100vh' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: '#fff', padding: '15px 20px', borderRadius: '8px' }}>
        <h2 style={{ margin: 0, color: '#0070d2' }}>Salesforce Dashboard</h2>

        <div>
          <label style={{ fontWeight: 'bold', marginRight: '10px' }}>Select Object: </label>
          <select
            value={selectedObject}
            onChange={e => setSelectedObject(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '14px' }}
          >
            <option value="Account">Account</option>
            <option value="Opportunity">Opportunity</option>
            <option value="Lead">Lead</option>
            <option value="Contact">Contact</option>
            <option value="Case">Case</option>
          </select>
        </div>

        <div>
          <button
            onClick={() => {
              setEditingRecord(null);
              setFormData({});
              setIsModalOpen(true);
            }}
            style={{ padding: '8px 16px', backgroundColor: '#2e844a', color: 'white', border: 'none', borderRadius: '4px', marginRight: '10px', cursor: 'pointer' }}
          >
            + Create {selectedObject}
          </button>
          <button onClick={handleLogout} style={{ padding: '8px 16px', backgroundColor: '#c9372c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Logout
          </button>
        </div>
      </div>

      {/* Dynamic Data Table */}
      <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#fafafb', borderBottom: '2px solid #dddbda' }}>
              {columns.map(col => (
                <th key={col} style={{ padding: '12px' }}>
                  {col}
                </th>
              ))}
              <th style={{ padding: '12px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => {
              const isLast = idx === records.length - 1;
              return (
                <tr key={rec.Id || idx} ref={isLast ? lastRecordElementRef : null} style={{ borderBottom: '1px solid #dddbda' }}>
                  {columns.map(col => (
                    <td key={col} style={{ padding: '12px' }}>
                      {String(rec[col] ?? '')}
                    </td>
                  ))}
                  <td style={{ padding: '12px' }}>
                    <button
                      onClick={() => {
                        setEditingRecord(rec);
                        setFormData(rec);
                        setIsModalOpen(true);
                      }}
                      style={{ padding: '4px 8px', marginRight: '5px', cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rec.Id)}
                      style={{ padding: '4px 8px', backgroundColor: '#c9372c', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <p style={{ textAlign: 'center', padding: '15px' }}>Loading records...</p>}
        {!loading && records.length === 0 && <p style={{ textAlign: 'center', padding: '15px' }}>No records found for {selectedObject}.</p>}
      </div>

      {/* Modal Form */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '8px', width: '400px' }}>
            <h3>
              {editingRecord ? 'Edit' : 'Create'} {selectedObject}
            </h3>
            <form onSubmit={handleSubmit}>
              {formFields.map(field => {
                const isReadOnly = field === 'CaseNumber';
                return (
                  <div key={field} style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                      {field} {isReadOnly && '(Auto-generated)'}
                    </label>
                    <input
                      type="text"
                      disabled={isReadOnly}
                      value={formData[field] || ''}
                      onChange={e => setFormData({ ...formData, [field]: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        boxSizing: 'border-box',
                        backgroundColor: isReadOnly ? '#eef1f6' : '#fff'
                      }}
                    />
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" style={{ backgroundColor: '#0070d2', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px' }}>
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;