# 🌐 Hướng Dẫn Triển Khai Hệ Thống Lên Cloudflare (Frontend Tách Rời Backend API)

Hệ thống đã được tách rời hoàn toàn thành **2 phần độc lập**:
1. **Frontend (`frontend_cloudflare/`)**: Mã nguồn tĩnh HTML/CSS/JS (SPA) sẵn sàng triển khai lên **Cloudflare Pages**.
2. **Backend API (`backend_api/`)**: Máy chủ Flask REST & SSE Streaming API chạy độc lập, sẵn sàng kết nối qua **Cloudflare Tunnel** hoặc VPS.

---

## 🏛️ Sơ Đồ Kiến Trúc Hệ Thống

```
┌─────────────────────────────────┐           ┌───────────────────────────────────────────────┐
│     CLOUDFLARE PAGES (CDN)      │           │         MÁY CHỦ BACKEND (GPU / CPU)           │
│                                 │           │                                               │
│  Thư mục: frontend_cloudflare/  │  HTTPS    │  Thư mục: backend_api/ (app.py)               │
│  - index.html                   ├──────────►│  - REST & SSE Streaming API (:5000)          │
│  - css/style.css                │  CORS     │  - BGE-Reranker-v2-m3                         │
│  - js/app.js, config.js         │           │  - Pix2Text OCR & PyMuPDF                     │
│  (https://chatbot.pages.dev)    │           │  - ChromaDB + Neon PostgreSQL                │
└─────────────────────────────────┘           └───────────────────────────────────────────────┘
                                                              ▲
                                                              │
                                                     CLOUDFLARE TUNNEL
                                                 (cloudflared hoặc Domain)
```

---

## 🚀 Bước 1: Khởi Động Backend API

Trên máy chủ hoặc máy tính của bạn (nơi có GPU/môi trường Python và các model AI):

1. Nhấp đúp chuột vào file:
   👉 [`start_backend.bat`](file:///c:/Users/admin/Desktop/Chatbot/start_backend.bat)
2. Hoặc chạy qua dòng lệnh PowerShell:
   ```powershell
   cd c:\Users\admin\Desktop\Chatbot\backend_api
   & "C:\Users\admin\anaconda3\python.exe" app.py
   ```
3. Backend API sẽ khởi động tại: `http://localhost:5000` (Hỗ trợ CORS toàn cầu cho Cloudflare).

---

## ☁️ Bước 2: Công Khai Backend API qua Cloudflare Tunnel (Miễn phí)

Để Cloudflare Pages (chạy trên HTTPS) gọi được vào Backend API của bạn mà **không cần mở cổng mạng (port forward) hay IP tĩnh**:

1. Tải công cụ **Cloudflare Tunnel (`cloudflared`)** từ Cloudflare:
   👉 [Tải cloudflared cho Windows](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi)

2. Mở PowerShell và chạy lệnh tạo đường hầm Quick Tunnel miễn phí:
   ```powershell
   cloudflared tunnel --url http://localhost:5000
   ```
3. Cloudflare sẽ cấp cho bạn một đường dẫn HTTPS bảo mật, ví dụ:
   👉 `https://random-words-abc.trycloudflare.com`

*(Nếu bạn có tên miền riêng trên Cloudflare, bạn có thể tạo Named Tunnel gắn cố định vào subdomain như `https://api.yourdomain.com`).*

---

## 📦 Bước 3: Triển Khai Frontend lên Cloudflare Pages

Bạn có thể đưa thư mục [`frontend_cloudflare/`](file:///c:/Users/admin/Desktop/Chatbot/frontend_cloudflare) lên Cloudflare Pages theo một trong 3 cách cực kỳ dễ dàng:

### Cách 3.1: Kéo thả trực tiếp trên giao diện Cloudflare Dashboard (Nhanh nhất - 1 phút)
1. Đăng nhập vào [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Chọn menu **Workers & Pages** -> Bấm **Create application** -> Chọn tab **Pages**.
3. Chọn mục **Upload assets**.
4. Đặt tên dự án (ví dụ: `hpu2-chatbot`).
5. Kéo thả toàn bộ các file trong thư mục:
   `c:\Users\admin\Desktop\Chatbot\frontend_cloudflare`
   *(gồm `index.html`, thư mục `css/`, `js/`, và file `_headers`)*.
6. Bấm **Deploy site**.
7. Website của bạn sẽ hoạt động ngay lập tức tại:
   👉 `https://hpu2-chatbot.pages.dev`

---

### Cách 3.2: Triển khai bằng dòng lệnh Wrangler CLI
Nếu máy bạn đã cài Node.js, bạn có thể deploy trực tiếp từ terminal:
```powershell
cd c:\Users\admin\Desktop\Chatbot
npx wrangler pages deploy frontend_cloudflare --project-name hpu2-chatbot
```

---

## 🔗 Bước 4: Kết Nối Frontend Cloudflare với Backend API

1. Truy cập vào trang web Cloudflare Pages của bạn (ví dụ: `https://hpu2-chatbot.pages.dev`).
2. Trên góc trên bên phải, bấm vào biểu tượng **⚙️ (Cài đặt API)**.
3. Dán địa chỉ Backend API của bạn vào (URL Cloudflare Tunnel ở Bước 2, ví dụ: `https://random-words-abc.trycloudflare.com` hoặc `https://api.yourdomain.com`).
4. Bấm **"Lưu & Kết Nối"**.
5. Huy hiệu ở góc trên sẽ chuyển ngay sang:
   `🟢 API Online: https://api.yourdomain.com`

Địa chỉ này được lưu vào `localStorage` của trình duyệt, bạn chỉ cần nhập một lần duy nhất!

---

## ✅ Kiểm Tra Tính Năng Sau Khi Triển Khai
- **Trò Chuyện & RAG**: Đặt câu hỏi, câu trả lời sẽ stream real-time với đầy đủ các thẻ trích dẫn nguồn `[Nguồn 1 (Độ liên quan: 89%)]`.
- **OCR Công Thức**: Kéo thả file PDF/Hình ảnh, xem kết quả bóc tách công thức LaTeX và ảnh layout.
- **Nạp vào RAG**: Bấm nút "Nạp vào Chatbot" để nạp ngay nội dung vừa OCR vào bộ nhớ ChromaDB.
- **Xem Tài Liệu**: Bấm xem các file PDF/Ảnh trực tiếp ngay trên Cloudflare Pages mà không bị lỗi CORS/CORB.
