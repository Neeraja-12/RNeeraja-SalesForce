const express = require('express');
const router = express.Router();
const SalesforceService = require('../services/salesforce.js');

// Middleware to get token from headers
const getSalesforceService = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    const instanceUrl = req.headers['x-instance-url'];
    
    if (!token || !instanceUrl) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    req.sfService = new SalesforceService(token, instanceUrl);
    next();
};

// GET records with pagination
router.get('/:object', getSalesforceService, async (req, res) => {
    const { object } = req.params;
    const { offset = 0, limit = 20 } = req.query;
    
    try {
        const soql = `SELECT Id, Name, CreatedDate FROM ${object} LIMIT ${limit} OFFSET ${offset}`;
        const result = await req.sfService.query(soql);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET object fields
router.get('/fields/:object', getSalesforceService, async (req, res) => {
    const { object } = req.params;
    
    try {
        const describe = await req.sfService.describe(object);
        const fields = describe.fields
            .filter(f => !f.name.endsWith('Id') && !f.name.endsWith('__c'))
            .slice(0, 10)
            .map(f => ({ name: f.name, label: f.label, type: f.type }));
        res.json(fields);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// CREATE record
router.post('/:object', getSalesforceService, async (req, res) => {
    try {
        const result = await req.sfService.create(req.params.object, req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UPDATE record
router.patch('/:object/:id', getSalesforceService, async (req, res) => {
    try {
        const result = await req.sfService.update(req.params.object, req.params.id, req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE record
router.delete('/:object/:id', getSalesforceService, async (req, res) => {
    try {
        const result = await req.sfService.delete(req.params.object, req.params.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;