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

// Root health-check endpoint (fixes "Cannot GET /")
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Salesforce Express API is running on Vercel',
        endpoints: {
            auth: '/auth/login',
            records: '/api/records/:objectType'
        }
    });
});

// Generate PKCE verifier and SHA-256 challenge
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

// Field definitions for key Standard Objects
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
    delete cleanData.Id;
    delete cleanData.attributes;
    delete cleanData.CreatedDate;
    delete cleanData.LastModifiedDate;
    delete cleanData.CreatedById;
    delete cleanData.LastModifiedById;
    delete cleanData.SystemModstamp;
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

    // Save PKCE verifier inside an HTTP-only Cookie for serverless reliability
    res.cookie(`pkce_${state}`, verifier, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000 // 10 minutes
    });

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

    // Retrieve PKCE verifier from incoming cookies
    const codeVerifier = req.cookies[`pkce_${state}`];
    res.clearCookie(`pkce_${state}`);

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

// ==========================================
// EXPORT FOR VERCEL & LOCAL SERVER
// ==========================================

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
}

module.exports = app;