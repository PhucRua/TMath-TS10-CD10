// Generate hardware ID using browser fingerprinting
async function generateHardwareId() {
    const fpPromise = import('https://openfpcdn.io/fingerprintjs/v3')
        .then(FingerprintJS => FingerprintJS.load());
    
    const fp = await fpPromise;
    const result = await fp.get();

    // Get some additional browser info
    const cpuCores = navigator.hardwareConcurrency || '';
    const platform = navigator.platform || '';
    const userAgent = navigator.userAgent || '';
    
    // Create combined hardware info
    const hardwareInfo = {
        cpu_id: result.visitorId + cpuCores,
        bios_serial: platform + result.visitorId.substring(0, 8),
        motherboard_serial: userAgent.slice(0, 20) + result.visitorId.substring(8, 16)
    };
    
    // Get hardware ID from server
    try {
        const response = await fetch('/api/hardware-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(hardwareInfo)
        });
        
        const data = await response.json();
        if (data.success) {
            document.getElementById('hardwareId').value = data.hardware_id;
            updateActivationStatus(data.activated);
        } else {
            logMessage('Lỗi: ' + data.error);
        }
    } catch (error) {
        logMessage('Lỗi khi lấy Hardware ID: ' + error);
    }
}

function updateActivationStatus(activated) {
    const statusElement = document.getElementById('activationStatus');
    const fileInput = document.getElementById('pdfFile');
    const processBtn = document.getElementById('processBtn');
    
    if (activated) {
        statusElement.className = 'alert alert-success';
        statusElement.textContent = 'Trạng thái: ĐÃ KÍCH HOẠT';
        fileInput.disabled = false;
        logMessage('Phần mềm đã được kích hoạt, sẵn sàng sử dụng');
    } else {
        statusElement.className = 'alert alert-warning';
        statusElement.textContent = 'Trạng thái: CHƯA KÍCH HOẠT';
        fileInput.disabled = true;
        processBtn.disabled = true;
        logMessage('Vui lòng kích hoạt phần mềm trước khi sử dụng');
    }
}

function logMessage(message) {
    const logArea = document.getElementById('logArea');
    const timestamp = new Date().toLocaleTimeString();
    logArea.innerHTML += `<div>[${timestamp}] ${message}</div>`;
    logArea.scrollTop = logArea.scrollHeight;
}

function updateProgress(percent, message) {
    const progressBar = document.getElementById('progressBar');
    const statusText = document.getElementById('statusText');
    
    progressBar.style.width = percent + '%';
    progressBar.textContent = percent + '%';
    progressBar.setAttribute('aria-valuenow', percent);
    
    if (message) {
        statusText.textContent = message;
        logMessage(message);
    }
}

// Hàm kiểm tra và khôi phục kết quả từ localStorage
function checkForSavedResults() {
    try {
        const savedResultId = localStorage.getItem('lastResultId');
        const savedImageCount = localStorage.getItem('lastImageCount');
        const savedResultText = localStorage.getItem('lastResultText');
        
        if (savedResultId && savedResultText) {
            logMessage('Đang khôi phục kết quả OCR từ phiên trước...');
            
            // Khôi phục kết quả
            window.resultId = savedResultId;
            window.imageCount = parseInt(savedImageCount || '0');
            
            // Hiển thị kết quả
            document.getElementById('resultContainer').style.display = 'block';
            document.getElementById('resultText').value = savedResultText;
            
            // Kích hoạt nút xuất Word và xem hình ảnh
            document.getElementById('btnExport').disabled = false;
            
            if (window.imageCount > 0) {
                document.getElementById('btnViewImages').disabled = false;
                logMessage(`Khôi phục thành công với ${window.imageCount} hình ảnh`);
            } else {
                document.getElementById('btnViewImages').disabled = true;
                logMessage('Khôi phục thành công nhưng không có hình ảnh');
            }
            
            return true;
        }
    } catch (e) {
        logMessage('Không thể khôi phục kết quả trước đó: ' + e.message);
    }
    
    return false;
}

