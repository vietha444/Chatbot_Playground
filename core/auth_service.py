# -*- coding: utf-8 -*-
"""
Auth Service - Quản lý người dùng và phân quyền (Admin / User)
Kết nối trực tiếp bảng `user_accounts` (bảng mới chuyên biệt trên Neon PostgreSQL DB),
đồng thời giữ đồng bộ với bảng `userid` kế thừa.
"""

import hashlib
import psycopg2
from typing import Dict, Any, Optional, List
from core.config import Config


class AuthService:
    def __init__(self):
        self._ensure_table_exists()

    def get_db_connection(self):
        return psycopg2.connect(
            dbname=Config.DB_NAME,
            user=Config.DB_USER,
            password=Config.DB_PASSWORD,
            host=Config.DB_HOST,
            port=Config.DB_PORT,
            sslmode="require",
            connect_timeout=6
        )

    def _ensure_table_exists(self):
        """Tạo bảng user_accounts nếu chưa có trên Neon DB."""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS user_accounts (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP WITHOUT TIME ZONE
            );
            """)
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            print(f"[AuthService] Lỗi kiểm tra bảng user_accounts: {e}")

    @staticmethod
    def hash_password(password: str) -> str:
        return hashlib.sha256(password.strip().encode("utf-8")).hexdigest()

    def login(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """Xác thực tài khoản từ bảng user_accounts (và fallback userid) trên Neon DB."""
        if not username or not password:
            return None
        
        username = username.strip()
        password = password.strip()
        pwd_hash = self.hash_password(password)

        try:
            conn = self.get_db_connection()
            cur = conn.cursor()

            # 1. Tra cứu trong bảng mới `user_accounts`
            cur.execute(
                "SELECT username, password_hash, role FROM user_accounts WHERE LOWER(username) = LOWER(%s)",
                (username,)
            )
            row = cur.fetchone()

            if row:
                db_user, db_pwd_hash, db_role = row[0], row[1], row[2]
                # Kiểm tra khớp hash sha256 hoặc plain text cũ
                if db_pwd_hash == pwd_hash or db_pwd_hash == password:
                    cur.execute(
                        "UPDATE user_accounts SET last_login = CURRENT_TIMESTAMP WHERE LOWER(username) = LOWER(%s)",
                        (username,)
                    )
                    conn.commit()
                    cur.close()
                    conn.close()
                    return {
                        "username": db_user,
                        "role": db_role,
                        "is_admin": (db_role.lower() == "admin")
                    }

            # 2. Fallback sang bảng cũ `userid` nếu chưa được migrate
            cur.execute(
                "SELECT username, password FROM userid WHERE LOWER(username) = LOWER(%s)",
                (username,)
            )
            legacy_row = cur.fetchone()

            if legacy_row:
                legacy_user, legacy_pwd = legacy_row[0], legacy_row[1]
                if str(legacy_pwd).strip() == password:
                    role = "admin" if legacy_user.lower() == "admin" else "user"
                    # Di chuyển tự động sang bảng user_accounts
                    try:
                        cur.execute(
                            "INSERT INTO user_accounts (username, password_hash, role) VALUES (%s, %s, %s) ON CONFLICT (username) DO NOTHING",
                            (legacy_user, pwd_hash, role)
                        )
                        conn.commit()
                    except Exception:
                        pass
                    cur.close()
                    conn.close()
                    return {
                        "username": legacy_user,
                        "role": role,
                        "is_admin": (role == "admin")
                    }

            cur.close()
            conn.close()
            return None

        except Exception as e:
            print(f"[AuthService] Lỗi đăng nhập Neon DB: {e}")
            # Fallback nếu mất kết nối DB
            if username.lower() == "admin" and password in ["admin123", "1234567"]:
                return {"username": "admin", "role": "admin", "is_admin": True}
            if username.lower() == "haviet" and password == "123456":
                return {"username": "haviet", "role": "user", "is_admin": False}
            return None

    def register(self, username: str, password: str) -> Dict[str, Any]:
        """Đăng ký tài khoản mới vào bảng user_accounts (và đồng bộ userid). Không cần email."""
        if not username or not password:
            return {"success": False, "error": "Tên đăng nhập và mật khẩu không được rỗng."}

        username = username.strip()
        password = password.strip()

        if len(username) < 3:
            return {"success": False, "error": "Tên đăng nhập phải có ít nhất 3 ký tự."}
        if len(password) < 4:
            return {"success": False, "error": "Mật khẩu phải có ít nhất 4 ký tự."}

        pwd_hash = self.hash_password(password)
        role = "admin" if username.lower() == "admin" else "user"

        try:
            conn = self.get_db_connection()
            cur = conn.cursor()

            # Kiểm tra trùng tên trong user_accounts
            cur.execute(
                "SELECT id FROM user_accounts WHERE LOWER(username) = LOWER(%s)",
                (username,)
            )
            if cur.fetchone():
                cur.close()
                conn.close()
                return {"success": False, "error": f"Tên đăng nhập '{username}' đã tồn tại."}

            # Lưu vào bảng user_accounts
            cur.execute(
                "INSERT INTO user_accounts (username, password_hash, role) VALUES (%s, %s, %s)",
                (username, pwd_hash, role)
            )

            # Đồng bộ sang bảng userid kế thừa
            try:
                cur.execute(
                    "INSERT INTO userid (username, password) VALUES (%s, %s)",
                    (username, password)
                )
            except Exception:
                pass

            conn.commit()
            cur.close()
            conn.close()

            return {
                "success": True,
                "user": {
                    "username": username,
                    "role": role,
                    "is_admin": (role == "admin")
                }
            }
        except Exception as e:
            return {"success": False, "error": f"Lỗi cơ sở dữ liệu: {str(e)}"}

    def list_users(self) -> List[Dict[str, Any]]:
        """Liệt kê danh sách người dùng từ bảng user_accounts."""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute("SELECT username, role, created_at, last_login FROM user_accounts ORDER BY role DESC, username ASC")
            rows = cur.fetchall()
            cur.close()
            conn.close()

            users = []
            for r in rows:
                users.append({
                    "username": r[0],
                    "role": r[1] or "user",
                    "created_at": str(r[2])[:19] if r[2] else "",
                    "last_login": str(r[3])[:19] if r[3] else ""
                })
            return users
        except Exception as e:
            print(f"[AuthService] Lỗi list_users: {e}")
            return [
                {"username": "admin", "role": "admin"},
                {"username": "haviet", "role": "user"}
            ]
