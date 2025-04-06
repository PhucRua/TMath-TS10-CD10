document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const apiKeyInput = document.getElementById('apiKeyInput');
    const setApiKeyBtn = document.getElementById('setApiKeyBtn');
    const editApiKeyBtn = document.getElementById('editApiKeyBtn');
    const apiKeyStatus = document.getElementById('apiKeyStatus');
    
    const hardwareIdInput = document.getElementById('hardwareIdInput');
    const activationStatus = document.getElementById('activationStatus');
    const cpuIdInput = document.getElementById('cpuIdInput');
    const biosSerialInput = document.getElementById('biosSerialInput');
    const motherboardSerialInput = document.getElementById('motherboardSerialInput');
    const generateHardwareIdBtn = document.getElementById('generateHardwareIdBtn');
    const customizeHardwareIdBtn = document.getElementById('customizeHardwareIdBtn');
    const hardwareInfoSection = document.getElementById('hardwareInfoSection');
    
    const uploadPdfBtn = document.getElementById('uploadPdfBtn');
    const uploadImageBtn = document.getElementById('uploadImageBtn');
    const fileInput = document.getElementById('fileInput');
    const fileLabel = document.getElementById('fileLabel');
    const fileStatus = document.getElementById('fileStatus');
    
    const convertBtn = document.getElementById('convertBtn');
    const latexMcqBtn = document.getElementById('latexMcqBtn');
    const wordBtn = document.getElementById('wordBtn');
    
    const overallProgressBar = document.getElementById('overallProgressBar');
    const statusLabel = document.getElementById('statusLabel');
    const progressBarsContainer = document.getElementById('progressBarsContainer');
    const partsProgressContainer = document.getElementById('partsProgressContainer');
    
    const resultText = document.getElementById('resultText');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingMessage = document.getElementById('loadingMessage');
    
    // State variables
    let jobId = null;
    let pollInterval = null;
    let isActivated = false;
    let apiKeySet = false;
    let fileUploaded = false;
    let isSingleFile = true;
    let totalParts = 0;
    
    // Load FingerprintJS from CDN
    const fpPromise = import('https://openfpcdn.io/fingerprintjs/v3')
        .then(FingerprintJS => FingerprintJS.load());
    
    // Hide parts progress initially
    partsProgressContainer.style.display = 'none';
    
    // Check for stored API key in localStorage
    const storedApiKey = localStorage.getItem('apiKey');
    if (storedApiKey) {
        apiKeyInput.value = storedApiKey;
        setApiKey();
    }
    
    // Auto-generate hardware ID on page load
    generateHardwareIdAuto();
    
    // Event Listeners
    setApiKeyBtn.addEventListener('click', setApiKey);
    editApiKeyBtn.addEventListener('click', editApiKey);
    generateHardwareIdBtn.addEventListener('click', generateHardwareIdCustom);
    customizeHardwareIdBtn.addEventListener('click', toggleHardwareInfoSection);
    
    uploadPdfBtn.addEventListener('click', () => {
        fileInput.accept = '.pdf';
        fileInput.click();
    });
    
    uploadImageBtn.addEventListener('click', () => {
        fileInput.accept = '.png,.jpg,.jpeg';
        fileInput.click();
    });
    
    fileInput.addEventListener('change', uploadFile);
    
    convertBtn.addEventListener('click', () => convertFile('text'));
    latexMcqBtn.addEventListener('click', () => convertFile('latex_mcq'));
    wordBtn.addEventListener('click', convertToWord);
    
    // Functions
    async function generateHardwareIdAuto() {
        showLoading('Đang tạo Hardware ID...');
        
        try {
            // Use FingerprintJS to get unique visitor ID
            const fp = await fpPromise;
            const result = await fp.get();
            
            // Get additional browser info
            const cpuCores = navigator.hardwareConcurrency || '';
            const platform = navigator.platform || '';
            const userAgent = navigator.userAgent || '';
            
            // Create combined hardware info
            const hardwareInfo = {
                cpu_id: result.visitorId + cpuCores,
                bios_serial: platform + result.visitorId.substring(0, 8),
                motherboard_serial: userAgent.slice(0, 20) + result.visitorId.substring(8, 16)
            };
            
            // Send to server to generate hardware ID
            const response = await fetch('/api/hardware-id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(hardwareInfo)
            });
            
            const data = await response.json();
            hideLoading();
            
            if (data.success) {
                hardwareIdInput.value = data.hardware_id;
                isActivated = data.activated;
                updateActivationStatus();
                updateConversionButtons();
            } else {
                showAlert(fileStatus, `Lỗi: ${data.error}`, 'danger');
            }
        } catch (error) {
            hideLoading();
            showAlert(fileStatus, `Lỗi khi tạo Hardware ID: ${error.message}`, 'danger');
            console.error('Hardware ID generation error:', error);
        }
    }
    
    function toggleHardwareInfoSection() {
        hardwareInfoSection.classList.toggle('d-none');
        if (!hardwareInfoSection.classList.contains('d-none')) {
            customizeHardwareIdBtn.textContent = 'Ẩn tùy chỉnh';
        } else {
            customizeHardwareIdBtn.textContent = 'Tùy chỉnh Hardware ID';
        }
    }
    
    function generateHardwareIdCustom() {
        const cpuId = cpuIdInput.value.trim();
        const biosSerial = biosSerialInput.value.trim();
        const motherboardSerial = motherboardSerialInput.value.trim();
        
        if (!cpuId || !biosSerial || !motherboardSerial) {
            showAlert(apiKeyStatus, 'Vui lòng nhập đầy đủ thông tin phần cứng.', 'warning');
            return;
        }
        
        showLoading('Đang tạo Hardware ID...');
        
        fetch('/api/hardware-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cpu_id: cpuId,
                bios_serial: biosSerial,
                motherboard_serial: motherboardSerial
            })
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();
            if (data.success) {
                hardwareIdInput.value = data.hardware_id;
                isActivated = data.activated;
                updateActivationStatus();
                updateConversionButtons();
                
                // Ẩn phần tùy chỉnh sau khi đã tạo thành công
                hardwareInfoSection.classList.add('d-none');
                customizeHardwareIdBtn.textContent = 'Tùy chỉnh Hardware ID';
                showAlert(apiKeyStatus, 'Hardware ID đã được tạo thành công.', 'success');
            } else {
                showAlert(apiKeyStatus, `Lỗi: ${data.error}`, 'danger');
            }
        })
        .catch(error => {
            hideLoading();
            showAlert(apiKeyStatus, `Lỗi: ${error.message}`, 'danger');
        });
    }
    
    function setApiKey() {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            showAlert(apiKeyStatus, 'Please enter an API Key.', 'warning');
            return;
        }
        
        showLoading('Setting API Key...');
        
        fetch('/api/set-api-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();
            if (data.success) {
                showAlert(apiKeyStatus, `API Key set successfully! Using model: ${data.model}`, 'success');
                apiKeyInput.disabled = true;
                setApiKeyBtn.disabled = true;
                editApiKeyBtn.disabled = false;
                apiKeySet = true;
                localStorage.setItem('apiKey', apiKey);
                updateConversionButtons();
            } else {
                showAlert(apiKeyStatus, `Lỗi: ${data.message}`, 'danger');
            }
        })
        .catch(error => {
            hideLoading();
            showAlert(apiKeyStatus, `Lỗi: ${error.message}`, 'danger');
        });
    }
    
    function editApiKey() {
        apiKeyInput.disabled = false;
        setApiKeyBtn.disabled = false;
        editApiKeyBtn.disabled = true;
        apiKeySet = false;
        updateConversionButtons();
    }
    
    function updateActivationStatus() {
        if (isActivated) {
            activationStatus.textContent = 'ĐÃ KÍCH HOẠT';
            activationStatus.classList.remove('bg-warning');
            activationStatus.classList.add('bg-success');
            activationStatus.classList.remove('text-dark');
            activationStatus.classList.add('text-white');
        } else {
            activationStatus.textContent = 'CHƯA KÍCH HOẠT';
            activationStatus.classList.remove('bg-success');
            activationStatus.classList.add('bg-warning');
            activationStatus.classList.add('text-dark');
            activationStatus.classList.remove('text-white');
        }
    }
    
    function uploadFile() {
        if (!apiKeySet) {
            showAlert(fileStatus, 'Please set the API Key first.', 'warning');
            return;
        }
        
        if (!isActivated) {
            showAlert(fileStatus, 'Please activate the application first.', 'warning');
            return;
        }
        
        const file = fileInput.files[0];
        if (!file) return;
        
        fileLabel.textContent = `File: ${file.name}`;
        fileUploaded = true;
        updateConversionButtons();
        showAlert(fileStatus, `File selected: ${file.name}`, 'info');
    }
    
    function createProgressBars(count) {
        progressBarsContainer.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const container = document.createElement('div');
            container.className = 'part-progress';
            
            const label = document.createElement('div');
            label.textContent = `Part ${i + 1}:`;
            
            const progressBar = document.createElement('div');
            progressBar.className = 'progress';
            
            const progress = document.createElement('div');
            progress.className = 'progress-bar';
            progress.id = `progress-${i}`;
            progress.setAttribute('role', 'progressbar');
            progress.style.width = '0%';
            progress.setAttribute('aria-valuenow', '0');
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', '100');
            
            progressBar.appendChild(progress);
            container.appendChild(label);
            container.appendChild(progressBar);
            progressBarsContainer.appendChild(container);
        }
    }
    
    function convertFile(type) {
        if (!apiKeySet) {
            alert('Please set the API Key first.');
            return;
        }
        
        if (!isActivated) {
            alert('Please activate the application first.');
            return;
        }
        
        if (!fileUploaded) {
            alert('Please upload a file first.');
            return;
        }
        
        const file = fileInput.files[0];
        if (!file) {
            alert('Please select a file first.');
            return;
        }
        
        convertBtn.disabled = true;
        latexMcqBtn.disabled = true;
        
        // Create FormData object and append file and necessary data
        const formData = new FormData();
        formData.append('file', file);
        formData.append('hardware_id', hardwareIdInput.value);
        formData.append('api_key', apiKeyInput.value);
        formData.append('conversion_type', type);
        
        // Show loading overlay
        showLoading(`Converting ${file.name} to ${type === 'latex_mcq' ? 'LaTeX/MCQ' : 'text'}...`);
        
        // Start with progress at 0
        overallProgressBar.style.width = '0%';
        overallProgressBar.textContent = '0%';
        statusLabel.textContent = 'Status: Uploading file...';
        
        // Upload file and start conversion
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                if (data.single_file === false) {
                    // Handle multi-part file - start conversion
                    statusLabel.textContent = 'Status: Processing multi-part file...';
                    overallProgressBar.style.width = '30%';
                    overallProgressBar.textContent = '30%';
                    
                    // Create progress bars for parts
                    partsProgressContainer.style.display = 'block';
                    totalParts = data.total_parts;
                    createProgressBars(totalParts);
                    
                    // Store job ID for polling
                    jobId = data.job_id;
                    
                    // Start conversion with API key
                    return fetch('/api/convert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            type: type,
                            api_key: apiKeyInput.value,
                            job_id: jobId
                        })
                    });
                } else {
                    // Single file was already processed
                    overallProgressBar.style.width = '100%';
                    overallProgressBar.textContent = '100%';
                    statusLabel.textContent = 'Status: Conversion complete';
                    
                    // Display result
                    resultText.value = data.result || 'Conversion completed successfully.';
                    wordBtn.disabled = false;
                    
                    // Re-enable conversion buttons
                    convertBtn.disabled = false;
                    latexMcqBtn.disabled = false;
                    
                    hideLoading();
                    return null; // No need for further processing
                }
            } else {
                throw new Error(data.error || 'File upload failed');
            }
        })
        .then(response => {
            if (!response) return null; // Skip if single file
            return response.json();
        })
        .then(data => {
            if (!data) return; // Skip if single file
            
            if (data.success) {
                // Start polling for status of multi-part conversion
                jobId = data.job_id;
                startPolling();
            } else {
                throw new Error(data.message || 'Conversion failed');
            }
        })
        .catch(error => {
            hideLoading();
            statusLabel.textContent = `Status: Error - ${error.message}`;
            overallProgressBar.style.width = '0%';
            overallProgressBar.textContent = '0%';
            alert(`Error: ${error.message}`);
            
            // Re-enable conversion buttons
            convertBtn.disabled = false;
            latexMcqBtn.disabled = false;
        });
    }
    
    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(() => {
            fetch('/api/conversion-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: jobId })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Update progress based on completed parts
                    const progress = Math.round((data.completed / data.total) * 100);
                    overallProgressBar.style.width = `${progress}%`;
                    overallProgressBar.textContent = `${progress}%`;
                    statusLabel.textContent = `Status: Processing (${data.completed}/${data.total})`;
                    
                    // Update individual progress bars
                    for (let i = 0; i < data.completed; i++) {
                        const progressBar = document.getElementById(`progress-${i}`);
                        if (progressBar) {
                            progressBar.style.width = '100%';
                            progressBar.setAttribute('aria-valuenow', '100');
                        }
                    }
                    
                    if (data.status === 'completed') {
                        // Conversion completed
                        clearInterval(pollInterval);
                        hideLoading();
                        resultText.value = data.result;
                        statusLabel.textContent = `Status: Conversion completed successfully`;
                        overallProgressBar.style.width = '100%';
                        overallProgressBar.textContent = '100%';
                        convertBtn.disabled = false;
                        latexMcqBtn.disabled = false;
                        wordBtn.disabled = false;
                        
                        // Update all progress bars to 100%
                        for (let i = 0; i < totalParts; i++) {
                            const progress = document.getElementById(`progress-${i}`);
                            if (progress) {
                                progress.style.width = '100%';
                                progress.setAttribute('aria-valuenow', '100');
                            }
                        }
                    }
                } else {
                    if (data.status === 'error') {
                        clearInterval(pollInterval);
                        hideLoading();
                        statusLabel.textContent = `Status: Error - ${data.message}`;
                        alert(`Error: ${data.message}`);
                        convertBtn.disabled = false;
                        latexMcqBtn.disabled = false;
                    }
                }
            })
            .catch(error => {
                // Don't clear interval on network errors - retry
                console.error(`Error polling status: ${error.message}`);
            });
        }, 3000); // Poll every 3 seconds
    }
    
    function convertToWord() {
        const content = resultText.value;
        if (!content) {
            alert('No content to convert to Word.');
            return;
        }
        
        showLoading('Converting to Word...');
        
        fetch('/convert-to-word', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        })
        .then(response => {
            hideLoading();
            
            if (response.ok) {
                // Create a link to download the file
                return response.blob().then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = 'converted_document.docx';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                });
            } else {
                // Handle error
                return response.json().then(data => {
                    throw new Error(data.message || 'Word conversion failed');
                });
            }
        })
        .catch(error => {
            hideLoading();
            alert(`Error converting to Word: ${error.message}`);
        });
    }
    
    function updateConversionButtons() {
        const canConvert = apiKeySet && isActivated && fileUploaded;
        convertBtn.disabled = !canConvert;
        latexMcqBtn.disabled = !canConvert;
    }
    
    function showAlert(element, message, type) {
        element.textContent = message;
        element.className = `alert alert-${type}`;
        element.classList.remove('d-none');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            element.classList.add('d-none');
        }, 5000);
    }
    
    function showLoading(message) {
        loadingMessage.textContent = message || 'Processing...';
        loadingOverlay.classList.remove('d-none');
    }
    
    function hideLoading() {
        loadingOverlay.classList.add('d-none');
    }
});
