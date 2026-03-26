FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for PyMuPDF, Tesseract, and OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    tesseract-ocr \
    libtesseract-dev \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download spacy model for Presidio
RUN python -m spacy download en_core_web_lg

COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
