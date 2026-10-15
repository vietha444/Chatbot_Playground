/**
 * Cấu hình Backend API
 * Tự động kết nối Backend API mà không hiển thị hay cho tùy chỉnh trên giao diện người dùng
 */
const CONFIG = {
    // URL Backend API Flask mặc định (thử kết nối 127.0.0.1 hoặc localhost)
    API_BASE: "http://127.0.0.1:5000",

    getApiBase: function() {
        if (typeof window !== "undefined" && window.BACKEND_API_URL) {
            return window.BACKEND_API_URL.replace(/\/+$/, "");
        }
        // Nếu trang web được mở trực tiếp từ Flask (cùng domain/origin)
        if (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin.startsWith("http")) {
            const port = window.location.port;
            // Nếu chạy trên cổng 5000 hoặc host backend
            if (port === "5000" || window.location.hostname.includes("run.app") || window.location.hostname.includes("railway.app") || window.location.hostname.includes("tail36da8e.ts.net")) {
                return window.location.origin;
            }
        }
        return this.API_BASE;
    }
};

