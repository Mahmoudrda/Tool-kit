class GA4Manager {
  constructor() {
    console.log('Initializing GA4Manager...');
    this.accessToken = null;
    this.isAuthenticated = false;
    this.tokenClient = null;
    this.init();
  }

  init() {
    gapi.load('client', () => {
      gapi.client.init({
        apiKey: '', 
        discoveryDocs: ['https://analyticsadmin.googleapis.com/$discovery/rest?version=v1beta']
      });
    });

    google.accounts.id.initialize({
      client_id: '903553466558-ggf600mr9qauuimpfmc0olc94dledr2n.apps.googleusercontent.com'
    });

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: '903553466558-ggf600mr9qauuimpfmc0olc94dledr2n.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/analytics.edit',
      callback: (response) => {
        if (response.error !== undefined) {
          throw new Error(response.error);
        }
        this.handleAuthSuccess(response);
      },
    });
  }

  async authenticate() {
    console.log('Attempting authentication...');
    try {
      this.tokenClient.requestAccessToken({prompt: 'consent'});
    } catch (error) {
      console.error('Authentication failed:', error);
      throw new Error('Authentication failed: ' + error.message);
    }
  }

  handleAuthSuccess(response) {
    console.log('Authentication successful');
    this.isAuthenticated = true;
    this.accessToken = response.access_token;
    console.log('Access token received, length:', this.accessToken.length);
    const authBtn = document.getElementById('loadPropsBtn');
    if (authBtn && authBtn.textContent === 'Load My GA4 Properties') {
      authBtn.textContent = 'Authenticated - Click to Load Properties';
      authBtn.style.background = 'linear-gradient(135deg, #43a047 0%, #2e7d32 100%)';
    }
  }

  async makeApiCall(url, options = {}) {
    console.log('Making API call to:', url);
    if (!this.accessToken) {
      console.log('No access token, initiating authentication...');
      await this.authenticate();
      return;
    }

    const defaultOptions = {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    try {
      const finalOptions = { ...defaultOptions, ...options };
      console.log('API request options:', finalOptions);
      const response = await fetch(url, finalOptions);
      
      if (!response.ok) {
        console.error('API call failed:', response.status, response.statusText);
        if (response.status === 401) {
          this.accessToken = null;
          this.isAuthenticated = false;
          throw new Error('Authentication expired. Please try again.');
        }
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }
      const data = await response.json();
      console.log('API response:', data);
      return data;
    } catch (error) {
      console.error('API call error:', error);
      throw error;
    }
  }
}

// Global variables
let selectedPropertyIds = [];
let dimensions = [];
let metrics = [];
let existingDimensions = [];
let existingMetrics = [];
let currentTab = 'dimensions';

// Fixed values for batch processing
const BATCH_SIZE = 10;
const DELAY_MS = 1000;

async function createAllDimensions() {
  console.log('Starting creation process...');
  console.log('Selected properties:', selectedPropertyIds);
  console.log('Current tab:', currentTab);
  console.log('Items to create:', currentTab === 'dimensions' ? dimensions : metrics);

  if (selectedPropertyIds.length === 0) {
    console.error('No properties selected');
    throw new Error("Please select at least one property first");
  }
  if (currentTab === 'dimensions' && dimensions.length === 0) {
    throw new Error("Please add at least one dimension");
  }
  if (currentTab === 'metrics' && metrics.length === 0) {
    throw new Error("Please add at least one metric");
  }

  const checkDuplicates = document.getElementById("checkDuplicates").checked;

  document.getElementById("processLoader").style.display = "block";
  document.getElementById("createBtn").disabled = true;

  try {
    const allResults = [];
    for (const propertyId of selectedPropertyIds) {
      if (currentTab === 'dimensions') {
        const result = await createCustomDimensions(propertyId, dimensions, { 
          checkDuplicates, 
          batchSize: BATCH_SIZE, 
          delay: DELAY_MS 
        });
        allResults.push({ propertyId, type: 'dimensions', result });
      } else {
        const result = await createCustomMetrics(propertyId, metrics, { 
          checkDuplicates, 
          batchSize: BATCH_SIZE, 
          delay: DELAY_MS 
        });
        allResults.push({ propertyId, type: 'metrics', result });
      }
    }
    showMultiPropertyResults(allResults);
  } catch (err) {
    showResults("❌ Error: " + err.message, true);
  } finally {
    document.getElementById("processLoader").style.display = "none";
    document.getElementById("createBtn").disabled = false;
  }
}