// Cập nhật thông tin file dựa trên tùy chọn sửa lỗi chính tả
function updateFileInfo(file) {
    const fileInfo = document.getElementById('fileInfo');
    const spellingCorrection = document.getElementById('spellingCorrection').checked;
    
    if (file.type !== 'application/pdf') {
        fileInfo.textContent = 'Vui lòng chọn file PDF';
        return;
    }
    
    const pageLimit = spellingCorrection ? 30 : 100;
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    fileInfo.textContent = `Đã chọn: ${file.name} (${fileSizeMB} MB, giới hạn ${pageLimit} trang${spellingCorrection ? ' khi bật sửa lỗi chính tả' : ''})`;
    
    logMessage(`File đã chọn: ${file.name} (${fileSizeMB} MB, giới hạn ${pageLimit} trang${spellingCorrection ? ' khi bật sửa lỗi chính tả' : ''})`);
}

async function processOCR(formData) {
    try {
        updateProgress(10, 'Đang tải file lên...');
        
        // Thêm Gemini API key và tùy chọn sửa lỗi chính tả vào formData
        const geminiApiKey = document.getElementById('geminiApiKey').value;
        const spellingCorrection = document.getElementById('spellingCorrection').checked;
        
        formData.append('gemini_api_key', geminiApiKey);
        formData.append('spelling_correction', spellingCorrection);
        
        if (spellingCorrection && geminiApiKey) {
            logMessage('Đã bật tính năng sửa lỗi chính tả với Gemini API');
        } else if (spellingCorrection && !geminiApiKey) {
            logMessage('Cảnh báo: Đã bật tính năng sửa lỗi chính tả nhưng chưa nhập Gemini API Key');
        }
        
        updateProgress(20, 'Đang xử lý OCR...');
        
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            updateProgress(100, 'Xử lý OCR hoàn tất thành công');
            
            // Hiển thị kết quả
            document.getElementById('resultContainer').style.display = 'block';
            document.getElementById('resultText').value = result.text;
            
            // Lưu kết quả ID để tải hình ảnh sau này
            window.resultId = result.result_id;
            window.imageCount = result.image_count;
            
            // Lưu vào localStorage để phòng trường hợp trang được làm mới
            try {
                localStorage.setItem('lastResultId', result.result_id);
                localStorage.setItem('lastImageCount', result.image_count);
                localStorage.setItem('lastResultText', result.text);
                logMessage('Đã lưu kết quả vào bộ nhớ cục bộ');
            } catch (e) {
                logMessage('Không thể lưu kết quả vào bộ nhớ cục bộ: ' + e.message);
            }
            
            // Kích hoạt nút xuất và xem hình ảnh
            document.getElementById('btnExport').disabled = false;
            
            if (result.image_count > 0) {
                document.getElementById('btnViewImages').disabled = false;
                logMessage(`Tìm thấy ${result.image_count} hình ảnh trong kết quả OCR`);
            } else {
                document.getElementById('btnViewImages').disabled = true;
                logMessage("Không tìm thấy hình ảnh trong kết quả OCR");
            }
            
        } else {
            updateProgress(0, 'Lỗi: ' + result.error);
        }
    } catch (error) {
        updateProgress(0, 'Lỗi xử lý: ' + error);
    }
}

