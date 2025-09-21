// CSV Upload functionality with GTM API integration - Production Version
console.log('CSV Upload page loaded');

class AppStateManager {
    constructor() {
        this.csvData = [];
        this.processedData = null;
        this.gtmManager = null;
        this.gtmConfig = {
            accountId: '',
            containerId: '',
            measurementId: '',
            accounts: [],
            containers: [],
            accessToken: ''
        };
        this.isInitialized = false;
        this.initializationPromise = null;
    }

    reset() {
        this.csvData = [];
        this.processedData = null;
        this.gtmConfig = {
            accountId: '',
            containerId: '',
            measurementId: '',
            accounts: [],
            containers: [],
            accessToken: ''
        };
    }

    updateGTMConfig(updates) {
        this.gtmConfig = { ...this.gtmConfig, ...updates };
    }
}

const appState = new AppStateManager();

const Utils = {
    getElement(id, required = true) {
        const element = document.getElementById(id);
        if (required && !element) {
            throw new Error(`Required DOM element '${id}' not found`);
        }
        return element;
    },

    safeUpdateElement(id, updateFn) {
        const element = this.getElement(id, false);
        if (element && typeof updateFn === 'function') {
            updateFn(element);
        }
    },

    generateWorkspaceName() {
        const date = new Date();
        const dateStr = date.toISOString().split('T')[0];
        const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
        return `Merkle | GA4 Events Configurations - ${dateStr} ${timeStr}`;
    },

    validateMeasurementId(id) {
        const regex = /^G-[A-Z0-9]{10}$/;
        return regex.test(id);
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

class GTMManager {
    constructor() {
        console.log('Initializing GTMManager...');
        this.accessToken = null;
        this.isAuthenticated = false;
        this.tokenClient = null;
        this.authPromise = null;
        this.initializationTriggerCache = new Map();
        this.measurementIdVariableCache = new Map();
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.requestsThisMinute = 0;
        this.lastResetTime = Date.now();
    }

    async rateLimitedApiCall(url, options = {}) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ url, options, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const now = Date.now();
            
            if (now - this.lastResetTime >= 60000) {
                this.requestsThisMinute = 0;
                this.lastResetTime = now;
            }

            if (this.requestsThisMinute >= 20) {
                const waitTime = 60000 - (now - this.lastResetTime) + 1000;
                console.log(`Rate limit reached (${this.requestsThisMinute}/20). Waiting ${Math.round(waitTime/1000)}s...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            const request = this.requestQueue.shift();
            this.requestsThisMinute++;

            try {
                const result = await this.apiCall(request.url, request.options);
                request.resolve(result);
            } catch (error) {
                if (error.message.includes('Quota exceeded') || error.message.includes('quota metric')) {
                    console.log('Quota exceeded detected, waiting 65 seconds before retry...');
                    this.requestsThisMinute = 20;
                    this.lastResetTime = now;
                    
                    await new Promise(resolve => setTimeout(resolve, 65000));
                    this.requestQueue.unshift(request);
                    continue;
                }
                request.reject(error);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.isProcessingQueue = false;
    }

    async initialize() {
        if (typeof google === 'undefined') {
            throw new Error('Google Identity Services not available. Please check your connection and disable ad blockers.');
        }

        try {
            google.accounts.id.initialize({
                client_id: '903553466558-ggf600mr9qauuimpfmc0olc94dledr2n.apps.googleusercontent.com'
            });

            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: '903553466558-ggf600mr9qauuimpfmc0olc94dledr2n.apps.googleusercontent.com',
                scope: 'https://www.googleapis.com/auth/tagmanager.edit.containers https://www.googleapis.com/auth/tagmanager.readonly',
                callback: (response) => {
                    if (response.error !== undefined) {
                        console.error('OAuth error:', response.error);
                        this.authReject?.(new Error(`Authentication failed: ${response.error}`));
                        return;
                    }
                    this.handleAuthSuccess(response);
                },
            });

            return this;
        } catch (error) {
            console.error('GTM Manager initialization failed:', error);
            throw new Error(`Failed to initialize GTM Manager: ${error.message}`);
        }
    }

    async authenticate() {
        if (this.isAuthenticated) {
            return Promise.resolve();
        }

        if (this.authPromise) {
            return this.authPromise;
        }

        console.log('Attempting GTM authentication...');
        
        this.authPromise = new Promise((resolve, reject) => {
            this.authResolve = resolve;
            this.authReject = reject;

            try {
                this.tokenClient.requestAccessToken({ prompt: 'consent' });
            } catch (error) {
                console.error('GTM Authentication failed:', error);
                reject(new Error(`GTM Authentication failed: ${error.message}`));
            }
        });

        return this.authPromise;
    }

    handleAuthSuccess(response) {
        console.log('GTM Authentication successful');
        this.isAuthenticated = true;
        this.accessToken = response.access_token;
        appState.updateGTMConfig({ accessToken: response.access_token });
        
        Utils.safeUpdateElement('authSection', (element) => {
    element.innerHTML = `
        <div class="auth-success">
            <button class="btn-primary" onclick="loadGTMAccounts()">
                Authenticated — Load GTM Accounts
            </button>
        </div>
    `;
});

        if (this.authResolve) {
            this.authResolve();
            this.authPromise = null;
        }
    }

    async apiCall(url, options = {}, retries = 3) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated with GTM');
        }

        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const finalOptions = { ...defaultOptions, ...options };
        if (finalOptions.headers) {
            finalOptions.headers = { ...defaultOptions.headers, ...options.headers };
        }

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await fetch(url, finalOptions);
                
                if (response.status === 401 && attempt === 0) {
                    this.isAuthenticated = false;
                    await this.authenticate();
                    finalOptions.headers['Authorization'] = `Bearer ${this.accessToken}`;
                    continue;
                }

                if (!response.ok) {
                    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                    try {
                        const errorData = await response.json();
                        if (errorData.error && errorData.error.message) {
                            errorMessage = errorData.error.message;
                        }
                    } catch (parseError) {
                    }
                    throw new Error(errorMessage);
                }

                return await response.json();
            } catch (error) {                
                if (attempt === retries - 1) {
                    throw error;
                }

                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }

    async loadAccounts() {
        try {
            const data = await this.rateLimitedApiCall('https://tagmanager.googleapis.com/tagmanager/v2/accounts');
            return data.account || [];
        } catch (error) {
            console.error('Error loading GTM accounts:', error);
            throw new Error(`Failed to load accounts: ${error.message}`);
        }
    }

    async loadContainers(accountId) {
        if (!accountId) {
            throw new Error('Account ID is required');
        }

        try {
            const data = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers`
            );
            return data.container || [];
        } catch (error) {
            console.error('Error loading GTM containers:', error);
            throw new Error(`Failed to load containers: ${error.message}`);
        }
    }

    async getOrCreateMeasurementIdVariable(accountId, containerId, workspaceId, measurementId) {
        const cacheKey = `${accountId}-${containerId}-${workspaceId}`;
        
        if (this.measurementIdVariableCache.has(cacheKey)) {
            return this.measurementIdVariableCache.get(cacheKey);
        }

        try {
            const variablesData = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/variables`
            );

            const existingVariable = (variablesData.variable || []).find(variable => 
                variable.type === 'c' && 
                variable.name === 'CONS - Measurement ID'
            );

            if (existingVariable) {
                this.measurementIdVariableCache.set(cacheKey, existingVariable.variableId);
                return existingVariable.variableId;
            }

            const variableData = {
                name: 'CONS - Measurement ID',
                type: 'c',
                parameter: [
                    {
                        type: 'TEMPLATE',
                        key: 'value',
                        value: measurementId
                    }
                ]
            };

            const newVariable = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/variables`,
                {
                    method: 'POST',
                    body: JSON.stringify(variableData)
                }
            );

            this.measurementIdVariableCache.set(cacheKey, newVariable.variableId);
            return newVariable.variableId;

        } catch (error) {
            console.error('Error getting/creating measurement ID variable:', error);
            throw new Error(`Failed to get measurement ID variable: ${error.message}`);
        }
    }

    async getOrCreateInitializationTrigger(accountId, containerId, workspaceId) {
        const cacheKey = `${accountId}-${containerId}-${workspaceId}`;
        
        if (this.initializationTriggerCache.has(cacheKey)) {
            return this.initializationTriggerCache.get(cacheKey);
        }

        try {
            const triggersData = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers`
            );

            const initializationTrigger = (triggersData.trigger || []).find(trigger => 
                trigger.type === 'init' || 
                (trigger.name === 'Initialization' || trigger.name.toLowerCase().includes('initialization'))
            );

            if (initializationTrigger) {
                this.initializationTriggerCache.set(cacheKey, initializationTrigger.triggerId);
                return initializationTrigger.triggerId;
            }

            const newTrigger = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        name: 'Initialization',
                        type: 'init',
                        filter: []
                    })
                }
            );

            this.initializationTriggerCache.set(cacheKey, newTrigger.triggerId);
            return newTrigger.triggerId;

        } catch (error) {
            console.error('Error getting/creating Initialization trigger:', error);
            throw new Error(`Failed to get Initialization trigger: ${error.message}`);
        }
    }

    async createWorkspace(accountId, containerId) {
        if (!accountId || !containerId) {
            throw new Error('Account ID and Container ID are required');
        }

        try {
            const workspaceData = {
                name: Utils.generateWorkspaceName(),
                description: 'Workspace created from CSV import for GA4 event configuration'
            };

            const workspace = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces`,
                {
                    method: 'POST',
                    body: JSON.stringify(workspaceData)
                }
            );

            return workspace;
        } catch (error) {
            console.error('Error creating workspace:', error);
            throw new Error(`Failed to create workspace: ${error.message}`);
        }
    }

    async createVariable(accountId, containerId, workspaceId, parameterName) {
        if (!parameterName || parameterName.trim() === '') {
            throw new Error('Parameter name is required');
        }

        try {
            const variableData = {
                name: `DLV - ${parameterName.trim()}`,
                type: 'v',
                parameter: [
                    {
                        type: 'TEMPLATE',
                        key: 'name',
                        value: parameterName.trim()
                    },
                    {
                        type: 'INTEGER',
                        key: 'dataLayerVersion',
                        value: '2'
                    }
                ]
            };

            const variable = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/variables`,
                {
                    method: 'POST',
                    body: JSON.stringify(variableData)
                }
            );

            return variable;
        } catch (error) {
            console.error(`Error creating variable ${parameterName}:`, error);
            throw new Error(`Failed to create variable ${parameterName}: ${error.message}`);
        }
    }

    async createTrigger(accountId, containerId, workspaceId, eventName) {
        if (!eventName || eventName.trim() === '') {
            throw new Error('Event name is required');
        }

        try {
            const triggerData = {
                name: `CE - ${eventName.trim()}`,
                type: 'customEvent',
                customEventFilter: [
                    {
                        type: 'equals',
                        parameter: [
                            {
                                type: 'TEMPLATE',
                                key: 'arg0',
                                value: '{{_event}}'
                            },
                            {
                                type: 'TEMPLATE',
                                key: 'arg1',
                                value: eventName.trim()
                            }
                        ]
                    }
                ]
            };

            const trigger = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers`,
                {
                    method: 'POST',
                    body: JSON.stringify(triggerData)
                }
            );

            return trigger;
        } catch (error) {
            console.error(`Error creating trigger ${eventName}:`, error);
            throw new Error(`Failed to create trigger ${eventName}: ${error.message}`);
        }
    }

    async createGA4ConfigTag(accountId, containerId, workspaceId, measurementIdVariableId) {
        try {
            const initializationTrigger = await this.getOrCreateInitializationTrigger(accountId, containerId, workspaceId);

            const configTagData = {
                name: 'GA4 - Config',
                type: 'gaawc',
                parameter: [
                    {
                        type: 'TEMPLATE',
                        key: 'measurementId',
                        value: '{{CONS - Measurement ID}}'
                    },
                    {
                        type: 'TEMPLATE',
                        key: 'measurementIdOverride',
                        value: '{{CONS - Measurement ID}}'
                    }
                ],
                firingTriggerId: [initializationTrigger]
            };

            const configTag = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags`,
                {
                    method: 'POST',
                    body: JSON.stringify(configTagData)
                }
            );

            return configTag;
        } catch (error) {
            console.error('Error creating GA4 Config tag:', error);
            throw new Error(`Failed to create GA4 Config tag: ${error.message}`);
        }
    }

    async createEventTag(accountId, containerId, workspaceId, eventName, parameters, triggerId, measurementIdVariableId) {
        if (!eventName || !triggerId) {
            throw new Error('Event name and trigger ID are required');
        }

        try {
            const tagParameters = [
                {
                    type: 'TEMPLATE',
                    key: 'measurementId',
                    value: '{{CONS - Measurement ID}}'
                },
                {
                    type: 'TEMPLATE',
                    key: 'eventName',
                    value: eventName
                },
                {
                    type: 'TEMPLATE',
                    key: 'measurementIdOverride',
                    value: '{{CONS - Measurement ID}}'
                }
            ];

            if (parameters && Array.isArray(parameters) && parameters.length > 0) {
                const validParameters = parameters.filter(param => 
                    param && 
                    typeof param === 'string' && 
                    param.trim() !== '' &&
                    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param.trim())
                );
                
                if (validParameters.length > 0) {
                    const eventParameters = validParameters.map(param => {
                        const cleanParam = param.trim();
                        return {
                            type: 'MAP',
                            map: [
                                {
                                    type: 'TEMPLATE',
                                    key: 'name',
                                    value: cleanParam
                                },
                                {
                                    type: 'TEMPLATE',
                                    key: 'value',
                                    value: `{{DLV - ${cleanParam}}}`
                                }
                            ]
                        };
                    });

                    tagParameters.push({
                        type: 'LIST',
                        key: 'eventParameters',
                        list: eventParameters
                    });
                }
            }

            const tagData = {
                name: `GA4 - Event - ${eventName}`,
                type: 'gaawe',
                parameter: tagParameters,
                firingTriggerId: [triggerId]
            };

            const tag = await this.rateLimitedApiCall(
                `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags`,
                {
                    method: 'POST',
                    body: JSON.stringify(tagData)
                }
            );

            return tag;
        } catch (error) {
            console.error(`Error creating event tag ${eventName}:`, error);
            throw new Error(`Failed to create event tag ${eventName}: ${error.message}`);
        }
    }
}

class FileUploadManager {
    constructor() {
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        const uploadArea = Utils.getElement('uploadArea', false);
        const fileInput = Utils.getElement('csvFile', false);

        if (!uploadArea || !fileInput) {
            console.warn('Upload elements not found - upload functionality disabled');
            return;
        }

        uploadArea.addEventListener('click', () => fileInput.click());

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFile(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFile(e.target.files[0]);
            }
        });
    }

    validateFile(file) {
        const errors = [];

        if (file.size > 10 * 1024 * 1024) {
            errors.push('File size exceeds 10MB limit');
        }

        const validExtensions = ['.csv'];
        const validMimeTypes = ['text/csv', 'text/plain', 'application/csv'];
        
        const hasValidExtension = validExtensions.some(ext => 
            file.name.toLowerCase().endsWith(ext)
        );
        const hasValidMimeType = validMimeTypes.includes(file.type) || file.type === '';

        if (!hasValidExtension) {
            errors.push('File must have .csv extension');
        }

        if (!hasValidMimeType && file.type !== '') {
            errors.push('Invalid file type. Please select a CSV file.');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    handleFile(file) {
        const validation = this.validateFile(file);
        if (!validation.isValid) {
            alert(`File validation failed:\n${validation.errors.join('\n')}`);
            return;
        }

        Utils.safeUpdateElement('uploadArea', (element) => {
            element.parentElement.style.display = 'none';
        });
        
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'block';
        });

        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                this.parseCSV(e.target.result);
            } catch (error) {
                console.error('Error parsing CSV:', error);
                alert(`Error parsing CSV file: ${error.message}\nPlease check the file format.`);
                this.resetUpload();
            }
        };

        reader.onerror = () => {
            console.error('Error reading file:', reader.error);
            alert('Error reading file. Please try again.');
            this.resetUpload();
        };

        reader.readAsText(file, 'UTF-8');
    }

    parseCSV(csvContent) {
        const parsed = Papa.parse(csvContent, {
            header: true,
            skipEmptyLines: true,
            beforeFirstChunk: function(chunk) {
                const rows = chunk.split(/\r\n|\r|\n/);
                rows.shift();
                return rows.join("\n");
            }
        });

        const csvData = [];

        parsed.data.forEach((row, index) => {
            const eventNameKey = Object.keys(row).find(key => 
                key.includes('GA4 Event') || key.includes('Event Name')
            );
            
            const parametersKey = Object.keys(row).find(key => 
                key.toLowerCase().includes('parameters')
            );

            if (eventNameKey && row[eventNameKey] && row[eventNameKey].trim()) {
                const eventName = row[eventNameKey].trim();
                const parametersString = parametersKey && row[parametersKey] ? row[parametersKey].trim() : '';

                const parameters = parametersString
                    .split(/[\s,\n\r]+/)
                    .map(p => p.trim())
                    .filter(p => p.length > 0);

                csvData.push({ eventName, parameters });
            }
        });

        if (csvData.length === 0) {
            console.warn('No events found. Available columns:', Object.keys(parsed.data[0] || {}));
            alert('No valid events found in CSV. Please check that your CSV has "GA4 Event Name" and "Parameters" columns.');
            this.resetUpload();
            return;
        }

        appState.csvData = csvData;
        console.log(`Successfully parsed ${csvData.length} events`);
        this.showConfigurationForm();
    }

    showConfigurationForm() {
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'none';
        });

        const configFormHTML = `
            <div class="config-section" id="configSection">
                <h2>GTM Configuration</h2>
                <p class="subtitle">Authenticate with GTM API and configure your setup</p>
                
                <div class="config-form">
                    <div class="form-group" id="authSection">
                        <label>GTM API Authentication:</label>
                        <button class="btn-primary" onclick="authenticateGTM()">Authenticate with GTM</button>
                        <small>You need to authenticate with Google Tag Manager API</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="accountSelect">GTM Account:</label>
                        <select id="accountSelect" style="display: none;">
                            <option value="">Select GTM Account</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="containerSelect">GTM Container:</label>
                        <select id="containerSelect" style="display: none;">
                            <option value="">Select GTM Container</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="measurementId">GA4 Measurement ID:</label>
                        <input type="text" id="measurementId" placeholder="G-XXXXXXXXXX" required>
                        <small>Enter your GA4 Measurement ID (format: G-XXXXXXXXXX)</small>
                    </div>
                    
                    <div class="buttons">
                        <button class="btn-secondary" onclick="resetUpload()">Cancel</button>
                        <button class="btn-primary" id="createConfigBtn" onclick="processGTMConfiguration()" disabled style="opacity: 0.5;">Create GTM Configuration</button>
                    </div>
                </div>
                
                <div class="csv-preview">
                    <h3>Parsed Events (${appState.csvData.length})</h3>
                    <div class="preview-list">
                        ${appState.csvData.slice(0, 10).map(item => `
                            <div class="preview-item">
                                <strong>${item.eventName}</strong>
                                <div class="parameters">Parameters: ${item.parameters.length > 0 ? item.parameters.join(', ') : 'None'}</div>
                            </div>
                        `).join('')}
                        ${appState.csvData.length > 10 ? `<div class="preview-item"><em>... and ${appState.csvData.length - 10} more events</em></div>` : ''}
                    </div>
                </div>
            </div>
        `;

        const mainContent = Utils.getElement('wizard-container', false);
        if (mainContent) {
            mainContent.insertAdjacentHTML('beforeend', configFormHTML);
            
            const measurementInput = Utils.getElement('measurementId', false);
            if (measurementInput) {
                measurementInput.addEventListener('input', Utils.debounce(toggleCreateButton, 300));
            }
        }
    }

    resetUpload() {
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'none';
        });
        
        Utils.safeUpdateElement('resultsSection', (element) => {
            element.style.display = 'none';
        });
        
        const configSection = Utils.getElement('configSection', false);
        if (configSection) {
            configSection.remove();
        }

        Utils.safeUpdateElement('uploadArea', (element) => {
            element.parentElement.style.display = 'block';
        });

        const fileInput = Utils.getElement('csvFile', false);
        if (fileInput) {
            fileInput.value = '';
        }
        
        appState.reset();
    }
}

async function authenticateGTM() {
    if (!appState.gtmManager) {
        alert('GTM Manager not initialized. Please refresh the page and try again.');
        return;
    }

    try {
        await appState.gtmManager.authenticate();
    } catch (error) {
        console.error('Authentication failed:', error);
        alert(`Authentication failed: ${error.message}`);
    }
}

async function loadGTMAccounts() {
    if (!appState.gtmManager || !appState.gtmManager.isAuthenticated) {
        alert('Please authenticate first');
        return;
    }

    try {
        Utils.safeUpdateElement('loading-text', (element) => {
            element.textContent = 'Loading GTM accounts...';
        });
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'block';
        });
        
        const accounts = await appState.gtmManager.loadAccounts();
        appState.updateGTMConfig({ accounts });
        
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'none';
        });
        
        updateAccountDropdown();
        
    } catch (error) {
        console.error('Error loading accounts:', error);
        alert(`Error loading GTM accounts: ${error.message}`);
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'none';
        });
    }
}

function updateAccountDropdown() {
    const accountSelect = Utils.getElement('accountSelect', false);
    if (accountSelect && appState.gtmConfig.accounts.length > 0) {
        accountSelect.innerHTML = '<option value="">Select GTM Account</option>' +
            appState.gtmConfig.accounts.map(account => 
                `<option value="${account.accountId}">${account.name} (${account.accountId})</option>`
            ).join('');
        
        accountSelect.style.display = 'block';
        
        accountSelect.replaceWith(accountSelect.cloneNode(true));
        const newAccountSelect = Utils.getElement('accountSelect', false);
        if (newAccountSelect) {
            newAccountSelect.addEventListener('change', handleAccountChange);
        }
    }
}

async function handleAccountChange(event) {
    const accountId = event.target.value;
    if (!accountId) {
        Utils.safeUpdateElement('containerSelect', (element) => {
            element.style.display = 'none';
        });
        toggleCreateButton();
        return;
    }
    
    appState.updateGTMConfig({ accountId, containerId: '', containers: [] });
    
    try {
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'block';
        });
        Utils.safeUpdateElement('loading-text', (element) => {
            element.textContent = 'Loading containers...';
        });
        
        const containers = await appState.gtmManager.loadContainers(accountId);
        appState.updateGTMConfig({ containers });
        
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'none';
        });
        
        updateContainerDropdown();
        
    } catch (error) {
        console.error('Error loading containers:', error);
        alert(`Error loading containers: ${error.message}`);
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'none';
        });
    }
}

function updateContainerDropdown() {
    const containerSelect = Utils.getElement('containerSelect', false);
    if (containerSelect && appState.gtmConfig.containers.length > 0) {
        containerSelect.innerHTML = '<option value="">Select GTM Container</option>' +
            appState.gtmConfig.containers.map(container => 
                `<option value="${container.containerId}">${container.name} (${container.containerId})</option>`
            ).join('');
        
        containerSelect.style.display = 'block';
        
        containerSelect.replaceWith(containerSelect.cloneNode(true));
        const newContainerSelect = Utils.getElement('containerSelect', false);
        if (newContainerSelect) {
            newContainerSelect.addEventListener('change', (event) => {
                appState.updateGTMConfig({ containerId: event.target.value });
                toggleCreateButton();
            });
        }
    }
}

function toggleCreateButton() {
    const createBtn = Utils.getElement('createConfigBtn', false);
    const measurementInput = Utils.getElement('measurementId', false);
    
    if (!createBtn || !measurementInput) return;
    
    const measurementId = measurementInput.value.trim();
    const isValidMeasurementId = Utils.validateMeasurementId(measurementId);
    const hasRequiredConfig = appState.gtmConfig.accountId && appState.gtmConfig.containerId;
    
    if (hasRequiredConfig && isValidMeasurementId) {
        createBtn.disabled = false;
        createBtn.style.opacity = '1';
        
        appState.updateGTMConfig({ measurementId });
    } else {
        createBtn.disabled = true;
        createBtn.style.opacity = '0.5';
    }
    
    const existingFeedback = measurementInput.parentElement.querySelector('.validation-feedback');
    if (existingFeedback) {
        existingFeedback.remove();
    }
    
    if (measurementId && !isValidMeasurementId) {
        const feedback = document.createElement('small');
        feedback.className = 'validation-feedback';
        feedback.style.color = '#dc3545';
        feedback.textContent = 'Invalid format. Expected: G-XXXXXXXXXX';
        measurementInput.parentElement.appendChild(feedback);
    }
}

async function processGTMConfiguration() {
    const { accountId, containerId, measurementId } = appState.gtmConfig;
    
    if (!accountId || !containerId || !measurementId || !appState.gtmManager.isAuthenticated) {
        alert('Please complete all authentication and configuration steps');
        return;
    }
    
    if (!Utils.validateMeasurementId(measurementId)) {
        alert('Please enter a valid GA4 Measurement ID (G-XXXXXXXXXX)');
        return;
    }
    
    Utils.safeUpdateElement('configSection', (element) => {
        element.style.display = 'none';
    });
    Utils.safeUpdateElement('processingSection', (element) => {
        element.style.display = 'block';
    });
    Utils.safeUpdateElement('loading-text', (element) => {
        element.textContent = 'Creating GTM workspace and configurations...';
    });
    
    try {
        await createGTMConfigurationBatched();
        showResults();
    } catch (error) {
        console.error('Error creating GTM configuration:', error);
        alert(`Error creating GTM configuration: ${error.message}`);
        
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'none';
        });
        Utils.safeUpdateElement('configSection', (element) => {
            element.style.display = 'block';
        });
    }
}

async function createGTMConfigurationBatched() {
    console.log('Starting GTM configuration creation...');
    
    appState.processedData = {
        workspace: null,
        measurementIdVariable: null,
        configTag: null,
        variables: [],
        triggers: [],
        tags: [],
        errors: [],
        createdVariables: new Map(),
        createdTriggers: new Map(),
        summary: {
            totalEvents: appState.csvData.length,
            uniqueEvents: 0,
            variablesCreated: 0,
            triggersCreated: 0,
            tagsCreated: 0
        }
    };
    
    const { accountId, containerId, measurementId } = appState.gtmConfig;
    let workspaceId = null;
    let measurementIdVariableId = null;
    
    try {
        Utils.safeUpdateElement('loading-text', (element) => {
            element.textContent = 'Creating GTM workspace...';
        });
        
        const workspace = await appState.gtmManager.createWorkspace(accountId, containerId);
        appState.processedData.workspace = workspace;
        workspaceId = workspace.workspaceId;
        
        Utils.safeUpdateElement('loading-text', (element) => {
            element.textContent = 'Creating measurement ID constant variable...';
        });
        
        try {
            measurementIdVariableId = await appState.gtmManager.getOrCreateMeasurementIdVariable(
                accountId, 
                containerId, 
                workspaceId, 
                measurementId
            );
            appState.processedData.measurementIdVariable = { variableId: measurementIdVariableId };
        } catch (error) {
            console.error('Measurement ID variable creation failed:', error);
            appState.processedData.errors.push(`Failed to create measurement ID variable: ${error.message}`);
            throw error;
        }
        
        Utils.safeUpdateElement('loading-text', (element) => {
            element.textContent = 'Creating GA4 Config tag...';
        });
        
        try {
            const configTag = await appState.gtmManager.createGA4ConfigTag(
                accountId, 
                containerId, 
                workspaceId, 
                measurementIdVariableId
            );
            appState.processedData.configTag = configTag;
        } catch (error) {
            console.error('Config tag creation failed:', error);
            appState.processedData.errors.push(`Failed to create GA4 Config tag: ${error.message}`);
        }
        
        const allParameters = [...new Set(appState.csvData.flatMap(item => item.parameters))];
        
        if (allParameters.length > 0) {
            const batchSize = 5;
            for (let i = 0; i < allParameters.length; i += batchSize) {
                const batch = allParameters.slice(i, i + batchSize);
                
                Utils.safeUpdateElement('loading-text', (element) => {
                    element.textContent = `Creating variables batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allParameters.length/batchSize)} (${appState.processedData.summary.variablesCreated} created so far)`;
                });
                
                for (const parameter of batch) {
                    if (!parameter || parameter.trim() === '') {
                        continue;
                    }
                    
                    try {
                        const variable = await appState.gtmManager.createVariable(
                            accountId,
                            containerId,
                            workspaceId,
                            parameter
                        );
                        appState.processedData.variables.push(variable);
                        appState.processedData.createdVariables.set(parameter, variable);
                        appState.processedData.summary.variablesCreated++;
                        
                    } catch (error) {
                        console.error(`Variable creation failed for ${parameter}:`, error);
                        appState.processedData.errors.push(`Failed to create variable for ${parameter}: ${error.message}`);
                    }
                }
                
                if (i + batchSize < allParameters.length) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        
        const uniqueEvents = [...new Map(appState.csvData.map(item => [item.eventName, item])).values()];
        appState.processedData.summary.uniqueEvents = uniqueEvents.length;
        
        if (uniqueEvents.length > 0) {
            const eventBatchSize = 3;
            for (let i = 0; i < uniqueEvents.length; i += eventBatchSize) {
                const batch = uniqueEvents.slice(i, i + eventBatchSize);
                
                Utils.safeUpdateElement('loading-text', (element) => {
                    element.textContent = `Creating event configurations batch ${Math.floor(i/eventBatchSize) + 1}/${Math.ceil(uniqueEvents.length/eventBatchSize)} (${appState.processedData.summary.tagsCreated} events completed)`;
                });
                
                for (const eventData of batch) {
                    try {
                        const trigger = await appState.gtmManager.createTrigger(
                            accountId,
                            containerId,
                            workspaceId,
                            eventData.eventName
                        );
                        appState.processedData.triggers.push(trigger);
                        appState.processedData.createdTriggers.set(eventData.eventName, trigger);
                        appState.processedData.summary.triggersCreated++;
                        
                        const tag = await appState.gtmManager.createEventTag(
                            accountId,
                            containerId,
                            workspaceId,
                            eventData.eventName,
                            eventData.parameters,
                            trigger.triggerId,
                            measurementIdVariableId
                        );
                        appState.processedData.tags.push(tag);
                        appState.processedData.summary.tagsCreated++;
                        
                    } catch (error) {
                        console.error(`Event processing failed for ${eventData.eventName}:`, error);
                        appState.processedData.errors.push(`Failed to process event ${eventData.eventName}: ${error.message}`);
                        
                        if (error.message.includes('Quota exceeded') || error.message.includes('quota metric')) {
                            await new Promise(resolve => setTimeout(resolve, 30000));
                        }
                    }
                }
                
                if (i + eventBatchSize < uniqueEvents.length) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }
        
        console.log('GTM Configuration completed successfully');
        
    } catch (error) {
        console.error('GTM Configuration failed:', error);
        appState.processedData.errors.push(`Configuration failed: ${error.message}`);
        
        if (!workspaceId) {
            throw new Error(`Workspace creation failed: ${error.message}. Cannot continue with configuration.`);
        }
        
        throw error;
    }
}

function showResults() {
    Utils.safeUpdateElement('processingSection', (element) => {
        element.style.display = 'none';
    });
    
    const { summary, errors } = appState.processedData;
    
    Utils.safeUpdateElement('recordCount', (element) => {
        element.textContent = summary.totalEvents;
    });
    Utils.safeUpdateElement('validCount', (element) => {
        element.textContent = summary.tagsCreated;
    });
    Utils.safeUpdateElement('invalidCount', (element) => {
        element.textContent = errors.length;
    });
    
    Utils.safeUpdateElement('resultsSection', (element) => {
        element.style.display = 'block';
    });
    
    const resultsSection = Utils.getElement('resultsSection', false);
    if (resultsSection) {
        const detailedResults = `
            <div class="detailed-results">
                <h3>Configuration Summary</h3>
                <div class="summary-grid">
                    <div class="summary-item">
                        <strong>Workspace:</strong> ${appState.processedData.workspace ? appState.processedData.workspace.name : 'Failed to create'}
                    </div>
                    <div class="summary-item">
                        <strong>Measurement ID Variable:</strong> ${appState.processedData.measurementIdVariable ? 'Created (CONS - Measurement ID)' : 'Failed'}
                    </div>
                    <div class="summary-item">
                        <strong>GA4 Config Tag:</strong> ${appState.processedData.configTag ? 'Created (using Initialization trigger)' : 'Failed'}
                    </div>
                    <div class="summary-item">
                        <strong>Variables Created:</strong> ${summary.variablesCreated}
                    </div>
                    <div class="summary-item">
                        <strong>Triggers Created:</strong> ${summary.triggersCreated}
                    </div>
                    <div class="summary-item">
                        <strong>Event Tags Created:</strong> ${summary.tagsCreated}
                    </div>
                    <div class="summary-item">
                        <strong>Success Rate:</strong> ${summary.totalEvents > 0 ? Math.round((summary.tagsCreated / summary.totalEvents) * 100) : 0}%
                    </div>
                </div>
                
                ${appState.processedData.workspace ? `
                    <div class="workspace-link">
                        <p><strong>Workspace URL:</strong></p>
                        <a href="https://tagmanager.google.com/#/container/accounts/${appState.gtmConfig.accountId}/containers/${appState.gtmConfig.containerId}/workspaces/${appState.processedData.workspace.workspaceId}" 
                           target="_blank" class="btn-link">
                            Open in GTM → ${appState.processedData.workspace.name}
                        </a>
                        <div style="margin-top: 15px; padding: 10px; background: #fff3cd; border: 1px solid #ffeeba; border-radius: 5px;">
                            <strong style="color: #856404; display: block; margin-bottom: 5px;">Important:</strong>
                            <p style="margin: 0; color: #856404; font-weight: bold;">
                                These changes are created in a new workspace that is not yet published.<br>
                                Make sure to thoroughly review and test all configurations before publishing.
                            </p>
        </div>
                    </div>
                ` : ''}
                
                ${errors.length > 0 ? `
                    <div class="errors-section">
                        <h4>Errors (${errors.length}):</h4>
                        <ul>
                            ${errors.map(error => `<li>${error}</li>`).join('')}
                        </ul>
                        <small style="color: #666; font-style: italic;">
                            These errors didn't prevent the creation of other elements. You can manually fix these issues in GTM.
                        </small>
                    </div>
                ` : ''}
            </div>
        `;
        
        const existingDetails = resultsSection.querySelector('.detailed-results');
        if (existingDetails) {
            existingDetails.remove();
        }
        
        resultsSection.insertAdjacentHTML('beforeend', detailedResults);
    }
}

function resetUpload() {
    if (window.fileUploadManager) {
        window.fileUploadManager.resetUpload();
    } else {
        Utils.safeUpdateElement('processingSection', (element) => {
            element.style.display = 'none';
        });
        Utils.safeUpdateElement('resultsSection', (element) => {
            element.style.display = 'none';
        });
        
        const configSection = Utils.getElement('configSection', false);
        if (configSection) {
            configSection.remove();
        }

        const uploadSection = document.querySelector('.upload-section');
        if (uploadSection) {
            uploadSection.style.display = 'block';
        }

        const fileInput = Utils.getElement('csvFile', false);
        if (fileInput) {
            fileInput.value = '';
        }
        
        appState.reset();
    }
}

function downloadProcessed() {
    if (!appState.processedData || !appState.processedData.workspace) {
        alert('No processed data available to download');
        return;
    }
    
    try {
        const report = {
            metadata: {
                generated: new Date().toISOString(),
                version: '2.1',
                tool: 'GTM CSV Upload Tool - Fixed Version with Measurement ID Variable and Initialization Trigger'
            },
            workspace: {
                id: appState.processedData.workspace.workspaceId,
                name: appState.processedData.workspace.name,
                url: `https://tagmanager.google.com/#/container/accounts/${appState.gtmConfig.accountId}/containers/${appState.gtmConfig.containerId}/workspaces/${appState.processedData.workspace.workspaceId}`
            },
            configuration: {
                accountId: appState.gtmConfig.accountId,
                containerId: appState.gtmConfig.containerId,
                measurementId: appState.gtmConfig.measurementId
            },
            summary: appState.processedData.summary,
            details: {
                measurementIdVariable: appState.processedData.measurementIdVariable ? {
                    id: appState.processedData.measurementIdVariable.variableId,
                    name: 'CONS - Measurement ID',
                    type: 'constant',
                    value: appState.gtmConfig.measurementId
                } : null,
                variables: appState.processedData.variables.map(v => ({ 
                    id: v.variableId, 
                    name: v.name,
                    type: v.type,
                    parameter: v.parameter?.find(p => p.key === 'name')?.value
                })),
                triggers: appState.processedData.triggers.map(t => ({ 
                    id: t.triggerId, 
                    name: t.name,
                    type: t.type,
                    eventName: t.name.replace('CE - ', '')
                })),
                tags: appState.processedData.tags.map(tag => ({ 
                    id: tag.tagId, 
                    name: tag.name,
                    type: tag.type,
                    eventName: tag.name.replace('GA4 - Event - ', ''),
                    firingTriggerId: tag.firingTriggerId,
                    usesMeasurementIdVariable: true
                })),
                configTag: appState.processedData.configTag ? {
                    id: appState.processedData.configTag.tagId,
                    name: appState.processedData.configTag.name,
                    type: appState.processedData.configTag.type,
                    triggerType: 'initialization',
                    usesMeasurementIdVariable: true
                } : null,
                errors: appState.processedData.errors
            },
            originalData: appState.csvData
        };
        
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gtm-configuration-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Error downloading report:', error);
        alert(`Error downloading report: ${error.message}`);
    }
}

