# syntax=docker/dockerfile:1
FROM python:3.11-slim

# Thiết lập các biến môi trường hệ thống
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    TRANSFORMERS_NO_TF=1 \
    USE_TF=0 \
    PORT=5000 \
    DEBIAN_FRONTEND=noninteractive

# Cài đặt các thư viện hệ thống cần thiết cho OpenCV, PyMuPDF, OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
WORKDIR /app

# Cài đặt PyTorch với hỗ trợ CUDA 12.4 (Tự động fallback CPU nếu không có GPU)
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu124

# Cài đặt các thư viện Python từ requirements.txt
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Sao chép mã nguồn ứng dụng
COPY unified_app/ /app/unified_app/
COPY backend_api/ /app/backend_api/
COPY OCR/ /app/OCR/

# Tạo các thư mục lưu trữ volume mount
RUN mkdir -p /app/models /app/data /app/uploads /app/unified_app/uploads

# Chuyển vào thư mục unified_app làm việc chính
WORKDIR /app/unified_app

# Expose cổng 5000
EXPOSE 5000

# Khởi chạy server với Gunicorn hoặc Python trực tiếp
CMD ["python", "app.py"]
