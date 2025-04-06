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
        response = requests.get(url, timeout=(30, 180))
        
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
        response = requests.get(model_url, timeout=(30, 180))
        
        if response.status_code == 200:
            return response.text.strip()
        
        # Fallback model name
        return "gemini-2.5-pro-preview-03-25"
    except Exception as e:
        app.logger.error(f"Error getting model name: {str(e)}")
        return "gemini-2.5-pro-preview-03-25"

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload and processing"""
    # Check for hardware ID and activation
    hardware_id = request.form.get('hardware_id')
    if not hardware_id or not check_activation(hardware_id):
        return jsonify({
            'success': False, 
            'error': 'Phần mềm chưa được kích hoạt hoặc Hardware ID không hợp lệ.'
        }), 403
    
    # Check if API key is provided
    api_key = request.form.get('api_key')
    if not api_key:
        return jsonify({'success': False, 'error': 'API key is required'}), 400
    
    # Check if file was uploaded
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No selected file'}), 400
    
    if file and (file.filename.lower().endswith('.pdf') or file.filename.lower().endswith(('.jpg', '.jpeg', '.png'))):
        # Save the file temporarily
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        # Handle PDF file
        if file.filename.lower().endswith('.pdf'):
            # Check PDF size
            pdf = PdfReader(file_path)
            total_pages = len(pdf.pages)
            
            if total_pages > 20:
                # Split PDF and process in parts
                split_files = split_pdf(file_path, pdf, total_pages)
                
                # Record the split files in session for later use
                session['split_files'] = split_files
                session['api_key'] = api_key
                
                # Return split info
                return jsonify({
                    'success': True, 
                    'message': f'PDF split into {len(split_files)} parts',
                    'filename': filename,
                    'is_pdf': True,
                    'single_file': False,
                    'total_parts': len(split_files),
                    'total_pages': total_pages
                })
            else:
                try:
                    # Configure the Gemini API
                    genai.configure(api_key=api_key)
                    
                    # Upload file to Gemini
                    uploaded_file = genai.upload_file(file_path)
                    
                    # Get the appropriate prompt based on conversion type
                    prompt = get_prompt('text')
                    
                    # Get appropriate model
                    model_name = get_model_name()
                    generation_config = {
                        "temperature": 0.1,
                        "top_p": 0.95,
                        "top_k": 40,
                        "max_output_tokens": 65536,
                    }
                    model = genai.GenerativeModel(model_name=model_name, generation_config=generation_config)
                    
                    # Generate content
                    response = model.generate_content([uploaded_file, prompt])
                    result = process_formulas(response.text)
                    
                    # Create unique ID for this result
                    timestamp = int(time.time())
                    result_id = f"result_{os.path.splitext(filename)[0]}_{timestamp}.txt"
                    
                    # Save result to file
                    result_path = os.path.join(app.config['UPLOAD_FOLDER'], result_id)
                    with open(result_path, 'w', encoding='utf-8') as f:
                        f.write(result)
                    
                    return jsonify({
                        'success': True,
                        'message': 'Conversion completed successfully',
                        'result': result,
                        'result_id': result_id
                    })
                except Exception as e:
                    app.logger.error(f"Error during conversion: {str(e)}")
                    return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
        else:
            # Handle image file
            try:
                # Configure the Gemini API
                genai.configure(api_key=api_key)
                
                # Upload file to Gemini
                uploaded_file = genai.upload_file(file_path)
                
                # Get the appropriate prompt
                prompt = get_prompt('text')
                
                # Get appropriate model
                model_name = get_model_name()
                generation_config = {
                    "temperature": 0.1,
                    "top_p": 0.95,
                    "top_k": 40,
                    "max_output_tokens": 65536,
                }
                model = genai.GenerativeModel(model_name=model_name, generation_config=generation_config)
                
                # Generate content
                response = model.generate_content([uploaded_file, prompt])
                result = process_formulas(response.text)
                
                # Create unique ID for this result
                timestamp = int(time.time())
                result_id = f"result_{os.path.splitext(filename)[0]}_{timestamp}.txt"
                
                # Save result to file
                result_path = os.path.join(app.config['UPLOAD_FOLDER'], result_id)
                with open(result_path, 'w', encoding='utf-8') as f:
                    f.write(result)
                
                return jsonify({
                    'success': True,
                    'message': 'Conversion completed successfully',
                    'result': result,
                    'result_id': result_id
                })
            except Exception as e:
                app.logger.error(f"Error during conversion: {str(e)}")
                return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500
    else:
        return jsonify({'success': False, 'error': 'File type not supported'}), 400

def split_pdf(file_path, pdf, total_pages):
    """Split a PDF into multiple smaller PDFs"""
    chunk_size = 20
    num_chunks = (total_pages + chunk_size - 1) // chunk_size
    
    base_name = os.path.splitext(file_path)[0]
    split_files = []
    
    for i in range(num_chunks):
        start_page = i * chunk_size
        end_page = min((i + 1) * chunk_size, total_pages)
        
        output = PdfWriter()
        for page in range(start_page, end_page):
            output.add_page(pdf.pages[page])
        
        output_filename = f"{base_name}_part{i+1}.pdf"
        with open(output_filename, "wb") as output_stream:
            output.write(output_stream)
        
        split_files.append(output_filename)
    
    return split_files

@app.route('/api/convert', methods=['POST'])
def convert_file():
    """Convert a file to text or LaTeX/MCQ using Google Generative AI"""
    data = request.json
    conversion_type = data.get('type', 'text')  # 'text' or 'latex_mcq'
    api_key = data.get('api_key')
    
    if not api_key:
        return jsonify({'success': False, 'message': 'API key is required'}), 400
    
    # Check if we have split files or a single file
    if 'split_files' in session and session['split_files']:
        # Handle split files conversion
        # Start async processing
        future = executor.submit(
            process_split_files, 
            session['split_files'], 
            api_key,
            get_prompt(conversion_type), 
            conversion_type
        )
        
        # Store the future in session to check status later
        conversion_id = str(id(future))
        session['conversion_future'] = conversion_id
        
        return jsonify({
            'success': True,
            'message': 'Conversion started',
            'conversion_id': conversion_id,
            'total_parts': len(session['split_files'])
        })
    else:
        return jsonify({'success': False, 'message': 'No file to convert'}), 400

def process_split_files(split_files, api_key, prompt, conversion_type):
    """Process multiple PDF parts and combine the results"""
    results = {}
    
    # Configure the Gemini API
    genai.configure(api_key=api_key)
    
    # Get appropriate model
    model_name = get_model_name()
    generation_config = {
        "temperature": 0.1,
        "top_p": 0.95,
        "top_k": 40,
        "max_output_tokens": 65536,
    }
    model = genai.GenerativeModel(model_name=model_name, generation_config=generation_config)
    
    # Process each file sequentially
    for i, file_path in enumerate(split_files):
        try:
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    uploaded_file = genai.upload_file(file_path)
                    response = model.generate_content([uploaded_file, prompt])
                    results[i] = response.text
                    break
                except Exception as e:
                    if "429" in str(e) and attempt < max_retries - 1:
                        # Rate limit error, wait and retry
                        time.sleep(60)  # Wait 60 seconds before retry
                    else:
                        raise e
        except Exception as e:
            results[i] = f"Error processing part {i+1}: {str(e)}"
    
    # Combine results
    combined_text = "\n\n--- End of Part ---\n\n".join([results[i] for i in sorted(results.keys())])
    
    # Process formulas if needed
    combined_text = process_formulas(combined_text)
    
    # Clean up temporary files
    for file_path in split_files:
        try:
            os.remove(file_path)
        except:
            pass
    
    return combined_text

@app.route('/api/conversion-status', methods=['POST'])
def check_conversion_status():
    """Check the status of a conversion job"""
    data = request.json
    conversion_id = data.get('conversion_id')
    
    if not conversion_id:
        return jsonify({'success': False, 'message': 'Conversion ID required'}), 400
    
    try:
        # Iterate through all futures to find the matching one
        for future in concurrent.futures._futures.futures_instances:
            if str(id(future)) == conversion_id:
                if future.done():
                    result = future.result()
                    
                    # Create unique ID for this result
                    timestamp = int(time.time())
                    result_id = f"result_combined_{timestamp}.txt"
                    
                    # Save result to file
                    result_path = os.path.join(app.config['UPLOAD_FOLDER'], result_id)
                    with open(result_path, 'w', encoding='utf-8') as f:
                        f.write(result)
                    
                    return jsonify({
                        'success': True,
                        'status': 'completed',
                        'result': result,
                        'result_id': result_id
                    })
                else:
                    return jsonify({
                        'success': True,
                        'status': 'in_progress'
                    })
        
        return jsonify({
            'success': False,
            'message': 'Conversion not found or expired'
        }), 404
    except Exception as e:
        app.logger.error(f"Error checking conversion status: {str(e)}")
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/convert-to-word', methods=['POST'])
def convert_to_word():
    """Convert text to a Word document using pandoc"""
    data = request.json
    content = data.get('content')
    
    if not content:
        return jsonify({'success': False, 'message': 'No content provided'}), 400
    
    try:
        # Create temporary files
        with tempfile.NamedTemporaryFile(suffix='.md', delete=False) as md_file:
            md_path = md_file.name
            content = content.replace('\n', '\n\n')
            md_file.write(content.encode('utf-8'))
        
        with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as docx_file:
            docx_path = docx_file.name
        
        # Run pandoc
        pandoc_command = [
            "pandoc",
            md_path,
            "-o", docx_path,
            "--from", "markdown",
            "--to", "docx",
            "--mathml"
        ]
        
        subprocess.run(pandoc_command, check=True)
        
        # Read the docx file and return it
        with open(docx_path, 'rb') as f:
            docx_data = f.read()
        
        # Clean up temporary files
        os.unlink(md_path)
        os.unlink(docx_path)
        
        return send_file(
            BytesIO(docx_data),
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            as_attachment=True,
            download_name='converted_document.docx'
        )
    except Exception as e:
        app.logger.error(f"Error converting to Word: {str(e)}")
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

def get_prompt(conversion_type):
    """Get the appropriate prompt based on conversion type"""
    if conversion_type == 'latex_mcq':
        return """
        Hãy nhận diện và gõ lại [CHÍNH XÁC] PDF thành văn bản, tất cả công thức Toán Latex, bọc trong dấu $
        [TUYỆT ĐỐI] không thêm nội dung khác ngoài nội dung PDF, [CHỈ ĐƯỢC PHÉP] gõ lại nội dung PDF thành văn bản.
        1. Chuyển bảng (table) thông thường sang cấu trúc như này cho tôi, còn bảng biến thiên thì không chuyển
        \\begin{tabular}{|c|c|c|c|c|c|}
        \\hline$x$ & -2 & -1 & 0 & 1 & 2 \\\\
        \\hline$y=x^2$ & 4 & 1 & 0 & 1 & 4 \\\\
        \\hline
        \\end{tabular}
        2. Hãy bỏ cấu trúc in đậm của Markdown trong kết quả (bỏ dấu *)
        3. Chuyển nội dung văn bản trong file sang cấu trúc Latex với câu hỏi trắc nghiệm
        3.1 Câu hỏi trắc nghiệm không lời giải (bắt đầu là Câu 1. hoặc Câu 1:) sẽ chuyển như sau:
        Câu 1: Với $x$ là số thực dương tùy ý, $x \\sqrt{x^{5}}$ bằng
        A. $x^{\\frac{2}{3}}$.
        B. $x^{3}$.
        C. $x^{\\frac{7}{2}}$.
        D. $x^{\\frac{3}{5}}$.
        Câu hỏi sau khi chuyển sang câu hỏi trắc nghiệm theo cấu trúc ex_test như sau:
        \\begin{ex}%Câu 1
         Với $x$ là số thực dương tùy ý, $x \\sqrt{x^5}$ bằng
        \\choice
        { $x^{\\dfrac{2}{3}}$}
        { $x^3$}
        { $x^{\\dfrac{7}{2}}$}
        { $x^{\\dfrac{3}{5}}$}
        \\end{ex}
        3.2 Câu hỏi trắc nghiệm có lời giải (bắt đầu là Câu 1. hoặc Câu 1:) sẽ chuyển như sau:
        \\begin{ex} % Câu 1.
        Hàm số nào dưới đây có bảng biến thiên như sau
        \\choice
        {\\True $\\dfrac{x+2}{x-1}$}
        { $\\dfrac{-x+2}{x-1}$}
        { $\\dfrac{x+2}{x+1}$}
        { $\\dfrac{x-2}{x-1}$}
        \\loigiai{
        Quan sát bảng biến thiên ta thấy:\\\\
        }
        \\end{ex}
        4. Chuyển nội dung văn bản trong file sang cấu trúc Latex với bài tập tự luận
        \\begin{bt} % Bài 1.
        Tìm 2 số $ x$ và $ y$ biết: $\\dfrac{x}{6}=\\dfrac{y}{7}$ và $ x+y=26$.
        \\loigiai{
        Áp dụng tính chất dãy tỉ số bằng nhau, ta có: $\\dfrac{x}{6}=\\dfrac{y}{7}=\\dfrac{x+y}{6+7}=\\dfrac{26}{13}=2$
        }
        \\end{bt}
        """
    else:  # Default to text prompt
        return """
        Hãy nhận diện và gõ lại [CHÍNH XÁC] PDF thành văn bản, tất cả công thức Toán Latex, bọc trong dấu $
        [TUYỆT ĐỐI] không thêm nội dung khác ngoài nội dung PDF, [CHỈ ĐƯỢC PHÉP] gõ lại nội dung PDF thành văn bản.
        """

def process_formulas(text):
    """Process mathematical formulas in the text"""
    def process_math_content(match):
        content = match.group(1)
        content = content.replace('π', '\\pi')
        content = re.sub(r'√(\d+)', r'\\sqrt{\1}', content)
        content = re.sub(r'√\{([^}]+)\}', r'\\sqrt{\1}', content)
        content = content.replace('≠', '\\neq')
        content = content.replace('*', '')
        return f'${content}$'

    text = re.sub(r'\$(.+?)\$', process_math_content, text, flags=re.DOTALL)
    return text

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