async function loadImages() {
    if (!window.resultId) {
        logMessage('Không có kết quả OCR để hiển thị hình ảnh');
        return;
    }
    
    try {
        // Hiển thị thông báo đang tải
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'text-center mb-4';
        loadingDiv.innerHTML = `
            <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Đang tải...</span>
            </div>
            <p>Đang tải hình ảnh...</p>
        `;
        
        const imagesContainer = document.getElementById('imagesContainer');
        imagesContainer.innerHTML = '';
        imagesContainer.appendChild(loadingDiv);
        
        logMessage('Đang tải thông tin hình ảnh từ kết quả OCR...');
        
        const response = await fetch(`/results/${window.resultId}`);
        const result = await response.json();
        
        if (result.success) {
            imagesContainer.innerHTML = '';
            
            if (result.image_count === 0) {
                imagesContainer.innerHTML = '<div class="text-center">Không có hình ảnh để hiển thị</div>';
                return;
            }
            
            logMessage(`Đã tìm thấy ${result.image_count} hình ảnh, đang tải...`);
            
            // Nếu API trả về danh sách ID hình ảnh
            const imageIds = result.image_ids || [];
            
            if (imageIds.length > 0) {
                // Hiển thị thông tin đang tải
                const progressDiv = document.createElement('div');
                progressDiv.className = 'progress mb-4';
                progressDiv.innerHTML = `
                    <div class="progress-bar progress-bar-striped progress-bar-animated" 
                         id="imageLoadProgress" role="progressbar" 
                         style="width: 0%" 
                         aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">0%</div>
                `;
                imagesContainer.appendChild(progressDiv);
                
                const progressBar = document.getElementById('imageLoadProgress');
                
                // Tải từng hình ảnh theo ID
                for (let i = 0; i < imageIds.length; i++) {
                    const imageId = imageIds[i];
                    try {
                        const imageResponse = await fetch(`/images/${window.resultId}/${imageId}`);
                        
                        if (imageResponse.ok) {
                            const blob = await imageResponse.blob();
                            const imageUrl = URL.createObjectURL(blob);
                            
                            const imageDiv = document.createElement('div');
                            imageDiv.className = 'mb-4';
                            imageDiv.innerHTML = `
                                <h5 class="text-primary">Hình ảnh: ${imageId}</h5>
                                <div class="text-center">
                                    <img src="${imageUrl}" class="img-fluid mb-2" alt="${imageId}">
                                </div>
                            `;
                            
                            imagesContainer.appendChild(imageDiv);
                            
                            // Cập nhật tiến trình
                            const percent = Math.round(((i + 1) / imageIds.length) * 100);
                            progressBar.style.width = `${percent}%`;
                            progressBar.textContent = `${percent}%`;
                            progressBar.setAttribute('aria-valuenow', percent);
                        } else {
                            const errorDiv = document.createElement('div');
                            errorDiv.className = 'alert alert-warning mb-4';
                            errorDiv.textContent = `Không thể tải hình ảnh: ${imageId}`;
                            imagesContainer.appendChild(errorDiv);
                        }
                    } catch (e) {
                        logMessage(`Lỗi khi tải hình ảnh ${imageId}: ${e.message}`);
                    }
                }
                
                // Xóa thanh tiến trình sau khi tải xong
                imagesContainer.removeChild(progressDiv);
                
            } else {
                // Cách cũ - Thử tải hình ảnh theo thứ tự
                logMessage('Không có danh sách ID cụ thể, thử tải theo thứ tự');
                
                for (let i = 1; i <= result.image_count; i++) {
                    const imageId = `img-${i}.jpeg`;
                    try {
                        const imageResponse = await fetch(`/images/${window.resultId}/${imageId}`);
                        
                        if (imageResponse.ok) {
                            const blob = await imageResponse.blob();
                            const imageUrl = URL.createObjectURL(blob);
                            
                            const imageDiv = document.createElement('div');
                            imageDiv.className = 'mb-4';
                            imageDiv.innerHTML = `
                                <h5 class="text-primary">Hình ảnh: ${imageId}</h5>
                                <div class="text-center">
                                    <img src="${imageUrl}" class="img-fluid mb-2" alt="${imageId}">
                                </div>
                            `;
                            
                            imagesContainer.appendChild(imageDiv);
                        } else {
                            const errorDiv = document.createElement('div');
                            errorDiv.className = 'alert alert-warning mb-4';
                            errorDiv.textContent = `Không thể tải hình ảnh: ${imageId}`;
                            imagesContainer.appendChild(errorDiv);
                        }
                    } catch (e) {
                        logMessage(`Lỗi khi tải hình ảnh ${imageId}: ${e.message}`);
                    }
                }
            }
            
            if (imagesContainer.children.length === 0) {
                imagesContainer.innerHTML = '<div class="alert alert-danger">Không thể tải hình ảnh nào</div>';
            }
            
        } else {
            imagesContainer.innerHTML = `<div class="alert alert-danger">Lỗi khi tải hình ảnh: ${result.error}</div>`;
            logMessage('Lỗi khi tải hình ảnh: ' + result.error);
        }
    } catch (error) {
        document.getElementById('imagesContainer').innerHTML = `<div class="alert alert-danger">Lỗi khi tải hình ảnh: ${error.message}</div>`;
        logMessage('Lỗi khi tải hình ảnh: ' + error.message);
    }
}

