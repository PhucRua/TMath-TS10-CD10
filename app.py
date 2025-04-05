import os
import re
import time
import json
import base64
import hashlib
import logging
import shutil
import tempfile
import subprocess
from io import BytesIO
from flask import Flask, render_template, request, jsonify, session, send_file
from werkzeug.utils import secure_filename
import concurrent.futures
import google.generativeai as genai
from PyPDF2 import PdfReader, PdfWriter
import requests

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'p_convert_2025_secret_key')
app.config['UPLOAD_FOLDER'] = tempfile.gettempdir()
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max upload size

# Configure logging
logging.basicConfig(level=logging.INFO)

# Thread pool for concurrent processing
executor = concurrent.futures.ThreadPoolExecutor(max_workers=5)

# Create upload folder if it doesn't exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

@app.route('/')
def index():
    """Render the main application page"""
    return render_template('index.html')

@app.route('/api/set-api-key', methods=['POST'])
def set_api_key():
    """Set the Google Generative AI API key"""
    data = request.json
    api_key = data.get('api_key')
    
    if not api_key:
        return jsonify({'success': False, 'message': 'API key is required'}), 400
    
    try:
        # Configure the Gemini API with the provided key
        genai.configure(api_key=api_key)
        
        # Store the API key in the session for subsequent requests
        session['api_key'] = api_key
        
        # Try to get the model to verify the API key works
        model_name = get_model_name()
        
        return jsonify({'success': True, 'message': 'API key set successfully', 'model': model_name})
    except Exception as e:
        app.logger.error(f"Error setting API key: {str(e)}")
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

def get_model_name():
    """Get the model name from GitHub or use default"""
    try:
        model_url = "https://raw.githubusercontent.com/thayphuctoan/pconvert/refs/heads/main/p_convert_model_2025"
        response = requests.get(model_url, timeout=(10, 30))
        
        if response.status_code == 200:
            return response.text.strip()
        
        # Fallback model name
        return "gemini-1.5-pro-latest"
    except Exception as e:
        app.logger.error(f"Error getting model name: {str(e)}")
        return "gemini-1.5-pro-latest"

@app.route('/api/hardware-id', methods=['POST'])
def get_hardware_id():
    """API để tạo hardware ID từ thông tin gửi lên"""
    data = request.json
    if not data or not all(k in data for k in ('cpu_id', 'bios_serial', 'motherboard_serial')):
        return jsonify({'success': False, 'error': 'Thiếu thông tin phần cứng'}), 400
    
    combined_info = f"{data['cpu_id']}|{data['bios_serial']}|{data['motherboard_serial']}"
    hardware_id = hashlib.md5(combined_info.encode()).hexdigest().upper()
    formatted_id = '-'.join([hardware_id[i:i+8] for i in range(0, len(hardware_id), 8)])
    formatted_id = formatted_id + "-Premium"
    
    return jsonify({
        'success': True,
        'hardware_id': formatted_id,
        'activated': check_activation(formatted_id)
    })

