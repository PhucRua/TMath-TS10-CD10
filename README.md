# P_Convert_2025 - Web Version

A web-based application for converting PDF and Image files to text, LaTeX, and Word documents using Google's Generative AI.

## Features

- API key configuration for Google Generative AI
- Hardware ID generation and activation check
- PDF and Image file upload
- PDF to text conversion
- PDF/Image to LaTeX/MCQ conversion
- Export to Word document
- Progress tracking for multi-part PDF conversions

## Deployment on Render.com

### Method 1: Using render.yaml

1. Fork this repository to your GitHub account.
2. Create a new Web Service on Render.com.
3. Select "Blueprint" as the deployment type.
4. Connect your GitHub repository.
5. Render will automatically detect the `render.yaml` configuration.
6. Complete the setup process and deploy.

### Method 2: Manual Deployment with Docker

1. Fork this repository to your GitHub account.
2. Create a new Web Service on Render.com.
3. Select "Docker" as the deployment type.
4. Connect your GitHub repository.
5. Set the following configuration:
   - Environment: Docker
   - Branch: main (or your preferred branch)
   - Build Command: (leave default)
   - Start Command: (leave default)
6. Add any environment variables (optional):
   - `SECRET_KEY`: A secure random string for session encryption

### Method 3: Manual Deployment with Python

1. Fork this repository to your GitHub account.
2. Create a new Web Service on Render.com.
3. Select "Python" as the deployment type.
4. Connect your GitHub repository.
5. Set the following configuration:
   - Environment: Python 3
   - Build Command: `pip install -r requirements.txt && apt-get update && apt-get install -y pandoc`
   - Start Command: `gunicorn app:app`
6. Add any environment variables (optional):
   - `SECRET_KEY`: A secure random string for session encryption

## Project Structure

- `app.py` - Main Flask application file
- `templates/` - HTML templates
  - `index.html` - Main application page
- `static/` - Static assets
  - `css/styles.css` - CSS styles
  - `js/script.js` - JavaScript code
- `requirements.txt` - Python dependencies
- `Dockerfile` - Docker configuration
- `render.yaml` - Render.com deployment configuration

## Local Development

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd p-convert-2025-web
   ```

2. Create a virtual environment and install dependencies:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Install pandoc:
   - On Ubuntu/Debian: `sudo apt-get install pandoc`
   - On macOS: `brew install pandoc`
   - On Windows: Download from https://pandoc.org/installing.html

4. Run the application:
   ```bash
   flask run
   ```

5. Access the application at http://localhost:5000
