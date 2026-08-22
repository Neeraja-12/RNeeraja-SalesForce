import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 
  (window.location.hostname === 'localhost' ? 'http://localhost:5000' : '');

const LOGIN_URL = `${BACKEND_URL}/auth/login`;

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

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [formData, setFormData] = useState({});

  const observer = useRef();
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const recordsCountRef = useRef(records.length);
  recordsCountRef.current = records.length;

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

  useEffect(() => {
    if (token) {
      setRecords([]);
      setHasMore(true);
      fetchRecords(selectedObject, 0, true);
    }
  }, [selectedObject, token, fetchRecords]);

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
      <div style={styles.loginContainer}>
        <div style={styles.loginCard}>
          <div style={styles.logoBadge}>☁️</div>
          <h1 style={styles.loginTitle}>Salesforce Hub</h1>
          <p style={styles.loginSubtitle}>Manage your CRM records seamlessly in real time.</p>
          <button onClick={() => (window.location.href = LOGIN_URL)} style={styles.loginBtn}>
            Login with Salesforce
          </button>
        </div>
      </div>
    );
  }

  const columns = records.length > 0
    ? Object.keys(records[0]).filter(k => k !== 'attributes')
    : ['Id', ...(OBJECT_SCHEMA_MAP[selectedObject] || ['Name'])];

  const formFields = (OBJECT_SCHEMA_MAP[selectedObject] || columns).filter(c => c !== 'Id');

  return (
    <div style={styles.appWrapper}>
      {/* Navbar Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.appIcon}>⚡</div>
          <div>
            <h1 style={styles.headerTitle}>Salesforce Management Portal</h1>
            <span style={styles.headerStatus}>● Connected via OAuth 2.0</span>
          </div>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.selectWrapper}>
            <label style={styles.selectLabel}>Object View</label>
            <select
              value={selectedObject}
              onChange={e => setSelectedObject(e.target.value)}
              style={styles.selectInput}
            >
              <option value="Account">Account</option>
              <option value="Opportunity">Opportunity</option>
              <option value="Lead">Lead</option>
              <option value="Contact">Contact</option>
              <option value="Case">Case</option>
            </select>
          </div>

          <button
            onClick={() => {
              setEditingRecord(null);
              setFormData({});
              setIsModalOpen(true);
            }}
            style={styles.createBtn}
          >
            + Create {selectedObject}
          </button>

          <button onClick={handleLogout} style={styles.logoutBtn}>
            Logout
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={styles.mainContent}>
        <div style={styles.tableCard}>
          <div style={styles.tableHeaderBar}>
            <div>
              <h3 style={styles.tableTitle}>{selectedObject} Directory</h3>
              <p style={styles.tableSubtitle}>Viewing all current records synchronized with Salesforce</p>
            </div>
            <span style={styles.recordBadge}>{records.length} items loaded</span>
          </div>

          <div style={styles.tableResponsive}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={col} style={styles.th}>{col}</th>
                  ))}
                  <th style={{ ...styles.th, textAlign: 'right', minWidth: '140px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec, idx) => {
                  const isLast = idx === records.length - 1;
                  return (
                    <tr
                      key={rec.Id || idx}
                      ref={isLast ? lastRecordElementRef : null}
                      style={{
                        ...styles.tr,
                        backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8fafc'
                      }}
                    >
                      {columns.map(col => {
                        const cellVal = rec[col];
                        const isIdCol = col === 'Id';
                        return (
                          <td key={col} style={styles.td}>
                            {cellVal !== null && cellVal !== undefined && String(cellVal).trim() !== '' ? (
                              <span style={isIdCol ? styles.idCell : styles.textCell}>
                                {String(cellVal)}
                              </span>
                            ) : (
                              <span style={styles.emptyCell}>—</span>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => {
                            setEditingRecord(rec);
                            const cleanData = { ...rec };
                            delete cleanData.attributes;
                            delete cleanData.Id;
                            setFormData(cleanData);
                            setIsModalOpen(true);
                          }}
                          style={styles.editBtn}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(rec.Id)}
                          style={styles.deleteBtn}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {loading && (
            <div style={styles.loadingState}>
              <div style={styles.spinner}></div>
              <span>Fetching records from Salesforce...</span>
            </div>
          )}

          {!loading && records.length === 0 && (
            <div style={styles.emptyState}>
              <p>No records found for {selectedObject}.</p>
            </div>
          )}
        </div>
      </main>

      {/* Modal Dialog */}
      {isModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalCard}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                {editingRecord ? 'Edit' : 'Create'} {selectedObject}
              </h3>
              <button onClick={() => setIsModalOpen(false)} style={styles.closeBtn}>×</button>
            </div>

            <form onSubmit={handleSubmit} style={styles.modalBody}>
              {formFields.map(field => {
                const isReadOnly = field === 'CaseNumber';
                return (
                  <div key={field} style={styles.formGroup}>
                    <label style={styles.label}>
                      {field} {isReadOnly && <span style={styles.readOnlyTag}>(Auto-generated)</span>}
                    </label>
                    <input
                      type="text"
                      disabled={isReadOnly}
                      value={formData[field] || ''}
                      onChange={e => setFormData({ ...formData, [field]: e.target.value })}
                      style={{
                        ...styles.input,
                        backgroundColor: isReadOnly ? '#f1f5f9' : '#ffffff'
                      }}
                    />
                  </div>
                );
              })}

              <div style={styles.modalFooter}>
                <button type="button" onClick={() => setIsModalOpen(false)} style={styles.cancelBtn}>
                  Cancel
                </button>
                <button type="submit" style={styles.saveBtn}>
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Optimized Visual Styles for High Contrast & Readability
const styles = {
  appWrapper: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: '#f1f5f9',
    minHeight: '100vh',
    color: '#0f172a'
  },
  loginContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    backgroundColor: '#0f172a'
  },
  loginCard: {
    background: '#ffffff',
    padding: '48px',
    borderRadius: '16px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%'
  },
  logoBadge: {
    fontSize: '48px',
    marginBottom: '16px'
  },
  loginTitle: {
    margin: '0 0 8px 0',
    fontSize: '24px',
    color: '#0f172a',
    fontWeight: '700'
  },
  loginSubtitle: {
    margin: '0 0 32px 0',
    color: '#475569',
    fontSize: '14px'
  },
  loginBtn: {
    width: '100%',
    padding: '12px 24px',
    backgroundColor: '#0284c7',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '600',
    fontSize: '16px',
    cursor: 'pointer'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: '16px 32px',
    borderBottom: '1px solid #cbd5e1',
    position: 'sticky',
    top: 0,
    zIndex: 10
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  appIcon: {
    fontSize: '28px'
  },
  headerTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '700',
    color: '#0f172a'
  },
  headerStatus: {
    fontSize: '12px',
    color: '#15803d',
    fontWeight: '600'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  selectWrapper: {
    display: 'flex',
    flexDirection: 'column'
  },
  selectLabel: {
    fontSize: '10px',
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#475569',
    marginBottom: '2px'
  },
  selectInput: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #94a3b8',
    backgroundColor: '#ffffff',
    fontWeight: '600',
    color: '#0f172a',
    cursor: 'pointer'
  },
  createBtn: {
    padding: '9px 18px',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  logoutBtn: {
    padding: '9px 18px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  mainContent: {
    padding: '32px'
  },
  tableCard: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
    border: '1px solid #cbd5e1',
    overflow: 'hidden'
  },
  tableHeaderBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #e2e8f0',
    backgroundColor: '#ffffff'
  },
  tableTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '700',
    color: '#0f172a'
  },
  tableSubtitle: {
    margin: '4px 0 0 0',
    fontSize: '12px',
    color: '#64748b'
  },
  recordBadge: {
    backgroundColor: '#e0f2fe',
    color: '#0369a1',
    padding: '6px 14px',
    borderRadius: '9999px',
    fontSize: '13px',
    fontWeight: '700'
  },
  tableResponsive: {
    overflowX: 'auto',
    width: '100%'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
    textAlign: 'left'
  },
  th: {
    backgroundColor: '#f1f5f9',
    padding: '14px 20px',
    fontWeight: '700',
    color: '#1e293b',
    borderBottom: '2px solid #cbd5e1',
    fontSize: '13px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  tr: {
    borderBottom: '1px solid #e2e8f0'
  },
  td: {
    padding: '14px 20px',
    color: '#0f172a',
    fontSize: '14px',
    verticalAlign: 'middle',
    maxWidth: '280px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  textCell: {
    fontWeight: '500',
    color: '#0f172a'
  },
  idCell: {
    fontFamily: 'monospace',
    fontSize: '12px',
    backgroundColor: '#f1f5f9',
    color: '#475569',
    padding: '2px 6px',
    borderRadius: '4px',
    border: '1px solid #e2e8f0'
  },
  emptyCell: {
    color: '#94a3b8',
    fontWeight: '400'
  },
  editBtn: {
    padding: '6px 14px',
    backgroundColor: '#e0f2fe',
    color: '#0284c7',
    border: '1px solid #bae6fd',
    borderRadius: '6px',
    fontWeight: '600',
    marginRight: '8px',
    cursor: 'pointer'
  },
  deleteBtn: {
    padding: '6px 14px',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  loadingState: {
    padding: '32px',
    textAlign: 'center',
    color: '#475569',
    fontWeight: '500'
  },
  emptyState: {
    padding: '48px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '15px'
  },
  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '500px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    overflow: 'hidden'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #cbd5e1',
    backgroundColor: '#f8fafc'
  },
  modalTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '700',
    color: '#0f172a'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#64748b',
    cursor: 'pointer'
  },
  modalBody: {
    padding: '24px'
  },
  formGroup: {
    marginBottom: '16px'
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: '#334155',
    marginBottom: '6px'
  },
  readOnlyTag: {
    color: '#64748b',
    fontWeight: '400'
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '6px',
    border: '1px solid #94a3b8',
    boxSizing: 'border-box',
    fontSize: '14px',
    color: '#0f172a'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px'
  },
  cancelBtn: {
    padding: '10px 18px',
    backgroundColor: '#f1f5f9',
    color: '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  saveBtn: {
    padding: '10px 18px',
    backgroundColor: '#0284c7',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default App;