async function createCustomDimensions(propertyId, dimensions, options = {}) {
  console.log(`Creating dimensions for property ${propertyId}`);
  console.log('Dimensions to create:', dimensions);
  console.log('Options:', options);

  if (!propertyId || !dimensions || dimensions.length === 0) {
    return { success: false, error: "Invalid input parameters." };
  }

  const results = [];
  const batchSize = options.batchSize || BATCH_SIZE;
  const delay = options.delay || DELAY_MS;
  
  try {
    const existingResult = await getExistingCustomDimensions(propertyId);
    console.log('Existing dimensions:', existingResult);
    const existingNames = existingResult.success ? 
      existingResult.dimensions.map(d => d.parameterName.toLowerCase()) : [];

    for (let i = 0; i < dimensions.length; i += batchSize) {
      const batch = dimensions.slice(i, i + batchSize);
      for (let j = 0; j < batch.length; j++) {
        const dimension = batch[j];
        const actualIndex = i + j;
        try {
          if (!dimension.parameterName || !dimension.displayName) {
            results.push({
              index: actualIndex,
              success: false,
              error: "Missing required fields (parameterName or displayName)",
              dimension: dimension
            });
            continue;
          }
          if (options.checkDuplicates && existingNames.includes(dimension.parameterName.toLowerCase())) {
            results.push({
              index: actualIndex,
              success: false,
              error: "Custom dimension already exists",
              dimension: dimension,
              skipped: true
            });
            continue;
          }
          const payload = {
            parameterName: dimension.parameterName,
            displayName: dimension.displayName,
            scope: dimension.scope || "EVENT",
            description: dimension.description || "",
            disallowAdsPersonalization: dimension.disallowAdsPersonalization || false
          };
          const url = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/customDimensions`;
          const response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ga4Manager.accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });
          const responseText = await response.text();
          const responseCode = response.status;
          results.push({
            index: actualIndex,
            success: responseCode >= 200 && responseCode < 300,
            statusCode: responseCode,
            response: responseText,
            dimension: dimension,
            created: responseCode >= 200 && responseCode < 300 ? JSON.parse(responseText) : null
          });
        } catch (error) {
          results.push({
            index: actualIndex,
            success: false,
            error: error.toString(),
            dimension: dimension
          });
        }
      }
      if (i + batchSize < dimensions.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const summary = {
      total: dimensions.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length
    };

    return { 
      success: true, 
      results: results,
      summary: summary
    };

  } catch (error) {
    console.error('Error creating dimensions:', error);
    return { success: false, error: error.toString() };
  }
}

async function createCustomMetrics(propertyId, metrics, options = {}) {
  if (!propertyId || !metrics || metrics.length === 0) {
    return { success: false, error: "Invalid input parameters." };
  }

  const results = [];
  const batchSize = options.batchSize || BATCH_SIZE;
  const delay = options.delay || DELAY_MS;
  
  try {
    const existingResult = await getExistingCustomMetrics(propertyId);
    const existingNames = existingResult.success ? 
      existingResult.metrics.map(m => m.parameterName.toLowerCase()) : [];

    for (let i = 0; i < metrics.length; i += batchSize) {
      const batch = metrics.slice(i, i + batchSize);
      for (let j = 0; j < batch.length; j++) {
        const metric = batch[j];
        const actualIndex = i + j;
        try {
          if (!metric.parameterName || !metric.displayName) {
            results.push({
              index: actualIndex,
              success: false,
              error: "Missing required fields (parameterName or displayName)",
              metric: metric
            });
            continue;
          }
          if (options.checkDuplicates && existingNames.includes(metric.parameterName.toLowerCase())) {
            results.push({
              index: actualIndex,
              success: false,
              error: "Custom metric already exists",
              metric: metric,
              skipped: true
            });
            continue;
          }
          const payload = {
            parameterName: metric.parameterName,
            displayName: metric.displayName,
            description: metric.description || "",
            measurementUnit: metric.measurementUnit || "STANDARD",
            scope: "EVENT"
          };
          const url = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/customMetrics`;
          const response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ga4Manager.accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });
          const responseText = await response.text();
          const responseCode = response.status;
          results.push({
            index: actualIndex,
            success: responseCode >= 200 && responseCode < 300,
            statusCode: responseCode,
            response: responseText,
            metric: metric,
            created: responseCode >= 200 && responseCode < 300 ? JSON.parse(responseText) : null
          });
        } catch (error) {
          results.push({
            index: actualIndex,
            success: false,
            error: error.toString(),
            metric: metric
          });
        }
      }
      if (i + batchSize < metrics.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const summary = {
      total: metrics.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length
    };

    return { 
      success: true, 
      results: results,
      summary: summary
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function handleCreateResults(result, type) {
  document.getElementById('processLoader').style.display = 'none';
  document.getElementById('createBtn').disabled = false;

  if (result.success) {
    displayResults(result, type);
    // Refresh existing items for all selected properties
    if (selectedPropertyIds.length > 0) {
      if (type === 'dimensions') {
        loadExistingDimensions();
      } else {
        loadExistingMetrics();
      }
    }
  } else {
    showError(`Creation failed: ${result.error}`);
  }
}

function showMultiPropertyResults(allResults) {
  const resultsDiv = document.getElementById('results');
  let html = '<div class="results">';
  
  // Overall summary
  let totalSuccessful = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalItems = 0;
  
  allResults.forEach(propResult => {
    if (propResult.result.success && propResult.result.summary) {
      totalSuccessful += propResult.result.summary.successful;
      totalFailed += propResult.result.summary.failed;
      totalSkipped += propResult.result.summary.skipped;
      totalItems += propResult.result.summary.total;
    }
  });
  
  html += '<div class="results-header">';
  html += `<h3>Multi-Property Results Summary</h3>`;
  html += `<p class="success">✅ Total successful: ${totalSuccessful}</p>`;
  if (totalFailed > 0) {
    html += `<p class="error">❌ Total failed: ${totalFailed}</p>`;
  }
  if (totalSkipped > 0) {
    html += `<p class="warning">⚠️ Total skipped: ${totalSkipped}</p>`;
  }
  html += `<p>Processed across ${selectedPropertyIds.length} properties</p>`;
  html += '</div>';

  // Individual property results
  html += '<div class="results-body">';
  
  allResults.forEach(propResult => {
    const { propertyId, type, result } = propResult;
    const itemType = type === 'dimensions' ? 'dimension' : 'metric';
    
    html += `<div class="property-results">`;
    html += `<h4>Property: ${propertyId}</h4>`;
    
    if (result.success && result.results) {
      result.results.forEach(item => {
        const statusClass = item.success ? 'success' : (item.skipped ? 'warning' : 'error');
        const statusIcon = item.success ? '✅' : (item.skipped ? '⚠️' : '❌');
        const itemData = item[itemType] || item.dimension || item.metric;
        
        html += '<div class="result-item">';
        html += `<div>`;
        html += `<span class="${statusClass}"><strong>${statusIcon}</strong></span> `;
        html += `<strong>${itemData.displayName}</strong> (${itemData.parameterName})`;
        if (item.error) {
          html += `<br><small class="error">${item.error}</small>`;
        } else if (item.skipped) {
          html += `<br><small class="warning">Already exists</small>`;
        }
        html += '</div>';
        html += `<span class="${statusClass}">Status: ${item.statusCode || 'N/A'}</span>`;
        html += '</div>';
      });
    } else {
      html += `<div class="result-item"><span class="error">Property failed: ${result.error}</span></div>`;
    }
    
    html += '</div>';
  });
  
  html += '</div>';
  html += '</div>';

  resultsDiv.innerHTML = html;
  resultsDiv.style.display = 'block';
}

function displayResults(result, type) {
  const resultsDiv = document.getElementById('results');
  const summary = result.summary;
  const itemType = type === 'dimensions' ? 'dimension' : 'metric';
  const itemTypePlural = type === 'dimensions' ? 'dimensions' : 'metrics';
  
  let html = '<div class="results">';
  html += '<div class="results-header">';
  html += `<h3>${itemTypePlural.charAt(0).toUpperCase() + itemTypePlural.slice(1)} Results Summary</h3>`;
  html += `<p class="success">✅ Successfully created: ${summary.successful}</p>`;
  if (summary.failed > 0) {
    html += `<p class="error">❌ Failed: ${summary.failed}</p>`;
  }
  if (summary.skipped > 0) {
    html += `<p class="warning">⚠️ Skipped (duplicates): ${summary.skipped}</p>`;
  }
  html += `<p>Total processed: ${summary.total}</p>`;
  html += '</div>';

  html += '<div class="results-body">';
  result.results.forEach(item => {
    const statusClass = item.success ? 'success' : (item.skipped ? 'warning' : 'error');
    const statusIcon = item.success ? '✅' : (item.skipped ? '⚠️' : '❌');
    const itemData = item[itemType] || item.dimension || item.metric;
    
    html += '<div class="result-item">';
    html += `<div>`;
    html += `<span class="${statusClass}"><strong>${statusIcon}</strong></span> `;
    html += `<strong>${itemData.displayName}</strong> (${itemData.parameterName})`;
    if (item.error) {
      html += `<br><small class="error">${item.error}</small>`;
    } else if (item.skipped) {
      html += `<br><small class="warning">Already exists</small>`;
    }
    html += '</div>';
    html += `<span class="${statusClass}">Status: ${item.statusCode || 'N/A'}</span>`;
    html += '</div>';
  });
  html += '</div>';
  html += '</div>';

  resultsDiv.innerHTML = html;
  resultsDiv.style.display = 'block';
}

function showError(message) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = `<div class="results"><div class="results-header"><p class="error"><strong>Error:</strong> ${message}</p></div></div>`;
  resultsDiv.style.display = 'block';
}

function showResults(message, isError = false) {
  const resultsDiv = document.getElementById('results');
  const className = isError ? 'error' : 'success';
  resultsDiv.innerHTML = `<div class="results"><div class="results-header"><p class="${className}">${message}</p></div></div>`;
  resultsDiv.style.display = 'block';
}

function showSuccess(message) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = `<div class="results"><div class="results-header"><p class="success">${message}</p></div></div>`;
  resultsDiv.style.display = 'block';
  setTimeout(() => {
    resultsDiv.style.display = 'none';
  }, 3000);
}

function handleError(error) {
  document.getElementById('processLoader').style.display = 'none';
  document.getElementById('propertyLoader').style.display = 'none';
  document.getElementById('createBtn').disabled = false;
  document.getElementById('loadPropsBtn').disabled = false;
  showError(error.toString());
}

const ga4Manager = new GA4Manager();

async function loadProperties() {
  if (!ga4Manager.isAuthenticated) {
    await ga4Manager.authenticate();
    return;
  }

  document.getElementById('propertyLoader').style.display = 'block';
  document.getElementById('loadPropsBtn').disabled = true;
  
  try {
    const result = await getPropertiesList();
    handlePropertiesLoaded(result);
  } catch (error) {
    handleError(error);
  }
}

async function getPropertiesList() {
  try {
    const accountsUrl = "https://analyticsadmin.googleapis.com/v1beta/accounts";
    const accountsData = await ga4Manager.makeApiCall(accountsUrl);
    const accounts = accountsData.accounts || [];

    const allProps = [];

    for (const account of accounts) {
      const accountId = account.name.split("/")[1];
      const accountName = account.displayName;
      
      const propsUrl = `https://analyticsadmin.googleapis.com/v1beta/properties?filter=parent:accounts/${accountId}`;
      const propsData = await ga4Manager.makeApiCall(propsUrl);
      const properties = propsData.properties || [];

      properties.forEach(prop => {
        allProps.push({ 
          name: prop.displayName, 
          id: prop.name.split("/")[1],
          accountName: accountName,
          accountId: accountId,
          propertyType: prop.propertyType || 'PROPERTY_TYPE_ORDINARY'
        });
      });
    }

    return { success: true, properties: allProps };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function handlePropertiesLoaded(result) {
  document.getElementById('propertyLoader').style.display = 'none';
  document.getElementById('loadPropsBtn').disabled = false;
  
  if (result.success) {
    const select = document.getElementById('propertySelect');
    select.innerHTML = '';
    
    // Add "Select All" option
    const selectAllOption = document.createElement('option');
    selectAllOption.value = 'SELECT_ALL';
    selectAllOption.textContent = 'Select All Properties';
    select.appendChild(selectAllOption);
    
    const accountGroups = {};
    result.properties.forEach(prop => {
      if (!accountGroups[prop.accountName]) {
        accountGroups[prop.accountName] = [];
      }
      accountGroups[prop.accountName].push(prop);
    });

    Object.keys(accountGroups).forEach(accountName => {
      console.log(`Creating optgroup for account: ${accountName}`);
      const optgroup = document.createElement('optgroup');
      optgroup.label = accountName;
      
      console.log(`Adding ${accountGroups[accountName].length} properties to group`);
      accountGroups[accountName].forEach(prop => {
        console.log(`Adding property: ${prop.name} (${prop.id})`);
        const option = document.createElement('option');
        option.value = prop.id;
        option.textContent = `${prop.name} (${prop.id})`;
        optgroup.appendChild(option);
      });

      select.appendChild(optgroup);
});
    
    // Convert to multi-select
    select.multiple = true;
    select.size = Math.min(10, result.properties.length + 1);
    select.style.display = 'block';
  } else {
    showError('Failed to load properties: ' + result.error);
  }
}

function onPropertyChange() {
  const select = document.getElementById('propertySelect');
  const selectedOptions = Array.from(select.selectedOptions);
  
  // Handle "Select All" option
  if (selectedOptions.some(option => option.value === 'SELECT_ALL')) {
    // Select all property options except "Select All"
    Array.from(select.options).forEach(option => {
      if (option.value !== 'SELECT_ALL') {
        option.selected = true;
      } else {
        option.selected = false;
      }
    });
    selectedPropertyIds = Array.from(select.options)
      .filter(option => option.selected && option.value !== 'SELECT_ALL')
      .map(option => option.value);
  } else {
    selectedPropertyIds = selectedOptions
      .filter(option => option.value !== 'SELECT_ALL')
      .map(option => option.value);
  }
  
  // Limit to 3 properties maximum
  if (selectedPropertyIds.length > 3) {
    selectedPropertyIds = selectedPropertyIds.slice(0, 3);
    // Update UI to reflect the limitation
    Array.from(select.options).forEach((option, index) => {
      if (option.value !== 'SELECT_ALL' && selectedPropertyIds.includes(option.value)) {
        option.selected = true;
      } else if (option.value !== 'SELECT_ALL') {
        option.selected = false;
      }
    });
    showError('Maximum 3 properties can be selected at once.');
  }
  
  if (selectedPropertyIds.length > 0) {
    loadExistingDimensions();
    loadExistingMetrics();
    updateCreateButton();
    updatePropertyDisplay();
  }
}

function updatePropertyDisplay() {
  const displayDiv = document.getElementById('selectedPropertiesDisplay');
  if (selectedPropertyIds.length > 0) {
    displayDiv.innerHTML = `<p><strong>Selected Properties (${selectedPropertyIds.length}/3):</strong> ${selectedPropertyIds.join(', ')}</p>`;
    displayDiv.style.display = 'block';
  } else {
    displayDiv.style.display = 'none';
  }
}

async function loadExistingDimensions() {
  try {
    const allDimensions = [];
    
    for (const propertyId of selectedPropertyIds) {
      const result = await getExistingCustomDimensions(propertyId);
      if (result.success) {
        allDimensions.push({
          propertyId,
          dimensions: result.dimensions
        });
      }
    }
    
    existingDimensions = allDimensions;
    displayExistingDimensions();
  } catch (error) {
    handleError(error);
  }
}

async function loadExistingMetrics() {
  try {
    const allMetrics = [];
    
    for (const propertyId of selectedPropertyIds) {
      const result = await getExistingCustomMetrics(propertyId);
      if (result.success) {
        allMetrics.push({
          propertyId,
          metrics: result.metrics
        });
      }
    }
    
    existingMetrics = allMetrics;
    displayExistingMetrics();
  } catch (error) {
    handleError(error);
  }
}

async function getExistingCustomDimensions(propertyId) {
  try {
    const url = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/customDimensions`;
    const data = await ga4Manager.makeApiCall(url);
    
    const dimensions = (data.customDimensions || []).map(dim => ({
      name: dim.name,
      displayName: dim.displayName,
      parameterName: dim.parameterName,
      scope: dim.scope,
      description: dim.description || '',
      disallowAdsPersonalization: dim.disallowAdsPersonalization || false
    }));

    return { success: true, dimensions: dimensions };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

async function getExistingCustomMetrics(propertyId) {
  try {
    const url = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/customMetrics`;
    const data = await ga4Manager.makeApiCall(url);
    
    const metrics = (data.customMetrics || []).map(metric => ({
      name: metric.name,
      displayName: metric.displayName,
      parameterName: metric.parameterName,
      scope: metric.scope,
      description: metric.description || '',
      measurementUnit: metric.measurementUnit || 'STANDARD'
    }));

    return { success: true, metrics: metrics };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function displayExistingDimensions() {
  const container = document.getElementById('existingDimensions');
  if (existingDimensions.length > 0) {
    let html = '<div class="existing-dimensions">';
    html += '<h4>Existing Custom Dimensions</h4>';
    
    existingDimensions.forEach(propData => {
      if (propData.dimensions.length > 0) {
        html += `<div class="property-existing">`;
        html += `<h5>Property ${propData.propertyId} (${propData.dimensions.length} dimensions)</h5>`;
        html += '<div style="max-height: 100px; overflow-y: auto; font-size: 13px;">';
        propData.dimensions.forEach(dim => {
          html += `<div>${dim.displayName} (${dim.parameterName}) - ${dim.scope}</div>`;
        });
        html += '</div></div>';
      }
    });
    
    html += '</div>';
    container.innerHTML = html;
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
  }
}

function displayExistingMetrics() {
  const container = document.getElementById('existingMetrics');
  if (existingMetrics.length > 0) {
    let html = '<div class="existing-metrics">';
    html += '<h4>Existing Custom Metrics</h4>';
    
    existingMetrics.forEach(propData => {
      if (propData.metrics.length > 0) {
        html += `<div class="property-existing">`;
        html += `<h5>Property ${propData.propertyId} (${propData.metrics.length} metrics)</h5>`;
        html += '<div style="max-height: 100px; overflow-y: auto; font-size: 13px;">';
        propData.metrics.forEach(metric => {
          html += `<div>${metric.displayName} (${metric.parameterName}) - ${metric.measurementUnit}</div>`;
        });
        html += '</div></div>';
      }
    });
    
    html += '</div>';
    container.innerHTML = html;
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
  }
}

// Dimension functions
function addManualDimension() {
  const displayName = document.getElementById('manualDisplayName').value.trim();
  const parameterName = document.getElementById('manualParameterName').value.trim();
  const description = document.getElementById('manualDescription').value.trim();
  const scope = document.getElementById('manualScope').value;

  if (!displayName || !parameterName) {
    showError('Display Name and Parameter Name are required');
    return;
  }

  const dimension = {
    displayName,
    parameterName,
    description,
    scope,
    source: 'manual'
  };

  dimensions.push(dimension);
  
  document.getElementById('manualDisplayName').value = '';
  document.getElementById('manualParameterName').value = '';
  document.getElementById('manualDescription').value = '';
  document.getElementById('manualScope').value = 'EVENT';

  updateDimensionList();
  updateCreateButton();
}

// Metric functions
function addManualMetric() {
  const displayName = document.getElementById('metricManualDisplayName').value.trim();
  const parameterName = document.getElementById('metricManualParameterName').value.trim();
  const description = document.getElementById('metricManualDescription').value.trim();
  const measurementUnit = document.getElementById('metricManualUnit').value;

  if (!displayName || !parameterName) {
    showError('Display Name and Parameter Name are required');
    return;
  }

  const metric = {
    displayName,
    parameterName,
    description,
    measurementUnit,
    scope: 'EVENT', // Metrics are always EVENT scoped
    source: 'manual'
  };

  metrics.push(metric);
  
  document.getElementById('metricManualDisplayName').value = '';
  document.getElementById('metricManualParameterName').value = '';
  document.getElementById('metricManualDescription').value = '';
  document.getElementById('metricManualUnit').value = 'STANDARD';

  updateMetricList();
  updateCreateButton();
}

function generateSample() {
  if (currentTab === 'dimensions') {
    const sampleDimensions = [
      {
        displayName: "User Type",
        parameterName: "user_type",
        description: "Identifies if user is new or returning",
        scope: "USER",
        source: 'sample'
      },
      {
        displayName: "Page Category",
        parameterName: "page_category",
        description: "Category of the page being viewed",
        scope: "EVENT",
        source: 'sample'
      },
      {
        displayName: "Product Brand",
        parameterName: "product_brand",
        description: "Brand of the product",
        scope: "ITEM",
        source: 'sample'
      }
    ];

    dimensions = dimensions.concat(sampleDimensions);
    updateDimensionList();
    showSuccess('Added 3 sample dimensions');
  } else {
    const sampleMetrics = [
      {
        displayName: "Page Load Time",
        parameterName: "page_load_time",
        description: "Time taken to load the page",
        measurementUnit: "MILLISECONDS",
        scope: "EVENT",
        source: 'sample'
      },
      {
        displayName: "Video Watch Duration",
        parameterName: "video_watch_duration",
        description: "Duration of video watched",
        measurementUnit: "SECONDS",
        scope: "EVENT",
        source: 'sample'
      }
    ];

    metrics = metrics.concat(sampleMetrics);
    updateMetricList();
    showSuccess('Added 2 sample metrics');
  }
  
  updateCreateButton();
}

function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('dragover');
}

function handleFileDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragover');
  
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    handleFile(files[0], 'csv');
  }
}

function handleFileSelect(event, format) {
  const file = event.target.files[0];
  if (file) {
    handleFile(file, format);
  }
}

function handleFile(file, format) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result;
    
    if (format === 'csv') {
      const csvData = parseCSV(content);
      processInputData(csvData, 'csv');
    }
  };
  reader.readAsText(file);
}

