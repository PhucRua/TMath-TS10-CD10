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
    
    // Hide parts progress initially
    partsProgressContainer.style.display = 'none';
    
    // Check for stored API key in localStorage
    const storedApiKey = localStorage.getItem('apiKey');
    if (storedApiKey) {
        apiKeyInput.value = storedApiKey;
        setApiKey();
    }
    
    // Event Listeners
    setApiKeyBtn.addEventListener('click', setApiKey);
    editApiKeyBtn.addEventListener('click', editApiKey);
    generateHardwareIdBtn.addEventListener('click', generateHardwareId);
    
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
                showAlert(apiKeyStatus, `Error: ${data.message}`, 'danger');
            }
        })
        .catch(error => {
            hideLoading();
            showAlert(apiKeyStatus, `Error: ${error.message}`, 'danger');
        });
    }
    
    function editApiKey() {
        apiKeyInput.disabled = false;
        setApiKeyBtn.disabled = false;
        editApiKeyBtn.disabled = true;
        apiKeySet = false;
        updateConversionButtons();
    }
    
    function generateHardwareId() {
        const cpuId = cpuIdInput.value.trim();
        const biosSerial = biosSerialInput.value.trim();
        const motherboardSerial = motherboardSerialInput.value.trim();
        
        if (!cpuId || !biosSerial || !motherboardSerial) {
            alert('Please fill in all hardware information fields.');
            return;
        }
        
        showLoading('Generating Hardware ID...');
        
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
            } else {
                alert(`Error: ${data.error}`);
            }
        })
        .catch(error => {
            hideLoading();
            alert(`Error: ${error.message}`);
        });
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
        
        const formData = new FormData();
        formData.append('file', file);
        
        showLoading('Uploading file...');
        
        fetch('/api/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();
            if (data.success) {
                showAlert(fileStatus, data.message, 'success');
                fileUploaded = true;
                isSingleFile = data.single_file;
                
                if (!data.single_file) {
                    totalParts = data.total_parts;
                    partsProgressContainer.style.display = 'block';
                    createProgressBars(totalParts);
                } else {
                    partsProgressContainer.style.display = 'none';
                }
                
                updateConversionButtons();
            } else {
                showAlert(fileStatus, `Error: ${data.message}`, 'danger');
            }
        })
        .catch(error => {
            hideLoading();
            showAlert(fileStatus, `Error: ${error.message}`, 'danger');
        });
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
        
        convertBtn.disabled = true;
        latexMcqBtn.disabled = true;
        resultText.value = '';
        
        if (isSingleFile) {
            showLoading(`Converting to ${type === 'latex_mcq' ? 'LaTeX/MCQ' : 'text'}...`);
            
            fetch('/api/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: type })
            })
            .then(response => response.json())
            .then(data => {
                hideLoading();
                if (data.success) {
                    resultText.value = data.result;
                    wordBtn.disabled = false;
                } else {
                    alert(`Error: ${data.message}`);
                }
                convertBtn.disabled = false;
                latexMcqBtn.disabled = false;
            })
            .catch(error => {
                hideLoading();
                alert(`Error: ${error.message}`);
                convertBtn.disabled = false;
                latexMcqBtn.disabled = false;
            });
        } else {
            // For split files, start conversion and poll for status
            showLoading(`Starting conversion to ${type === 'latex_mcq' ? 'LaTeX/MCQ' : 'text'}...`);
            
            fetch('/api/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: type })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Update UI to show conversion is in progress
                    statusLabel.textContent = `Status: Conversion in progress (0/${totalParts} completed)`;
                    overallProgressBar.style.width = '0%';
                    loadingMessage.textContent = 'Conversion in progress. This may take several minutes...';
                    
                    // Store conversion ID and start polling
                    conversionId = data.conversion_id;
                    startPolling();
                } else {
                    hideLoading();
                    alert(`Error: ${data.message}`);
                    convertBtn.disabled = false;
                    latexMcqBtn.disabled = false;
                }
            })
            .catch(error => {
                hideLoading();
                alert(`Error: ${error.message}`);
                convertBtn.disabled = false;
                latexMcqBtn.disabled = false;
            });
        }
    }
    
    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(() => {
            fetch('/api/conversion-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversion_id: conversionId })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    if (data.status === 'completed') {
                        // Conversion completed
                        clearInterval(pollInterval);
                        hideLoading();
                        resultText.value = data.result;
                        statusLabel.textContent = `Status: Conversion completed successfully`;
                        overallProgressBar.style.width = '100%';
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
                    // For in_progress, we just keep polling
                } else {
                    clearInterval(pollInterval);
                    hideLoading();
                    alert(`Error: ${data.message}`);
                    convertBtn.disabled = false;
                    latexMcqBtn.disabled = false;
                }
            })
            .catch(error => {
                clearInterval(pollInterval);
                hideLoading();
                alert(`Error polling status: ${error.message}`);
                convertBtn.disabled = false;
                latexMcqBtn.disabled = false;
            });
        }, 5000); // Poll every 5 seconds
    }
    
    function convertToWord() {
        const content = resultText.value;
        if (!content) {
            alert('No content to convert to Word.');
            return;
        }
        
        showLoading('Converting to Word...');
        
        fetch('/api/word-convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();
            if (data.success) {
                // Convert hex string back to binary data
                const binaryString = hexToBytes(data.docx_data);
                
                // Create a Blob from the binary data
                const blob = new Blob([binaryString], { 
                    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
                });
                
                // Create a download link and trigger it
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'converted_document.docx';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                alert(`Error: ${data.message}`);
            }
        })
        .catch(error => {
            hideLoading();
            alert(`Error: ${error.message}`);
        });
    }
    
    function hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
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
