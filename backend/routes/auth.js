const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const crypto = require('crypto');
require('dotenv').config();

// Memory store for PKCE verifiers
const verifierStore = new Map();

// Helper: Generate PKCE code verifier and challenge
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

// Helper: Primary OAuth Callback Handler Logic
async function handleCallback(req, res) {
    console.log(`🔵 Callback endpoint hit: ${req.originalUrl}`);
    const { code, error, error_description } = req.query;
    
    if (error) {
        console.error('❌ OAuth Error:', error, error_description);
        return res.status(400).send(`OAuth Error: ${error} - ${error_description}`);
    }
    
    if (!code) {
        return res.status(400).send('❌ Missing authorization code');
    }

    // Retrieve PKCE verifier using the session cookie
    const sessionId = req.cookies?.session_id;
    const verifier = sessionId ? verifierStore.get(sessionId) : null;

    if (!verifier) {
        console.warn('⚠️ Warning: PKCE Verifier missing from session storage.');
    }

    const tokenUrl = 'https://login.salesforce.com/services/oauth2/token';
    const payload = {
        grant_type: 'authorization_code',
        code: code,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI
    };
    
    if (verifier) {
        payload.code_verifier = verifier;
    }

    try {
        console.log('🔄 Exchanging authorization code for access token...');
        const response = await axios.post(tokenUrl, qs.stringify(payload), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const { access_token, instance_url } = response.data;
        console.log('✅ Access token received successfully!');
        
        // Cleanup memory store and cookie
        if (sessionId) verifierStore.delete(sessionId);
        res.clearCookie('session_id');
        
        // Redirect back to React app with token and instance URL
        const redirectUrl = `${process.env.FRONTEND_URL}/?access_token=${encodeURIComponent(access_token)}&instance_url=${encodeURIComponent(instance_url)}`;
        console.log('🔄 Redirecting user to React frontend:', redirectUrl);
        res.redirect(redirectUrl);
        
    } catch (err) {
        console.error('❌ Token Exchange Error:', err.response?.data || err.message);
        res.status(500).send('Authentication failed: ' + (err.response?.data?.error_description || err.message));
    }
}

// ==========================================
// ROUTES DEFINITION
// ==========================================

// 1. LOGIN ROUTE - Initiates PKCE & redirects to Salesforce
router.get('/login', (req, res) => {
    const authUrl = 'https://login.salesforce.com/services/oauth2/authorize';
    const { verifier, challenge } = generatePKCE();
    const sessionId = Date.now().toString() + '_' + Math.random().toString(36).substring(2);
    
    // Store verifier mapped to session ID
    verifierStore.set(sessionId, verifier);
    
    // Set cookie so session survives Salesforce redirect
    res.cookie('session_id', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000 // 10 minutes
    });

    const params = {
        response_type: 'code',
        client_id: process.env.CLIENT_ID,
        redirect_uri: process.env.REDIRECT_URI,
        scope: 'api refresh_token',
        code_challenge: challenge,
        code_challenge_method: 'S256'
    };
    
    console.log('🔐 Redirecting to Salesforce authorization URL...');
    res.redirect(`${authUrl}?${qs.stringify(params)}`);
});

// 2. CALLBACK ROUTES - Catches standard and alias callback paths
router.get('/callback', handleCallback);
router.get('/oauth/callback', handleCallback);

module.exports = router;