function parseCSV(csv) {
  const lines = csv.split('\n');
  const result = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      result.push(values);
    }
  }
  
  return result;
}

function processInputData(data, format) {
  console.log('Processing input data');
  console.log('Format:', format);
  console.log('Data:', data);

  try {
    const result = parseInput(data, format);
    console.log('Parse result:', result);
    
    if (result.success) {
      if (result.dimensions && result.dimensions.length > 0) {
        dimensions = dimensions.concat(result.dimensions.map(d => ({...d, source: format})));
        updateDimensionList();
        showSuccess(`Added ${result.dimensions.length} dimensions from ${format.toUpperCase()}`);
      }
      if (result.metrics && result.metrics.length > 0) {
        metrics = metrics.concat(result.metrics.map(m => ({...m, source: format})));
        updateMetricList();
        showSuccess(`Added ${result.metrics.length} metrics from ${format.toUpperCase()}`);
      }
      updateCreateButton();
    } else {
      showError('Parse error: ' + result.error);
    }
  } catch (error) {
    console.error('Error processing input:', error);
    handleError(error);
  }
}

function parseInput(inputData, format) {
  try {
    switch (format) {
      case 'csv':
        return parseCSVData(inputData);
      case 'manual':
        return { success: true, [currentTab]: inputData };
      default:
        return { success: false, error: "Unsupported format" };
    }
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// Updated CSV parsing function to handle unified format
function parseCSVData(csvData) {
  if (!csvData || csvData.length < 2) {
    return { success: false, error: "CSV must have header row and at least one data row" };
  }

  const headers = csvData[0].map(h => h.toLowerCase().trim());
  
  const dimensions = [];
  const metrics = [];

  const headerMap = {
    parameterName: findHeader(headers, ['key', 'parameter name', 'parametername']),
    displayName: findHeader(headers, ['name', 'display name', 'displayname']),
    description: findHeader(headers, ['notes/description', 'description', 'notes', 'desc']),
    createDimension: findHeader(headers, ['ga4 custom dimension', 'custom dimension', 'dimension']),
    createMetric: findHeader(headers, ['ga4 custom metric', 'custom metric', 'metric']),
    measurementUnit: findHeader(headers, ['measurement unit', 'measurementunit', 'unit'])
  };

  for (let i = 1; i < csvData.length; i++) {
    const row = csvData[i];
    
    // Skip empty rows
    if (!row || row.every(cell => !cell || cell.trim() === '')) {
      continue;
    }
    
    // Check if this row should create a dimension
    const shouldCreateDimension = headerMap.createDimension !== -1 ? 
      String(row[headerMap.createDimension] || '').toLowerCase().includes('true') : false;
    
    // Check if this row should create a metric
    const shouldCreateMetric = headerMap.createMetric !== -1 ? 
      String(row[headerMap.createMetric] || '').toLowerCase().includes('true') : false;

    if (headerMap.displayName !== -1 && headerMap.parameterName !== -1) {
      const baseItem = {
        displayName: row[headerMap.displayName] || '',
        parameterName: row[headerMap.parameterName] || '',
        description: headerMap.description !== -1 ? (row[headerMap.description] || '') : ''
      };

      // Create dimension if requested
      if (shouldCreateDimension) {
        const scope = "EVENT"; 
        
        dimensions.push({
          ...baseItem,
          scope: scope,
          disallowAdsPersonalization: false
        });
      }

      // Create metric if requested  
      if (shouldCreateMetric) {
        metrics.push({
          ...baseItem,
          measurementUnit: (headerMap.measurementUnit !== -1 && row[headerMap.measurementUnit]) ? row[headerMap.measurementUnit] : 'STANDARD',
          scope: 'EVENT'
        });
      }
    }
  }

  return { 
    success: true, 
    dimensions: dimensions,
    metrics: metrics
  };
}

function findHeader(headers, searchTerms) {
  for (let term of searchTerms) {
    const index = headers.findIndex(h => h.includes(term));
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

function downloadTemplate(format) {
  const template = generateSampleTemplate(format);
  const blob = new Blob([template], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ga4-unified-template.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

function generateSampleTemplate(format) {
  const sampleData = [
    {
      parameterName: "user_type",
      displayName: "User Type", 
      description: "Identifies if user is new or returning",
      customDimension: "TRUE",
      customMetric: "FALSE",
      measurementUnit: "STANDARD"
    },
    {
      parameterName: "page_category",
      displayName: "Page Category",
      description: "Category of the page being viewed", 
      customDimension: "TRUE",
      customMetric: "FALSE",
      measurementUnit: "STANDARD"
    },
    {
      parameterName: "page_load_time",
      displayName: "Page Load Time",
      description: "Time taken to load the page",
      customDimension: "FALSE",
      customMetric: "TRUE",
      measurementUnit: "MILLISECONDS"
    }
  ];
  
  switch (format) {
    case 'csv':
      let csv = "Key,Name,Notes/Description,GA4 Custom Dimension,GA4 Custom Metric,Measurement Unit\n";
      sampleData.forEach(item => {
        csv += `"${item.parameterName}","${item.displayName}","${item.description}","${item.customDimension}","${item.customMetric}","${item.measurementUnit}"\n`;
      });
      return csv;
    
    default:
      return JSON.stringify(sampleData, null, 2);
  }
}

function updateDimensionList() {
  const container = document.getElementById('dimensionList');
  const count = document.getElementById('dimensionCount');
  count.textContent = dimensions.length;

  if (dimensions.length === 0) {
    container.innerHTML = '<p>No dimensions added yet. Use the input methods above to add some.</p>';
    return;
  }

  let html = '';
  dimensions.forEach((dim, index) => {
    html += `
      <div class="dimension-item">
        <div>
          <strong>${dim.displayName}</strong> (${dim.parameterName})
          <br><small>${dim.description || 'No description'} - Scope: ${dim.scope}</small>
          <br><small style="color: #666;">Source: ${dim.source}</small>
        </div>
        <button onclick="removeDimension(${index})" class="btn-secondary btn-small">Remove</button>
      </div>
    `;
  });

  container.innerHTML = html;
}

function updateMetricList() {
  const container = document.getElementById('metricList');
  const count = document.getElementById('metricCount');
  count.textContent = metrics.length;

  if (metrics.length === 0) {
    container.innerHTML = '<p>No metrics added yet. Use the input methods above to add some.</p>';
    return;
  }

  let html = '';
  metrics.forEach((metric, index) => {
    html += `
      <div class="metric-item">
        <div>
          <strong>${metric.displayName}</strong> (${metric.parameterName})
          <br><small>${metric.description || 'No description'} - Unit: ${metric.measurementUnit}</small>
          <br><small style="color: #666;">Source: ${metric.source}</small>
        </div>
        <button onclick="removeMetric(${index})" class="btn-secondary btn-small">Remove</button>
      </div>
    `;
  });

  container.innerHTML = html;
}

function removeDimension(index) {
  dimensions.splice(index, 1);
  updateDimensionList();
  updateCreateButton();
}

function removeMetric(index) {
  metrics.splice(index, 1);
  updateMetricList();
  updateCreateButton();
}

function clearAllDimensions() {
  if (confirm('Are you sure you want to clear all dimensions?')) {
    dimensions = [];
    updateDimensionList();
    updateCreateButton();
  }
}

function clearAllMetrics() {
  if (confirm('Are you sure you want to clear all metrics?')) {
    metrics = [];
    updateMetricList();
    updateCreateButton();
  }
}

function validateAllDimensions() {
  const result = validateDimensions(dimensions);
  let message = '';
  if (result.errors.length > 0) {
    message += 'Errors:\n' + result.errors.join('\n') + '\n\n';
  }
  if (result.warnings.length > 0) {
    message += 'Warnings:\n' + result.warnings.join('\n');
  }
  if (message) {
    alert(message);
  } else {
    showSuccess('All dimensions are valid!');
  }
}

function validateAllMetrics() {
  const result = validateMetrics(metrics);
  let message = '';
  if (result.errors.length > 0) {
    message += 'Errors:\n' + result.errors.join('\n') + '\n\n';
  }
  if (result.warnings.length > 0) {
    message += 'Warnings:\n' + result.warnings.join('\n');
  }
  if (message) {
    alert(message);
  } else {
    showSuccess('All metrics are valid!');
  }
}

function validateDimensions(dimensions) {
  console.log('Validating dimensions:', dimensions);
  const errors = [];
  const warnings = [];
  
  dimensions.forEach((dim, index) => {
    console.log(`Validating dimension ${index + 1}:`, dim);
    if (!dim.displayName) {
      errors.push(`Row ${index + 1}: Display name is required`);
    }
    if (!dim.parameterName) {
      errors.push(`Row ${index + 1}: Parameter name is required`);
    }
    
    if (dim.parameterName && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(dim.parameterName)) {
      errors.push(`Row ${index + 1}: Parameter name must start with letter and contain only letters, numbers, and underscores`);
    }
    
    if (dim.displayName && dim.displayName.length > 82) {
      warnings.push(`Row ${index + 1}: Display name is longer than 82 characters`);
    }
    if (dim.description && dim.description.length > 150) {
      warnings.push(`Row ${index + 1}: Description is longer than 150 characters`);
    }
    
    if (dim.scope && !['EVENT', 'USER', 'ITEM'].includes(dim.scope)) {
      warnings.push(`Row ${index + 1}: Invalid scope. Using EVENT as default`);
      dim.scope = 'EVENT';
    }
  });
  
  if (errors.length > 0 || warnings.length > 0) {
    console.log('Validation results:', { errors, warnings });
  }
  
  return { errors, warnings };
}

function validateMetrics(metrics) {
  const errors = [];
  const warnings = [];
  const validUnits = ['STANDARD', 'CURRENCY', 'FEET', 'METERS', 'KILOMETERS', 'MILES', 'MILLISECONDS', 'SECONDS', 'MINUTES', 'HOURS'];
  
  metrics.forEach((metric, index) => {
    if (!metric.displayName) {
      errors.push(`Row ${index + 1}: Display name is required`);
    }
    if (!metric.parameterName) {
      errors.push(`Row ${index + 1}: Parameter name is required`);
    }
    
    if (metric.parameterName && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(metric.parameterName)) {
      errors.push(`Row ${index + 1}: Parameter name must start with letter and contain only letters, numbers, and underscores`);
    }
    
    if (metric.displayName && metric.displayName.length > 82) {
      warnings.push(`Row ${index + 1}: Display name is longer than 82 characters`);
    }
    if (metric.description && metric.description.length > 150) {
      warnings.push(`Row ${index + 1}: Description is longer than 150 characters`);
    }
    
    if (metric.measurementUnit && !validUnits.includes(metric.measurementUnit)) {
      warnings.push(`Row ${index + 1}: Invalid measurement unit. Using STANDARD as default`);
      metric.measurementUnit = 'STANDARD';
    }
  });
  
  return { errors, warnings };
}

function updateCreateButton() {
  const createBtn = document.getElementById('createBtn');
  const sectionTitle = document.getElementById('createSectionTitle');
  const processText = document.getElementById('processText');

  const itemsCount = currentTab === 'dimensions' ? dimensions.length : metrics.length;
  createBtn.disabled = selectedPropertyIds.length === 0 || itemsCount === 0;

  if (currentTab === 'dimensions') {
    createBtn.textContent = `Create ${itemsCount} Custom Dimensions in ${selectedPropertyIds.length} Properties`;
    sectionTitle.textContent = "Create Custom Dimensions";
    processText.textContent = "Creating custom dimensions...";
  } else {
    createBtn.textContent = `Create ${itemsCount} Custom Metrics in ${selectedPropertyIds.length} Properties`;
    sectionTitle.textContent = "Create Custom Metrics";
    processText.textContent = "Creating custom metrics...";
  }
}