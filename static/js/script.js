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
    let conversionId = null;
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
        
        // In a real implementation, you would validate the API key with your backend
        // For now, we'll just simulate success
        setTimeout(() => {
            hideLoading();
            showAlert(apiKeyStatus, 'API Key set successfully!', 'success');
            apiKeyInput.disabled = true;
            setApiKeyBtn.disabled = true;
            editApiKeyBtn.disabled = false;
            apiKeySet = true;
            localStorage.setItem('apiKey', apiKey);
            updateConversionButtons();
        }, 500);
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
        
        // Create FormData object and append file
        const formData = new FormData();
        formData.append('file', file);
        formData.append('hardware_id', hardwareIdInput.value);
        
        // Show loading overlay
        showLoading(`Converting ${file.name} to ${type === 'latex_mcq' ? 'LaTeX/MCQ' : 'text'}...`);
        
        // Update progress bar to show indeterminate progress
        overallProgressBar.style.width = '100%';
        overallProgressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
        statusLabel.textContent = 'Status: Processing...';
        
        // Simulate conversion process with progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            if (progress > 90) {
                clearInterval(interval);
            }
            overallProgressBar.style.width = `${progress}%`;
        }, 500);
        
        setTimeout(() => {
            // Simulate conversion complete
            clearInterval(interval);
            overallProgressBar.style.width = '100%';
            overallProgressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
            
            // Show result
            resultText.value = `This is simulated ${type} conversion result for ${file.name}.
            
In a real implementation, this would be the actual converted content from the PDF/Image.

For a LaTeX example:
$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$

With proper backend implementation, this will be replaced with actual converted content.`;
            
            hideLoading();
            statusLabel.textContent = 'Status: Conversion complete';
            
            // Enable buttons
            convertBtn.disabled = false;
            latexMcqBtn.disabled = false;
            wordBtn.disabled = false;
            
            showAlert(fileStatus, 'Conversion completed successfully.', 'success');
        }, 3000);
    }
    
    function convertToWord() {
        const content = resultText.value;
        if (!content) {
            alert('No content to convert to Word.');
            return;
        }
        
        showLoading('Converting to Word...');
        
        // Simulate Word conversion
        setTimeout(() => {
            hideLoading();
            alert('Word conversion is simulated. In a real implementation, this would trigger a download.');
        }, 1500);
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
