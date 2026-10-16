# -*- coding: utf-8 -*-
"""
HPU2 Model Service - Quản lý Danh sách Mô hình LLM Hệ Thống
Lưu trữ và đồng bộ trực tiếp vào bảng `system_models` trên Neon PostgreSQL DB.
Cung cấp chức năng thêm, xóa, đặt mặc định và đồng bộ trực tiếp với máy chủ Ollama.
"""

import os
import json
import time
import requests
import psycopg2
from typing import List, Dict, Any, Optional
from core.config import Config


class ModelService:
    def __init__(self):
        self._ensure_table_exists()

    def get_db_connection(self, timeout: int = 15, retries: int = 2):
        """Kết nối tới Neon PostgreSQL DB với cơ chế tự động thử lại xử lý Serverless Cold Start."""
        last_err = None
        for attempt in range(1, retries + 1):
            try:
                conn = psycopg2.connect(
                    dbname=Config.DB_NAME,
                    user=Config.DB_USER,
                    password=Config.DB_PASSWORD,
                    host=Config.DB_HOST,
                    port=Config.DB_PORT,
                    sslmode="require",
                    connect_timeout=timeout
                )
                return conn
            except Exception as e:
                last_err = e
                print(f"[ModelService] Lỗi kết nối Neon DB lần {attempt}/{retries}: {e}")
                if attempt < retries:
                    time.sleep(1.5)
        raise last_err

    def _ensure_table_exists(self):
        """Tạo bảng system_models trên Neon DB nếu chưa tồn tại và nạp các model mặc định nếu bảng trống."""
        try:
            conn = self.get_db_connection(timeout=10, retries=2)
            cur = conn.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS system_models (
                id VARCHAR(100) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                provider VARCHAR(50) DEFAULT 'ollama',
                multimodal BOOLEAN DEFAULT FALSE,
                is_default BOOLEAN DEFAULT FALSE,
                description TEXT DEFAULT '',
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(100) DEFAULT 'admin'
            );
            """)
            conn.commit()

            # Kiểm tra xem đã có model nào chưa
            cur.execute("SELECT COUNT(*) FROM system_models;")
            count = cur.fetchone()[0]

            if count == 0:
                for m in Config.AVAILABLE_MODELS:
                    cur.execute("""
                        INSERT INTO system_models (id, name, provider, multimodal, is_default, description)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING;
                    """, (
                        m["id"],
                        m["name"],
                        m.get("provider", "ollama"),
                        m.get("multimodal", False),
                        m.get("default", False),
                        "Mô hình chuẩn hệ thống HPU2"
                    ))
                conn.commit()
                print(f"[ModelService] Đã khởi tạo {len(Config.AVAILABLE_MODELS)} mô hình chuẩn vào Neon DB system_models.")

            cur.close()
            conn.close()
        except Exception as e:
            print(f"[ModelService] Khởi tạo bảng system_models thất bại hoặc offline: {e}")

    def get_models(self) -> List[Dict[str, Any]]:
        """Lấy danh sách các mô hình hoạt động từ Neon DB system_models."""
        try:
            conn = self.get_db_connection(timeout=10, retries=2)
            cur = conn.cursor()
            cur.execute("""
                SELECT id, name, provider, multimodal, is_default, description, created_at, created_by
                FROM system_models
                ORDER BY is_default DESC, name ASC;
            """)
            rows = cur.fetchall()
            cur.close()
            conn.close()

            models = []
            for r in rows:
                models.append({
                    "id": r[0],
                    "name": r[1],
                    "provider": r[2] or "ollama",
                    "multimodal": bool(r[3]),
                    "default": bool(r[4]),
                    "description": r[5] or "",
                    "created_at": r[6].strftime("%Y-%m-%d %H:%M:%S") if r[6] else "",
                    "created_by": r[7] or "admin"
                })

            if models:
                # Đảm bảo lưu cache cục bộ
                self._save_local_cache(models)
                return models

        except Exception as e:
            print(f"[ModelService] Lỗi khi truy vấn Neon DB system_models: {e}. Dùng cache...")

        # Fallback cache nếu DB tạm thời timeout
        cached = self._load_local_cache()
        if cached:
            return cached

        return Config.AVAILABLE_MODELS

    def add_model(self, data: Dict[str, Any], requested_by: str = "admin") -> Dict[str, Any]:
        """Thêm hoặc cập nhật một mô hình vào Neon DB system_models."""
        model_id = str(data.get("id") or "").strip()
        name = str(data.get("name") or "").strip()
        provider = str(data.get("provider") or "ollama").strip()
        multimodal = bool(data.get("multimodal", False))
        is_default = bool(data.get("is_default") or data.get("default", False))
        description = str(data.get("description") or "").strip()

        if not model_id:
            return {"success": False, "error": "Thiếu mã định danh mô hình (model id, ví dụ: qwen2.5:14b)."}
        if not name:
            name = model_id

        conn = self.get_db_connection(timeout=15, retries=2)
        cur = conn.cursor()
        try:
            # Nếu đặt làm mặc định, hủy mặc định của các mô hình khác
            if is_default:
                cur.execute("UPDATE system_models SET is_default = FALSE;")

            cur.execute("""
                INSERT INTO system_models (id, name, provider, multimodal, is_default, description, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    provider = EXCLUDED.provider,
                    multimodal = EXCLUDED.multimodal,
                    is_default = EXCLUDED.is_default,
                    description = EXCLUDED.description,
                    created_by = EXCLUDED.created_by;
            """, (model_id, name, provider, multimodal, is_default, description, requested_by))

            # Nếu hệ thống chưa có model mặc định nào, tự động đặt model này làm mặc định
            cur.execute("SELECT COUNT(*) FROM system_models WHERE is_default = TRUE;")
            has_default = cur.fetchone()[0] > 0
            if not has_default:
                cur.execute("UPDATE system_models SET is_default = TRUE WHERE id = %s;", (model_id,))

            conn.commit()
            cur.close()
            conn.close()

            return {
                "success": True,
                "message": f"Mô hình '{name}' ({model_id}) đã được lưu thành công vào Neon DB!",
                "model": {
                    "id": model_id,
                    "name": name,
                    "provider": provider,
                    "multimodal": multimodal,
                    "default": is_default,
                    "description": description
                }
            }
        except Exception as e:
            if conn:
                conn.rollback()
                conn.close()
            print(f"[ModelService] Lỗi khi thêm mô hình: {e}")
            return {"success": False, "error": str(e)}

    def delete_model(self, model_id: str, requested_by: str = "admin") -> Dict[str, Any]:
        """Xóa một mô hình khỏi Neon DB system_models."""
        model_id = str(model_id or "").strip()
        if not model_id:
            return {"success": False, "error": "Thiếu mã mô hình cần xóa."}

        conn = self.get_db_connection(timeout=15, retries=2)
        cur = conn.cursor()
        try:
            # Kiểm tra xem mô hình có đang là mặc định không
            cur.execute("SELECT is_default FROM system_models WHERE id = %s;", (model_id,))
            row = cur.fetchone()
            if not row:
                cur.close()
                conn.close()
                return {"success": False, "error": f"Không tìm thấy mô hình '{model_id}' trong hệ thống."}

            was_default = bool(row[0])

            # Kiểm tra tổng số lượng mô hình còn lại
            cur.execute("SELECT COUNT(*) FROM system_models;")
            total_count = cur.fetchone()[0]
            if total_count <= 1:
                cur.close()
                conn.close()
                return {"success": False, "error": "Hệ thống cần giữ lại ít nhất 1 mô hình hoạt động. Không thể xóa mô hình cuối cùng."}

            # Xóa khỏi bảng
            cur.execute("DELETE FROM system_models WHERE id = %s;", (model_id,))

            # Nếu mô hình vừa xóa là mặc định, chọn mô hình đầu tiên còn lại làm mặc định
            if was_default:
                cur.execute("SELECT id FROM system_models LIMIT 1;")
                fallback_row = cur.fetchone()
                if fallback_row:
                    cur.execute("UPDATE system_models SET is_default = TRUE WHERE id = %s;", (fallback_row[0],))

            conn.commit()
            cur.close()
            conn.close()

            return {
                "success": True,
                "message": f"Đã xóa thành công mô hình '{model_id}' khỏi hệ thống Neon DB!"
            }
        except Exception as e:
            if conn:
                conn.rollback()
                conn.close()
            print(f"[ModelService] Lỗi khi xóa mô hình '{model_id}': {e}")
            return {"success": False, "error": str(e)}

    def set_default_model(self, model_id: str, requested_by: str = "admin") -> Dict[str, Any]:
        """Đặt một mô hình làm mô hình mặc định trên toàn hệ thống."""
        model_id = str(model_id or "").strip()
        if not model_id:
            return {"success": False, "error": "Thiếu mã mô hình."}

        conn = self.get_db_connection(timeout=15, retries=2)
        cur = conn.cursor()
        try:
            cur.execute("SELECT id, name FROM system_models WHERE id = %s;", (model_id,))
            row = cur.fetchone()
            if not row:
                cur.close()
                conn.close()
                return {"success": False, "error": f"Mô hình '{model_id}' không tồn tại trong hệ thống."}

            cur.execute("UPDATE system_models SET is_default = FALSE;")
            cur.execute("UPDATE system_models SET is_default = TRUE WHERE id = %s;", (model_id,))
            conn.commit()
            cur.close()
            conn.close()

            return {
                "success": True,
                "message": f"Đã đặt '{row[1]}' ({model_id}) làm mô hình mặc định toàn hệ thống!",
                "default_model": model_id
            }
        except Exception as e:
            if conn:
                conn.rollback()
                conn.close()
            return {"success": False, "error": str(e)}

    def scan_ollama_models(self) -> Dict[str, Any]:
        """Quét máy chủ Ollama để phát hiện các model đang có sẵn và đối chiếu với hệ thống."""
        system_models = self.get_models()
        active_ids = {m["id"].lower() for m in system_models}

        detected_url = None
        ollama_models = []
        is_online = False

        for url in [Config.OLLAMA_REMOTE_URL, Config.OLLAMA_LOCAL_URL]:
            try:
                res = requests.get(f"{url}/api/tags", timeout=4, verify=False)
                if res.status_code == 200:
                    data = res.json()
                    detected_url = url
                    is_online = True
                    raw_models = data.get("models", [])
                    exclude = ["embed", "bge-m3", "nomic-embed"]

                    for rm in raw_models:
                        tag = rm.get("name", "")
                        if any(ex in tag.lower() for ex in exclude):
                            continue
                        size_gb = round(rm.get("size", 0) / (1024**3), 2)
                        is_multimodal = any(k in tag.lower() for k in ["vl", "vision", "ocr", "gemma4"])
                        is_active = tag.lower() in active_ids

                        ollama_models.append({
                            "id": tag,
                            "name": tag,
                            "size": f"{size_gb} GB" if size_gb > 0 else "N/A",
                            "multimodal": is_multimodal,
                            "is_active": is_active,
                            "modified_at": rm.get("modified_at", "")
                        })
                    break
            except Exception:
                continue

        return {
            "success": True,
            "online": is_online,
            "ollama_url": detected_url or Config.OLLAMA_REMOTE_URL,
            "models": ollama_models,
            "total_detected": len(ollama_models)
        }

    def _save_local_cache(self, models: List[Dict[str, Any]]):
        """Lưu cache cục bộ phòng trường hợp Neon DB cold start timeout."""
        try:
            cache_file = os.path.join(Config.DATA_DIR, "models_cache.json")
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(models, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _load_local_cache(self) -> Optional[List[Dict[str, Any]]]:
        """Tải danh sách mô hình từ cache cục bộ."""
        try:
            cache_file = os.path.join(Config.DATA_DIR, "models_cache.json")
            if os.path.exists(cache_file):
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return None
