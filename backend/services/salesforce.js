const axios = require('axios');

class SalesforceService {
    constructor(accessToken, instanceUrl) {
        this.accessToken = accessToken;
        this.instanceUrl = instanceUrl;
        this.apiVersion = 'v58.0';
    }

    // Generic request helper
    async request(method, path, data = null) {
        const url = `${this.instanceUrl}/services/data/${this.apiVersion}${path}`;
        try {
            const response = await axios({
                method,
                url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                data
            });
            return response.data;
        } catch (error) {
            console.error('Salesforce API Error:', error.response?.data || error.message);
            throw error.response?.data || error.message;
        }
    }

    // Query records with pagination
    async query(soql) {
        return this.request('GET', `/query?q=${encodeURIComponent(soql)}`);
    }

    // Get next set of records (for pagination)
    async queryMore(url) {
        const fullUrl = `${this.instanceUrl}${url}`;
        const response = await axios.get(fullUrl, {
            headers: { 'Authorization': `Bearer ${this.accessToken}` }
        });
        return response.data;
    }

    // CRUD Operations
    async create(objectType, record) {
        return this.request('POST', `/sobjects/${objectType}`, record);
    }

    async read(objectType, id) {
        return this.request('GET', `/sobjects/${objectType}/${id}`);
    }

    async update(objectType, id, record) {
        return this.request('PATCH', `/sobjects/${objectType}/${id}`, record);
    }

    async delete(objectType, id) {
        return this.request('DELETE', `/sobjects/${objectType}/${id}`);
    }

    // Get object metadata (fields)
    async describe(objectType) {
        return this.request('GET', `/sobjects/${objectType}/describe`);
    }
}

module.exports = SalesforceService;