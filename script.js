// Global state
let currentStep = 1;
let formData = {
    trackingTemplate: '',
    destinations: [],
    pixels: {}
};
let configResponse = null;

// Event templates for each tracking template
const eventTemplates = {
    ecommerce: ['Add to Cart', 'Purchase'],
    leads: ['Form Submit', 'Lead Generated'],
    engagement: ['Page View', 'Button Click'],
    conversions: ['Conversion', 'Goal Completed']
};

// Platform requirements
const platformRequirements = {
    ga4: {
        name: 'Google Analytics 4',
        imagePath: "logos/google-analytics-svgrepo-com.svg",
        fields: [{ name: 'Measurement ID', placeholder: 'G-XXXXXXXXXX' }]
    },
    meta: {
        name: 'Meta Pixel',
        imagePath: "logos/Meta_Platforms_Inc._logo_(cropped).svg",
        fields: [{ name: 'Pixel ID', placeholder: 'Facebook Pixel ID' }]
    },
    tiktok: {
        name: 'TikTok Pixel',
        imagePath: "logos/tiktok-svgrepo-com.svg",
        fields: [{ name: 'Pixel ID', placeholder: 'TikTok Pixel ID' }]
    },
    linkedin: {
        name: 'LinkedIn Insight Tag',
        imagePath: "logos/linkedin-1-svgrepo-com.svg",
        fields: [{ name: 'Partner ID', placeholder: 'LinkedIn Partner ID' }]
    },
    snapchat: {
        name: 'Snapchat Pixel',
        imagePath: "logos/snapchat-svgrepo-com.svg",
        fields: [{ name: 'Pixel ID', placeholder: 'Snapchat Pixel ID' }]
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    updateProgressBar();
});

function setupEventListeners() {
    // Step 1 - Tracking Template
    document.getElementById('trackingTemplate').addEventListener('change', function() {
        formData.trackingTemplate = this.value;
        document.getElementById('step1Next').disabled = !this.value;
    });

    // Step 2 - Destination cards
    document.querySelectorAll('.destination-card').forEach(card => {
        card.addEventListener('click', function() {
            const checkbox = this.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            toggleDestination(checkbox.value, checkbox.checked);
            updateDestinationUI();
        });

        const checkbox = card.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', function(e) {
            e.stopPropagation();
            toggleDestination(this.value, this.checked);
            updateDestinationUI();
        });
    });
}

function toggleDestination(destination, selected) {
    if (selected) {
        if (!formData.destinations.includes(destination)) {
            formData.destinations.push(destination);
        }
    } else {
        formData.destinations = formData.destinations.filter(d => d !== destination);
    }
}

function updateDestinationUI() {
    document.querySelectorAll('.destination-card').forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox.checked) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });

    document.getElementById('step2Next').disabled = formData.destinations.length === 0;
}

function generateIdInputs() {
    const container = document.getElementById('idInputs');
    container.innerHTML = '';

    formData.destinations.forEach(dest => {
        const config = platformRequirements[dest];
        const section = document.createElement('div');
        section.className = 'config-section';

        let inputsHTML = `
            <div class="config-header">
        <div class="config-icon">
            <img src="${config.imagePath}" alt="${config.name}" style="width: 40px; height: 40px; object-fit: contain;">
        </div>
        <div class="config-title">${config.name}</div>
    </div>
        `;

        config.fields.forEach(field => {
            const fieldId = `${dest}_${field.name.replace(/\s+/g, '_').toLowerCase()}`;
            inputsHTML += `
                <div class="input-group">
                    <label for="${fieldId}">${field.name}</label>
                    <input type="text" id="${fieldId}" data-destination="${dest}" 
                           data-field="${field.name}" placeholder="${field.placeholder}">
                </div>
            `;
        });

        section.innerHTML = inputsHTML;
        container.appendChild(section);
    });

    // Add event listeners
    container.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', validateStep3);
    });
}

function getIconBackground(dest) {
    const backgrounds = {
        ga4: 'linear-gradient(135deg, #4285f4, #34a853)',
        meta: 'linear-gradient(135deg, #1877f2, #42a5f5)',
        tiktok: '#000',
        linkedin: '#0077b5',
        snapchat: 'linear-gradient(135deg, #fffc00, #ffb300)'
    };
    return backgrounds[dest] || '#4285f4';
}

