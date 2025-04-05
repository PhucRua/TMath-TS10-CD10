import os
import re
import time
import json
import hashlib
import logging
import tempfile
import subprocess
import concurrent.futures
from io import BytesIO
from flask import Flask, render_template, request, jsonify, session, send_file
from werkzeug.utils import secure_filename
import google.generativeai as genai
from PyPDF2 import PdfReader, PdfWriter
import requests
import shutil

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
    
    # Get API key from form data
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
                
            # Process PDF with Gemini OCR
            if not gemini_api_key:
                return jsonify({'success': False, 'error': 'Vui lòng cung cấp Gemini API key'}), 400
                
            try:
                # Configure Gemini API
                genai.configure(api_key=gemini_api_key)
                
                # Get appropriate model
                model_name = get_model_name()
                generation_config = {
                    "temperature": 0.1,
                    "top_p": 0.95,
                    "top_k": 40,
                    "max_output_tokens": 65536,
                }
                model = genai.GenerativeModel(model_name=model_name, generation_config=generation_config)
                
                # Upload file to Gemini
                uploaded_file = genai.upload_file(file_path)
                
                # Generate OCR prompt
                prompt = """
                Hãy nhận diện và gõ lại [CHÍNH XÁC] PDF thành văn bản, tất cả công thức Toán Latex, bọc trong dấu $
                [TUYỆT ĐỐI] không thêm nội dung khác ngoài nội dung PDF, [CHỈ ĐƯỢC PHÉP] gõ lại nội dung PDF thành văn bản.
                """
                
                # Generate content
                response = model.generate_content([uploaded_file, prompt])
                ocr_text = response.text
                
                # Apply spelling correction if requested
                if spelling_correction:
                    app.logger.info("Đang sửa lỗi chính tả với Gemini API...")
                    corrected_text = call_gemini_api(ocr_text, gemini_api_key)
                    
                    if not corrected_text.startswith("Lỗi:"):
                        app.logger.info("Sửa lỗi chính tả thành công")
                        ocr_text = corrected_text
                    else:
                        app.logger.error(f"Lỗi khi sửa lỗi chính tả: {corrected_text}")
                
                # Process equations and formulas
                ocr_text = process_equations(ocr_text)
                
                # Create OCR result object
                ocr_result = {
                    "text": ocr_text,
                    "images": {}  # Empty for now, as we don't extract images with Gemini
                }
                
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
                app.logger.error(f"Lỗi khi xử lý với Gemini OCR: {str(e)}")
                return jsonify({'success': False, 'error': f'Lỗi khi xử lý với Gemini OCR: {str(e)}'}), 500
                
        except Exception as e:
            app.logger.error(f"Lỗi khi xử lý file PDF: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500
        finally:
            # Clean up temporary file
            if os.path.exists(file_path):
                os.remove(file_path)
    
    return jsonify({'success': False, 'error': 'Loại file không được hỗ trợ, chỉ chấp nhận PDF'}), 400

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

def process_equations(text):
    """Xử lý và chuẩn hóa công thức toán học trong văn bản"""
    processed_text = text
    
    # Phát hiện và chuẩn hóa các công thức LaTeX inline
    inline_patterns = [
        (r'\$([^$]+?)\$', r'$\1$'),              # $công_thức$
        (r'\\[(]([^)]+?)\\[)]', r'$\1$'),        # \(công_thức\)
        (r'`\$([^$]+?)\$`', r'$\1$'),            # `$công_thức$`
        (r'`\\[(]([^)]+?)\\[)]`', r'$\1$')       # `\(công_thức\)`
    ]
    
    for pattern, replacement in inline_patterns:
        processed_text = re.sub(pattern, replacement, processed_text)
    
    # Phát hiện và chuẩn hóa các công thức LaTeX block
    simple_block_patterns = [
        (r'\$\$([^$]+?)\$\$', r'$$\1$$'),        # $$công_thức$$
        (r'\\[\[]([^]]+?)\\[\]]', r'$$\1$$')     # \[công_thức\]
    ]
    
    for pattern, replacement in simple_block_patterns:
        processed_text = re.sub(pattern, replacement, processed_text)
    
    # Xử lý các mẫu cần flags đặc biệt
    processed_text = re.sub(r'```math\n(.*?)\n```', r'$$\1$$', processed_text, flags=re.DOTALL)  # ```math ... ```
    processed_text = re.sub(r'```latex\n(.*?)\n```', r'$$\1$$', processed_text, flags=re.DOTALL)  # ```latex ... ```
    
    return processed_text

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
        
        # Create a placeholder image since we don't have actual images from Gemini
        placeholder_img = BytesIO()
        placeholder_img.write(b"Placeholder image")  # Just a placeholder
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