class AppInitializer {
    constructor() {
        this.isInitializing = false;
        this.isInitialized = false;
        this.initPromise = null;
    }

    async initialize() {
        if (this.isInitialized) {
            return appState.gtmManager;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this._doInitialize();
        return this.initPromise;
    }

    async _doInitialize() {
        if (this.isInitializing) {
            return;
        }

        this.isInitializing = true;

        try {
            console.log('Initializing application...');
            
            await this._waitForGoogleServices();
            
            const gtmManager = new GTMManager();
            await gtmManager.initialize();
            appState.gtmManager = gtmManager;
            
            window.fileUploadManager = new FileUploadManager();
            
            appState.isInitialized = true;
            this.isInitialized = true;
            console.log('Application initialized successfully');
            
            return gtmManager;
            
        } catch (error) {
            console.error('Application initialization failed:', error);
            this._showInitializationError(error);
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    async _waitForGoogleServices(maxAttempts = 20, interval = 500) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (typeof google !== 'undefined' && 
                google.accounts && 
                google.accounts.id && 
                google.accounts.oauth2) {
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        
        throw new Error('Google Identity Services failed to load. Please check your internet connection and disable ad blockers.');
    }

    _showInitializationError(error) {
        const uploadSection = document.querySelector('.upload-section');
        if (uploadSection) {
            const errorDiv = document.createElement('div');
            errorDiv.innerHTML = `
                <div style="color: #dc3545; padding: 20px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; margin: 20px 0;">
                    <h4 style="margin: 0 0 10px 0;">Initialization Error</h4>
                    <p style="margin: 0 0 15px 0;"><strong>Error:</strong> ${error.message}</p>
                    <p style="margin: 0 0 10px 0;">Please try the following:</p>
                    <ul style="margin: 10px 0 15px 20px;">
                        <li>Check your internet connection</li>
                        <li>Disable ad blockers or privacy extensions</li>
                        <li>Refresh the page and try again</li>
                        <li>Try using a different browser</li>
                    </ul>
                    <button onclick="location.reload()" style="background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">
                        Refresh Page
                    </button>
                </div>
            `;
            uploadSection.appendChild(errorDiv);
        }
    }
}

const appInitializer = new AppInitializer();

window.initializeGTMManager = function() {
    console.log('Google services loaded, initializing application...');
    appInitializer.initialize().catch(error => {
        console.error('Failed to initialize from callback:', error);
    });
};

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        if (!appState.isInitialized) {
            appInitializer.initialize().catch(error => {
                console.error('Fallback initialization failed:', error);
            });
        }
    }, 2000);
});

window.authenticateGTM = authenticateGTM;
window.loadGTMAccounts = loadGTMAccounts;
window.processGTMConfiguration = processGTMConfiguration;
window.resetUpload = resetUpload;
window.downloadProcessed = downloadProcessed;
window.toggleCreateButton = toggleCreateButton;

console.log('GTM CSV Upload Tool loaded successfully');