function validateStep3() {
    const inputs = document.querySelectorAll('#idInputs input');
    const allFilled = Array.from(inputs).every(input => input.value.trim() !== '');
    document.getElementById('step3Next').disabled = !allFilled;
}

function collectIdData() {
    const inputs = document.querySelectorAll('#idInputs input');
    formData.pixels = {};

    inputs.forEach(input => {
        const destination = input.dataset.destination;
        const value = input.value.trim();
        if (value) {
            formData.pixels[destination] = value;
        }
    });
}

function generateConfigSummary() {
    const container = document.getElementById('configSummary');
    const eventsToTrack = eventTemplates[formData.trackingTemplate] || ['Add to Cart', 'Purchase'];
    
    let summaryHTML = `
        <div class="config-section">
            <h3 style="margin-bottom: 20px; color: #202124;">Events Configuration</h3>
            <div class="input-group">
                <strong>Tracking Template:</strong> ${getTrackingTemplateName(formData.trackingTemplate)}
            </div>
            <div class="input-group">
                <strong>Events to be Configured:</strong>
                <div class="events-list" style="margin-top: 12px;">
                    ${eventsToTrack.map(event => `
                        <div class="event-item" style="
                            background: #f8f9ff;
                            border: 2px solid #e8eaed;
                            border-radius: 8px;
                            padding: 12px 16px;
                            margin-bottom: 8px;
                            display: flex;
                            align-items: center;
                        ">
                            <span style="
                                width: 24px;
                                height: 24px;
                                background: #4285f4;
                                border-radius: 50%;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                color: white;
                                font-size: 12px;
                                font-weight: 600;
                                margin-right: 12px;
                            ">✓</span>
                            <span style="font-weight: 500; color: #202124;">${event}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="input-group">
                <strong>Target Platforms:</strong> ${formData.destinations.map(d => platformRequirements[d].name).join(', ')}
            </div>
        </div>
    `;

    container.innerHTML = summaryHTML;
}

function getTrackingTemplateName(template) {
    const templateNames = {
        ecommerce: 'E-commerce Events Template',
        leads: 'Lead Generation Template',
        engagement: 'User Engagement Template',
        conversions: 'Conversion Template'
    };
    return templateNames[template] || template;
}

function nextStep() {
    if (currentStep === 3) {
        collectIdData();
    }
    if (currentStep === 4) {
        return; // Don't auto-advance from step 4, user must click create
    }

    const currentStepEl = document.getElementById(`step${currentStep}`);
    const currentCircle = document.getElementById(`circle${currentStep}`);
    const currentLabel = document.getElementById(`label${currentStep}`);

    // Mark current step as completed
    currentStepEl.classList.remove('active');
    currentCircle.classList.remove('active');
    currentCircle.classList.add('completed');
    currentLabel.classList.remove('active');

    currentStep++;

    // Special handling for step 3
    if (currentStep === 3) {
        generateIdInputs();
    }

    // Special handling for step 4
    if (currentStep === 4) {
        generateConfigSummary();
    }

    // Show new step
    const nextStepEl = document.getElementById(`step${currentStep}`);
    const nextCircle = document.getElementById(`circle${currentStep}`);
    const nextLabel = document.getElementById(`label${currentStep}`);

    nextStepEl.classList.add('active');
    nextCircle.classList.add('active');
    nextLabel.classList.add('active');

    updateProgressBar();
}

function prevStep() {
    if (currentStep <= 1) return;

    const currentStepEl = document.getElementById(`step${currentStep}`);
    const currentCircle = document.getElementById(`circle${currentStep}`);
    const currentLabel = document.getElementById(`label${currentStep}`);

    currentStepEl.classList.remove('active');
    currentCircle.classList.remove('active');
    currentLabel.classList.remove('active');

    currentStep--;

    const prevStepEl = document.getElementById(`step${currentStep}`);
    const prevCircle = document.getElementById(`circle${currentStep}`);
    const prevLabel = document.getElementById(`label${currentStep}`);

    prevStepEl.classList.add('active');
    prevCircle.classList.remove('completed');
    prevCircle.classList.add('active');
    prevLabel.classList.add('active');

    updateProgressBar();
}

function updateProgressBar() {
    const progressFill = document.getElementById('progressFill');
    const progress = ((currentStep - 1) / 4) * 100;
    progressFill.style.width = `${progress}%`;
}

async function createConfiguration() {
    // Move to step 5 and show loading
    const currentStepEl = document.getElementById(`step${currentStep}`);
    const currentCircle = document.getElementById(`circle${currentStep}`);
    const currentLabel = document.getElementById(`label${currentStep}`);

    currentStepEl.classList.remove('active');
    currentCircle.classList.remove('active');
    currentCircle.classList.add('completed');
    currentLabel.classList.remove('active');

    currentStep = 5;

    const nextStepEl = document.getElementById(`step${currentStep}`);
    const nextCircle = document.getElementById(`circle${currentStep}`);
    const nextLabel = document.getElementById(`label${currentStep}`);

    nextStepEl.classList.add('active');
    nextCircle.classList.add('active');
    nextLabel.classList.add('active');

    updateProgressBar();

    // Show loading state
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successContent').style.display = 'none';

    try {
        const response = await fetch('http://localhost:8080/configure', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                destinations: formData.destinations,
                pixels: formData.pixels
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `API Error: ${response.status}`);
        }

        configResponse = await response.json();
        showSuccessState();

    } catch (error) {
        console.error('Configuration error:', error);
        showErrorState(error.message);
    }
}

function showSuccessState() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successContent').style.display = 'block';

    // Update the completed circle
    const circle5 = document.getElementById('circle5');
    circle5.classList.remove('active');
    circle5.classList.add('completed');

    // Show preview
    const preview = document.getElementById('configPreview');
    const previewData = {
        message: configResponse.message,
        configuration: configResponse.configuration,
        merged_stats: configResponse.merged_stats,
        pixel_injection: configResponse.pixel_injection
    };
    
    preview.textContent = JSON.stringify(previewData, null, 2);
}

function showErrorState(errorMessage) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('successContent').style.display = 'none';
    
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = `Error: ${errorMessage}`;
    errorEl.style.display = 'block';

    // Show retry button
    const retryHTML = `
        <div class="buttons" style="margin-top: 20px;">
            <button class="btn-secondary" onclick="prevStep()">Back</button>
            <button class="btn-primary" onclick="createConfiguration()">Retry</button>
        </div>
    `;
    errorEl.insertAdjacentHTML('afterend', retryHTML);
}

function downloadJSON() {
    if (!configResponse || !configResponse.output || !configResponse.output.filename) {
        alert('No configuration file available for download');
        return;
    }

    const filename = configResponse.output.filename;
    const downloadUrl = `http://localhost:8080/download/${encodeURIComponent(filename)}`;
    
    // Create temporary anchor for download
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function integrateWithGTM() {
    alert('GTM integration functionality will be available soon. Please use the Download JSON option for now.');
}

function resetWizard() {
    // Reset all data
    currentStep = 1;
    formData = {
        trackingTemplate: '',
        destinations: [],
        pixels: {}
    };
    configResponse = null;

    // Reset UI elements
    document.getElementById('trackingTemplate').value = '';
    document.getElementById('step1Next').disabled = true;

    // Uncheck all destinations
    document.querySelectorAll('.destination-card').forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        checkbox.checked = false;
        card.classList.remove('selected');
    });

    document.getElementById('step2Next').disabled = true;

    // Clear ID inputs
    document.getElementById('idInputs').innerHTML = '';
    document.getElementById('step3Next').disabled = true;

    // Reset all steps and circles
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`step${i}`);
        const circle = document.getElementById(`circle${i}`);
        const label = document.getElementById(`label${i}`);

        step.classList.remove('active');
        circle.classList.remove('active', 'completed');
        label.classList.remove('active');

        if (i === 1) {
            step.classList.add('active');
            circle.classList.add('active');
            label.classList.add('active');
        }
    }

    // Reset step 5 content
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successContent').style.display = 'none';

    // Remove any retry buttons
    const retryButtons = document.querySelectorAll('#errorMessage + .buttons');
    retryButtons.forEach(btn => btn.remove());

    updateProgressBar();
}