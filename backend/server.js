const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const qs = require('qs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// In-memory store mapping state ID to PKCE verifier
const pkceStore = new Map();

// Generate PKCE verifier and SHA-256 challenge
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

// Field definitions for key Standard Objects (6 fields each, satisfying the 5-10 constraint)
const OBJECT_FIELDS = {
    Account: ['Id', 'Name', 'Type', 'Industry', 'Phone', 'AnnualRevenue'],
    Opportunity: ['Id', 'Name', 'StageName', 'Amount', 'CloseDate', 'Probability'],
    Lead: ['Id', 'FirstName', 'LastName', 'Company', 'Status', 'Email'],
    Contact: ['Id', 'FirstName', 'LastName', 'Email', 'Phone', 'Title'],
    Case: ['Id', 'CaseNumber', 'Subject', 'Status', 'Priority', 'Origin']
};

// Helper: Dynamic fallback for unknown standard or custom objects
const getFieldsForObject = (objectType) => {
    if (OBJECT_FIELDS[objectType]) {
        return OBJECT_FIELDS[objectType];
    }
    if (['Task', 'Event'].includes(objectType)) {
        return ['Id', 'Subject', 'Status', 'CreatedDate'];
    }
    return ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'];
};

// Helper: Sanitize request payload before creating/updating records
const sanitizeBody = (body) => {
    const cleanData = { ...body };
    // Primary identifiers & metadata
    delete cleanData.Id;
    delete cleanData.attributes;
    
    // Read-only system audit fields
    delete cleanData.CreatedDate;
    delete cleanData.LastModifiedDate;
    delete cleanData.CreatedById;
    delete cleanData.LastModifiedById;
    delete cleanData.SystemModstamp;
    
    // Auto-number fields (Salesforce throws errors if updated)
    delete cleanData.CaseNumber;

    return cleanData;
};

const getSfClient = (req) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.access_token;
    const instanceUrl = req.headers['x-instance-url'] || req.query.instance_url;
    return axios.create({
        baseURL: instanceUrl,
        headers: { Authorization: `Bearer ${token}` }
    });
};

// ==========================================
// OAUTH 2.0 PKCE LOGIN & CALLBACK
// ==========================================

app.get('/auth/login', (req, res) => {
    const authUrl = 'https://login.salesforce.com/services/oauth2/authorize';
    const { verifier, challenge } = generatePKCE();
    const state = Date.now().toString() + '_' + Math.random().toString(36).substring(2);

    pkceStore.set(state, verifier);
    setTimeout(() => pkceStore.delete(state), 10 * 60 * 1000);

    const params = {
        response_type: 'code',
        client_id: process.env.CLIENT_ID,
        redirect_uri: process.env.REDIRECT_URI,
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    };

    res.redirect(`${authUrl}?${qs.stringify(params)}`);
});

const handleCallback = async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
        return res.status(400).send(`OAuth Error: ${error} - ${error_description}`);
    }
    if (!code) {
        return res.status(400).send('Missing authorization code');
    }

    const codeVerifier = pkceStore.get(state);
    if (state) pkceStore.delete(state);

    const tokenUrl = 'https://login.salesforce.com/services/oauth2/token';
    const payload = {
        grant_type: 'authorization_code',
        code: code,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        code_verifier: codeVerifier
    };

    try {
        const response = await axios.post(tokenUrl, qs.stringify(payload), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token, instance_url } = response.data;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        return res.redirect(`${frontendUrl}/?access_token=${encodeURIComponent(access_token)}&instance_url=${encodeURIComponent(instance_url)}`);
    } catch (err) {
        console.error('Token Exchange Error:', err.response?.data || err.message);
        res.status(500).send('Authentication failed: ' + (err.response?.data?.error_description || err.message));
    }
};

app.get('/auth/callback', handleCallback);
app.get('/oauth/callback', handleCallback);
app.get('/callback', handleCallback);

// ==========================================
// REST API ENDPOINTS
// ==========================================

// GET Records
app.get('/api/records/:objectType', async (req, res) => {
    const { objectType } = req.params;
    const offset = parseInt(req.query.offset) || 0;
    const fields = getFieldsForObject(objectType);

    const query = `SELECT ${fields.join(', ')} FROM ${objectType} ORDER BY CreatedDate DESC LIMIT 20 OFFSET ${offset}`;

    try {
        const sf = getSfClient(req);
        const response = await sf.get(`/services/data/v58.0/query/?q=${encodeURIComponent(query)}`);
        res.json({
            records: response.data.records,
            done: response.data.done,
            totalSize: response.data.totalSize
        });
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.response?.data || err.message });
    }
});

// CREATE Record
app.post('/api/records/:objectType', async (req, res) => {
    const { objectType } = req.params;
    const payload = sanitizeBody(req.body);

    try {
        const sf = getSfClient(req);
        const response = await sf.post(`/services/data/v58.0/sobjects/${objectType}`, payload);
        res.json(response.data);
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.response?.data || err.message });
    }
});

// UPDATE Record
app.patch('/api/records/:objectType/:id', async (req, res) => {
    const { objectType, id } = req.params;
    const payload = sanitizeBody(req.body);

    try {
        const sf = getSfClient(req);
        await sf.patch(`/services/data/v58.0/sobjects/${objectType}/${id}`, payload);
        res.json({ success: true, id });
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.response?.data || err.message });
    }
});

// DELETE Record
app.delete('/api/records/:objectType/:id', async (req, res) => {
    const { objectType, id } = req.params;
    try {
        const sf = getSfClient(req);
        await sf.delete(`/services/data/v58.0/sobjects/${objectType}/${id}`);
        res.json({ success: true, id });
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.response?.data || err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));