def check_activation(hardware_id):
    """Kiểm tra xem hardware ID có được kích hoạt không"""
    try:
        url = "https://raw.githubusercontent.com/thayphuctoan/pconvert/refs/heads/main/convert-special-1"
        response = requests.get(url, timeout=(10, 30))
        
        if response.status_code == 200:
            valid_ids = response.text.strip().split('\n')
            if hardware_id in valid_ids:
                return True
        return False
    except Exception as e:
        app.logger.error(f"Lỗi khi kiểm tra kích hoạt: {str(e)}")
        return False

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload and OCR processing"""
    # Check for hardware ID and activation
    hardware_id = request.form.get('hardware_id')
    if not hardware_id or not check_activation(hardware_id):
        return jsonify({
            'success': False, 
            'error': 'Phần mềm chưa được kích hoạt hoặc Hardware ID không hợp lệ.'
        }), 403
    
    # Get spelling correction options
    gemini_api_key = request.form.get('gemini_api_key', '')
    spelling_correction = request.form.get('spelling_correction') == 'true'
    
    # Check if file was uploaded
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'Không có file nào được tải lên'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'Chưa chọn file'}), 400
    
    if file and file.filename.lower().endswith('.pdf'):
        # Save file temporarily
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        try:
            # Check PDF page count
            pdf = PdfReader(file_path)
            total_pages = len(pdf.pages)
            
            # Page limit based on spelling correction feature
            page_limit = 30 if spelling_correction else 100
            
            if total_pages > page_limit:
                os.remove(file_path)
                return jsonify({
                    'success': False, 
                    'error': f'File có {total_pages} trang, vượt quá giới hạn {page_limit} trang{"" if not spelling_correction else " khi bật tính năng sửa lỗi chính tả"}.'
                }), 400
            elif total_pages <= 0:
                os.remove(file_path)
                return jsonify({
                    'success': False, 
                    'error': 'Không thể đọc file PDF, vui lòng kiểm tra lại.'
                }), 400
                
            # Process PDF with OCR
            ocr_result = process_ocr(file_path)
            
            # Apply spelling correction if requested
            if spelling_correction and gemini_api_key:
                app.logger.info("Đang sửa lỗi chính tả với Gemini API...")
                original_text = ocr_result["text"]
                corrected_text = call_gemini_api(original_text, gemini_api_key)
                
                if not corrected_text.startswith("Lỗi:"):
                    app.logger.info("Sửa lỗi chính tả thành công")
                    ocr_result["text"] = corrected_text
                else:
                    app.logger.error(f"Lỗi khi sửa lỗi chính tả: {corrected_text}")
            
            # Create unique ID for this result
            timestamp = int(time.time())
            clean_filename = os.path.splitext(filename)[0].replace(" ", "_")
            result_id = f"result_{clean_filename}_{timestamp}.json"
            
            # Save result to a temporary file
            result_path = os.path.join(app.config['UPLOAD_FOLDER'], result_id)
            with open(result_path, 'w', encoding='utf-8') as f:
                json.dump(ocr_result, f, ensure_ascii=False)
            
            return jsonify({
                'success': True,
                'filename': filename,
                'page_count': total_pages,
                'text': ocr_result['text'],
                'image_count': len(ocr_result.get('images', {})),
                'result_id': result_id
            })
            
        except Exception as e:
            app.logger.error(f"Lỗi khi xử lý OCR: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500
        finally:
            # Clean up temporary file
            if os.path.exists(file_path):
                os.remove(file_path)
    
    return jsonify({'success': False, 'error': 'Loại file không được hỗ trợ, chỉ chấp nhận PDF'}), 400

def process_ocr(file_path):
    """Process OCR on a PDF file"""
    # This is a simplified version - in actual implementation, you would use
    # the OCR service of your choice (e.g., Google Cloud Vision, Azure OCR, etc.)
    
    try:
        app.logger.info(f"Xử lý OCR cho file: {file_path}")
        
        # Initialize OCR results
        ocr_result = {
            "text": "",
            "images": {}
        }
        
        # Configure the Gemini API
        if 'api_key' in session and session['api_key']:
            genai.configure(api_key=session['api_key'])
            
            # Get model
            model_name = get_model_name()
            generation_config = {
                "temperature": 0.1,
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 65536,
            }
            model = genai.GenerativeModel(model_name=model_name, generation_config=generation_config)
            
            # Execute OCR with Gemini
            uploaded_file = genai.upload_file(file_path)
            prompt = """
            Nhận diện văn bản trong file PDF này, bao gồm cả công thức toán học. 
            Hãy cấu trúc công thức toán học trong dấu $ (inline) hoặc $$ (block).
            Giữ nguyên định dạng và bố cục càng nhiều càng tốt.
            Đối với các hình ảnh, hãy chỉ ra vị trí của chúng bằng [HÌNH].
            """
            
            response = model.generate_content([uploaded_file, prompt])
            ocr_result["text"] = response.text
            
            # For demo purposes, add a sample image
            image_id = "sample_image_1"
            # This would be base64 data in a real implementation
            ocr_result["images"][image_id] = "dummy_base64_data"
            
            # Replace [HÌNH] with image references
            ocr_result["text"] = ocr_result["text"].replace("[HÌNH]", f"[HÌNH: {image_id}]")
            
            return ocr_result
        else:
            return {"text": "API key chưa được cấu hình", "images": {}}
    except Exception as e:
        app.logger.error(f"Lỗi trong quá trình OCR: {str(e)}")
        raise

def call_gemini_api(original_text, gemini_key):
    """
    Gọi Gemini API để hiệu đính lỗi chính tả và ngữ pháp tiếng Việt.
    """
    try:
        if not gemini_key:
            return "Lỗi: Chưa có Gemini API Key"
        
        GEMINI_API_URL = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-2.0-flash:generateContent?key=" + gemini_key
        )
        
        prompt = (
            "Please help me correct Vietnamese spelling and grammar in the following text. "
            "IMPORTANT: Do not change any image paths, LaTeX formulas, or Vietnamese diacritical marks. "
            "Return only the corrected text with the same structure and markdown formatting:\n\n"
            f"{original_text}"
        )
        
        payload = {
            "contents": [{
                "parts": [{
                    "text": prompt
                }]
            }],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 8192,
            }
        }
        
        headers = {"Content-Type": "application/json"}
        resp = requests.post(GEMINI_API_URL, json=payload, headers=headers, timeout=(30, 300))
        
        if resp.status_code == 200:
            data = resp.json()
            if "candidates" in data and len(data["candidates"]) > 0:
                candidate = data["candidates"][0]
                if "content" in candidate and "parts" in candidate["content"]:
                    corrected_text = candidate["content"]["parts"][0].get("text", "")
                    if corrected_text.strip():
                        return corrected_text
            return "Lỗi: Không thể trích xuất được kết quả từ Gemini API."
        else:
            return f"Lỗi: Gemini API - HTTP {resp.status_code} - {resp.text}"
    except Exception as e:
        return f"Lỗi: Gọi Gemini API thất bại: {str(e)}"

@app.route('/results/<result_id>', methods=['GET'])
def get_result(result_id):
    """Get saved OCR results"""
    result_path = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(result_id))
    
    app.logger.info(f"Đang tìm kết quả: {result_path}")
    
    if not os.path.exists(result_path):
        app.logger.error(f"Không tìm thấy kết quả tại đường dẫn: {result_path}")
        return jsonify({'success': False, 'error': 'Không tìm thấy kết quả'}), 404
    
    try:
        with open(result_path, 'r', encoding='utf-8') as f:
            result = json.load(f)
        
        return jsonify({
            'success': True,
            'text': result['text'],
            'image_count': len(result.get('images', {})),
            'image_ids': list(result.get('images', {}).keys())
        })
    except Exception as e:
        app.logger.error(f"Lỗi khi đọc kết quả: {str(e)}")
        return jsonify({'success': False, 'error': f'Lỗi khi đọc kết quả: {str(e)}'}), 500

@app.route('/images/<result_id>/<image_id>', methods=['GET'])
def get_image(result_id, image_id):
    """Get image from OCR results"""
    result_path = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(result_id))
    
    app.logger.info(f"Đang tìm kết quả để lấy hình ảnh: {result_path}, hình ảnh: {image_id}")
    
    if not os.path.exists(result_path):
        app.logger.error(f"Không tìm thấy kết quả tại đường dẫn: {result_path}")
        return jsonify({'success': False, 'error': 'Không tìm thấy kết quả'}), 404
    
    try:
        with open(result_path, 'r', encoding='utf-8') as f:
            result = json.load(f)
        
        if image_id not in result.get('images', {}):
            app.logger.error(f"Không tìm thấy hình ảnh {image_id} trong kết quả")
            return jsonify({'success': False, 'error': 'Không tìm thấy hình ảnh'}), 404
        
        # Get image data
        img_data = result['images'][image_id]
        if "," in img_data:
            img_data = img_data.split(",", 1)[1]
        
        # For demonstration, we'll return a placeholder image
        placeholder_img = BytesIO()
        placeholder_img.write(base64.b64decode(img_data))
        placeholder_img.seek(0)
        
        return send_file(placeholder_img, mimetype='image/jpeg')
    except Exception as e:
        app.logger.error(f"Lỗi khi xử lý hình ảnh: {str(e)}")
        return jsonify({'success': False, 'error': f'Lỗi khi xử lý hình ảnh: {str(e)}'}), 500

@app.route('/export/word/<result_id>', methods=['GET'])
def export_to_word(result_id):
    """Export OCR results to Word document"""
    export_type = request.args.get('type', 'word-image')  # Default: Word with images
    result_path = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(result_id))
    
    app.logger.info(f"Đang xuất file loại: {export_type} từ: {result_path}")
    
    if not os.path.exists(result_path):
        app.logger.error(f"Không tìm thấy kết quả tại đường dẫn: {result_path}")
        return jsonify({'success': False, 'error': 'Không tìm thấy kết quả'}), 404
    
    try:
        # Read OCR result
        with open(result_path, 'r', encoding='utf-8') as f:
            result = json.load(f)
        
        # Create temporary directory for export
        timestamp = int(time.time())
        export_dir_name = f"word_export_{timestamp}"
        export_path = os.path.join(app.config['UPLOAD_FOLDER'], export_dir_name)
        os.makedirs(export_path, exist_ok=True)
        
        # Process text for export
        markdown_content = result['text']
        
        # Process images if needed
        if export_type in ['word-image', 'zip']:
            images_dir = os.path.join(export_path, "images")
            os.makedirs(images_dir, exist_ok=True)
            
            # Save images to files
            for img_id, base64_data in result.get('images', {}).items():
                if "," in base64_data:
                    base64_data = base64_data.split(",", 1)[1]
                
                img_path = os.path.join(images_dir, f"{img_id}.jpg")
                with open(img_path, 'wb') as img_file:
                    img_file.write(base64.b64decode(base64_data))
        
        # Save markdown content
        markdown_path = os.path.join(export_path, "content.md")
        with open(markdown_path, 'w', encoding='utf-8') as md_file:
            md_file.write(markdown_content)
        
        # Convert to Word with pandoc
        docx_path = os.path.join(export_path, "ocr_result.docx")
        
        pandoc_command = [
            "pandoc",
            markdown_path,
            "-o", docx_path,
            "--from", "markdown",
            "--to", "docx",
            "--mathml"
        ]
        
        subprocess.run(pandoc_command, check=True)
        
        # Create ZIP file with results
        zip_filename = f"ocr_result_{timestamp}.zip"
        zip_path = os.path.join(app.config['UPLOAD_FOLDER'], zip_filename)
        
        # Create ZIP archive
        shutil.make_archive(
            os.path.splitext(zip_path)[0],
            'zip',
            app.config['UPLOAD_FOLDER'],
            export_dir_name
        )
        
        # Return ZIP file
        return send_file(
            zip_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=zip_filename
        )
    except Exception as e:
        app.logger.error(f"Lỗi khi xuất file Word: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        # Clean up temporary files
        try:
            if 'export_path' in locals() and os.path.exists(export_path):
                shutil.rmtree(export_path)
            
            if 'zip_path' in locals() and os.path.exists(zip_path):
                os.remove(zip_path)
        except Exception as cleanup_error:
            app.logger.error(f"Lỗi khi dọn dẹp file tạm: {str(cleanup_error)}")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