// Hàm xử lý xuất file
function exportFile(exportType) {
    if (!window.resultId) {
        logMessage(`Không có kết quả OCR để xuất ${exportType}`);
        return;
    }
    
    // Hiển thị thông báo đang xử lý
    let exportDescription = '';
    switch(exportType) {
        case 'word-equation':
            exportDescription = 'Word với công thức toán học';
            updateProgress(30, `Đang chuẩn bị xuất ${exportDescription}...`);
            break;
        case 'word-image':
            exportDescription = 'Word với hình ảnh';
            updateProgress(30, `Đang chuẩn bị xuất ${exportDescription}...`);
            break;
        case 'zip':
            exportDescription = 'file ZIP đầy đủ';
            updateProgress(30, `Đang chuẩn bị xuất ${exportDescription}...`);
            break;
    }
    
    // Hiển thị modal thông báo đang xử lý
    const processingModalDiv = document.createElement('div');
    processingModalDiv.className = 'modal fade show';
    processingModalDiv.id = 'processingModal';
    processingModalDiv.style.display = 'block';
    processingModalDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    processingModalDiv.setAttribute('tabindex', '-1');
    
    let processingTitle = '';
    let processingDescription = '';
    let processingIcon = '';
    
    switch(exportType) {
        case 'word-equation':
            processingTitle = 'Đang xuất Word với công thức toán học';
            processingDescription = 'Hệ thống đang chuyển đổi công thức LaTeX thành equation Word.';
            processingIcon = '<i class="bi bi-calculator text-primary mb-3" style="font-size: 2rem;"></i>';
            break;
        case 'word-image':
            processingTitle = 'Đang xuất Word với hình ảnh';
            processingDescription = 'Hệ thống đang chèn hình ảnh vào tài liệu Word.';
            processingIcon = '<i class="bi bi-file-earmark-image text-primary mb-3" style="font-size: 2rem;"></i>';
            break;
        case 'zip':
            processingTitle = 'Đang xuất file ZIP';
            processingDescription = 'Hệ thống đang đóng gói tất cả dữ liệu vào file ZIP.';
            processingIcon = '<i class="bi bi-file-earmark-zip text-primary mb-3" style="font-size: 2rem;"></i>';
            break;
    }
    
    processingModalDiv.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-body text-center">
                    ${processingIcon ? processingIcon : '<div class="spinner-border text-primary mb-3" role="status"><span class="visually-hidden">Đang xử lý...</span></div>'}
                    <h5>${processingTitle}</h5>
                    <p>${processingDescription}</p>
                    <div id="exportTimer" class="text-muted mt-2">0:00</div>
                    <div class="progress mt-3">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" 
                             style="width: 100%"></div>
                    </div>
                    <p class="small text-muted mt-2">
                        Quá trình này có thể mất một lúc, vui lòng đợi.
                    </p>
                    <button id="cancelExport" class="btn btn-sm btn-outline-secondary mt-2">Hủy</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(processingModalDiv);
    
    // Bắt đầu đếm thời gian
    let seconds = 0;
    const timerElement = document.getElementById('exportTimer');
    const timerInterval = setInterval(() => {
        seconds++;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        timerElement.textContent = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }, 1000);
    
    // Xử lý sự kiện hủy
    document.getElementById('cancelExport').addEventListener('click', function() {
        clearInterval(timerInterval);
        document.body.removeChild(processingModalDiv);
        updateProgress(0, 'Đã hủy xuất file');
        logMessage(`Đã hủy quá trình xuất ${exportDescription}`);
        
        if (window.downloadFrame) {
            try {
                document.body.removeChild(window.downloadFrame);
                window.downloadFrame = null;
            } catch (e) {
                console.error('Lỗi khi xóa frame:', e);
            }
        }
    });
    
    // Tạo URL để tải về file - Thêm tham số type để backend biết cần xuất loại file nào
    const exportUrl = `/export/word/${window.resultId}?type=${exportType}`;
    
    // Tạo một iframe ẩn để tải file
    const downloadFrame = document.createElement('iframe');
    downloadFrame.style.display = 'none';
    window.downloadFrame = downloadFrame;
    document.body.appendChild(downloadFrame);
    
    // Thiết lập timeout (2 phút)
    const exportTimeout = setTimeout(() => {
        clearInterval(timerInterval);
        if (document.body.contains(processingModalDiv)) {
            document.body.removeChild(processingModalDiv);
        }
        if (document.body.contains(downloadFrame)) {
            document.body.removeChild(downloadFrame);
        }
        window.downloadFrame = null;
        
        updateProgress(0, 'Xuất file thất bại: Quá thời gian chờ');
        logMessage('Quá trình xuất đã quá thời gian chờ (120 giây). Vui lòng thử lại sau.');
        
    }, 120000); // 120 giây timeout (2 phút)
    
    // Theo dõi khi tải xong
    downloadFrame.onload = function() {
        clearTimeout(exportTimeout);
        clearInterval(timerInterval);
        
        try {
            const frameContent = downloadFrame.contentDocument || downloadFrame.contentWindow.document;
            const contentType = frameContent.contentType || '';
            
            if (frameContent && frameContent.body && frameContent.body.textContent) {
                const responseText = frameContent.body.textContent;
                
                // Kiểm tra lỗi JSON
                if (responseText.includes('"success":false') || responseText.includes('error')) {
                    try {
                        const errorData = JSON.parse(responseText);
                        throw new Error(errorData.error || 'Lỗi khi xử lý');
                    } catch (e) {
                        if (e instanceof SyntaxError) {
                            // Không phải JSON - có thể là file đã tải về
                            handleSuccessfulDownload(contentType, exportType);
                        } else {
                            // Lỗi thực sự
                            updateProgress(0, `Lỗi: ${e.message}`);
                            logMessage(`Lỗi khi xuất ${exportDescription}: ${e.message}`);
                        }
                    }
                } else {
                    // Thành công
                    handleSuccessfulDownload(contentType, exportType);
                }
            } else {
                // File đã tải về (không đọc được nội dung)
                handleSuccessfulDownload(contentType, exportType);
            }
        } catch (e) {
            // Lỗi cross-origin thường xảy ra khi file được tải về thành công
            handleSuccessfulDownload('', exportType);
        }
        
        // Dọn dẹp
        if (document.body.contains(processingModalDiv)) {
            document.body.removeChild(processingModalDiv);
        }
        
        setTimeout(() => {
            if (document.body.contains(downloadFrame)) {
                document.body.removeChild(downloadFrame);
                window.downloadFrame = null;
            }
        }, 1000);
    };
    
    // Xử lý lỗi
    downloadFrame.onerror = function() {
        clearTimeout(exportTimeout);
        clearInterval(timerInterval);
        
        updateProgress(0, 'Lỗi khi tải xuống file');
        logMessage(`Lỗi khi tải xuống ${exportDescription}`);
        
        if (document.body.contains(processingModalDiv)) {
            document.body.removeChild(processingModalDiv);
        }
        if (document.body.contains(downloadFrame)) {
            document.body.removeChild(downloadFrame);
        }
        window.downloadFrame = null;
    };
    
    // Hàm xử lý khi tải file thành công
    function handleSuccessfulDownload(contentType, exportType) {
        let successMessage = '';
        
        // Luôn nhận được file ZIP từ backend mới
        successMessage = `Đã xuất ${exportDescription} thành công`;
        
        // Nếu yêu cầu là word-equation hoặc word-image, hiển thị thông báo bổ sung
        if (exportType === 'word-equation' || exportType === 'word-image') {
            showZipInfoModal(exportType);
        }
        
        updateProgress(100, successMessage);
        logMessage(successMessage);
    }
    
    // Hiển thị modal thông tin về file ZIP khi xuất Word
    function showZipInfoModal(exportType) {
        let modalTitle = 'Thông tin về file ZIP đã tải về';
        let modalBody = '';
        
        if (exportType === 'word-equation') {
            modalBody = `
                <div class="alert alert-info">
                    <i class="bi bi-info-circle me-2"></i>
                    Hệ thống đã tạo file ZIP chứa Word với công thức toán học.
                </div>
                <p>File ZIP bao gồm:</p>
                <ul>
                    <li><strong>ocr_result_*.docx</strong> - File Word đã tạo</li>
                    <li><strong>content.md</strong> - Nội dung định dạng Markdown</li>
                </ul>
                <p>Hãy giải nén file ZIP để xem nội dung.</p>
            `;
        } else if (exportType === 'word-image') {
            modalBody = `
                <div class="alert alert-info">
                    <i class="bi bi-info-circle me-2"></i>
                    Hệ thống đã tạo file Word với hình ảnh được chèn vào đúng vị trí.
                </div>
                <p>File ZIP bao gồm:</p>
                <ul>
                    <li><strong>ocr_result_*.docx</strong> - File Word đã tạo với hình ảnh nhúng trực tiếp</li>
                </ul>
                <p>Hình ảnh đã được nhúng trực tiếp vào file Word mà không cần thư mục riêng.</p>
            `;
        }
        
        const modalHtml = `
            <div class="modal fade" id="zipInfoModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${modalTitle}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            ${modalBody}
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Đã hiểu</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = modalHtml;
        document.body.appendChild(tempDiv.firstElementChild);
        
        const zipInfoModal = new bootstrap.Modal(document.getElementById('zipInfoModal'));
        zipInfoModal.show();
        
        document.getElementById('zipInfoModal').addEventListener('hidden.bs.modal', function() {
            document.body.removeChild(this);
        });
    }
    
    // Bắt đầu tải xuống
    downloadFrame.src = exportUrl;
    updateProgress(50, `Đang xử lý ${exportDescription}...`);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    generateHardwareId();
    
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('pdfFile');
    const processBtn = document.getElementById('processBtn');
    const fileInfo = document.getElementById('fileInfo');
    const btnViewImages = document.getElementById('btnViewImages');
    const imagesModal = new bootstrap.Modal(document.getElementById('imagesModal'));
    
    // Kiểm tra xem có kết quả được lưu từ trước không
    const hasRestoredResults = checkForSavedResults();
    if (hasRestoredResults) {
        logMessage('Đã khôi phục kết quả OCR từ phiên trước');
    }
    
    // Xử lý nút hiển thị/ẩn Gemini API key
    document.getElementById('toggleGeminiKey').addEventListener('click', function() {
        const geminiInput = document.getElementById('geminiApiKey');
        if (geminiInput.type === 'password') {
            geminiInput.type = 'text';
            this.innerHTML = '<i class="bi bi-eye-slash"></i>';
        } else {
            geminiInput.type = 'password';
            this.innerHTML = '<i class="bi bi-eye"></i>';
        }
    });

    // Xử lý checkbox sửa lỗi chính tả
    document.getElementById('spellingCorrection').addEventListener('change', function() {
        const fileInput = document.getElementById('pdfFile');
        if (fileInput.files && fileInput.files[0]) {
            updateFileInfo(fileInput.files[0]);
        }
    });
    
    fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            const file = this.files[0];
            updateFileInfo(file);
            processBtn.disabled = false;
        } else {
            fileInfo.textContent = 'Chưa chọn file nào';
            processBtn.disabled = true;
        }
    });
    
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (!fileInput.files || !fileInput.files[0]) {
            logMessage('Vui lòng chọn file PDF trước');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('hardware_id', document.getElementById('hardwareId').value);
        
        // Thêm Gemini API key và tính năng sửa lỗi chính tả
        const geminiApiKey = document.getElementById('geminiApiKey').value;
        const spellingCorrection = document.getElementById('spellingCorrection').checked;
        formData.append('gemini_api_key', geminiApiKey);
        formData.append('spelling_correction', spellingCorrection);
        
        if (spellingCorrection && !geminiApiKey) {
            logMessage('Cảnh báo: Đã bật tính năng sửa lỗi chính tả nhưng chưa nhập Gemini API Key');
        }
        
        processBtn.disabled = true;
        updateProgress(0, 'Đang bắt đầu xử lý OCR...');
        
        processOCR(formData).finally(() => {
            processBtn.disabled = false;
        });
    });
    
    btnViewImages.addEventListener('click', function() {
        loadImages().then(() => {
            imagesModal.show();
        });
    });
    
    // Thêm event listener cho imagesModal để làm mới hình ảnh khi mở lại
    document.getElementById('imagesModal').addEventListener('show.bs.modal', function() {
        loadImages();
    });
    
    // Thêm event listener cho các nút xuất file
    document.getElementById('btnExportWordEquation').addEventListener('click', function() {
        exportFile('word-equation');
    });
    
    document.getElementById('btnExportWordImage').addEventListener('click', function() {
        exportFile('word-image');
    });
    
    document.getElementById('btnExportZip').addEventListener('click', function() {
        exportFile('zip');
    });
});
