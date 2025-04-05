FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies including pandoc
RUN apt-get update && apt-get install -y \
    pandoc \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8080

# Set environment variables
ENV PORT=8080

# Run the application
CMD gunicorn --bind 0.0.0.0:$PORT app:app
