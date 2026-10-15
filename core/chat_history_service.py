# -*- coding: utf-8 -*-
"""
Chat History Service - Quản lý Phiên Hội Thoại & Lịch Sử Chat
Kết nối trực tiếp tới Neon PostgreSQL DB với các bảng chuyên biệt:
- chat_sessions: Lưu danh sách phiên hỏi đáp, tiêu đề, mô hình, collections, thời gian cập nhật.
- chat_messages: Lưu toàn bộ tin nhắn (user, assistant), citations, ảnh multimodal đính kèm.
"""

import os
import sys
import json
import time
import psycopg2
from typing import Dict, Any, Optional, List, Tuple
from core.config import Config


class ChatHistoryService:
    def __init__(self):
        self._ensure_tables_exist()

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

    def _ensure_tables_exist(self):
        """Khởi tạo cấu trúc bảng chat_sessions và chat_messages nếu chưa có."""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id VARCHAR(100) PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                title VARCHAR(255) NOT NULL,
                chat_type VARCHAR(50) DEFAULT 'rag_rerank',
                model VARCHAR(100) DEFAULT 'qwen2.5:14b',
                collections VARCHAR(255) DEFAULT '',
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(100) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
                username VARCHAR(100) NOT NULL,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                citations TEXT,
                images TEXT,
                model VARCHAR(100),
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(username);
            """)
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            print(f"[ChatHistoryService] Lỗi khởi tạo bảng chat: {e}")

    def create_or_update_session(
        self,
        session_id: str,
        username: str,
        title: Optional[str] = None,
        chat_type: str = "rag_rerank",
        model: str = "qwen2.5:14b",
        collections: str = ""
    ) -> Dict[str, Any]:
        """Tạo mới hoặc cập nhật thông tin phiên trò chuyện trong Neon DB."""
        if not session_id:
            session_id = f"sess_{int(time.time())}_{os.urandom(3).hex()}"

        user = (username or "user").strip()
        default_title = (title or "Đoạn hội thoại mới").strip()
        if len(default_title) > 200:
            default_title = default_title[:197] + "..."

        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO chat_sessions (session_id, username, title, chat_type, model, collections, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (session_id) DO UPDATE SET
                    updated_at = CURRENT_TIMESTAMP,
                    title = CASE WHEN EXCLUDED.title <> 'Đoạn hội thoại mới' AND chat_sessions.title = 'Đoạn hội thoại mới' THEN EXCLUDED.title ELSE chat_sessions.title END,
                    chat_type = EXCLUDED.chat_type,
                    model = EXCLUDED.model,
                    collections = EXCLUDED.collections
                RETURNING session_id, username, title, chat_type, model, collections, created_at, updated_at;
                """,
                (session_id, user, default_title, chat_type, model, collections)
            )
            row = cur.fetchone()
            conn.commit()
            cur.close()
            conn.close()

            if row:
                return {
                    "session_id": row[0],
                    "username": row[1],
                    "title": row[2],
                    "chat_type": row[3],
                    "model": row[4],
                    "collections": row[5],
                    "created_at": str(row[6])[:19] if row[6] else "",
                    "updated_at": str(row[7])[:19] if row[7] else ""
                }
        except Exception as e:
            print(f"[ChatHistoryService] Lỗi lưu session '{session_id}': {e}")

        return {
            "session_id": session_id,
            "username": user,
            "title": default_title,
            "chat_type": chat_type,
            "model": model,
            "collections": collections,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }

    def save_message(
        self,
        session_id: str,
        username: str,
        role: str,
        content: str,
        citations: Optional[Any] = None,
        images: Optional[Any] = None,
        model: Optional[str] = None
    ) -> bool:
        """Lưu một tin nhắn vào bảng chat_messages trong Neon DB."""
        if not session_id or not content:
            return False

        user = (username or "user").strip()
        cit_str = json.dumps(citations, ensure_ascii=False) if citations else None
        img_str = json.dumps(images, ensure_ascii=False) if images else None

        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO chat_messages (session_id, username, role, content, citations, images, model, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP);
                """,
                (session_id, user, role, content, cit_str, img_str, model or "")
            )
            # Cập nhật updated_at cho session
            cur.execute(
                "UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = %s;",
                (session_id,)
            )
            conn.commit()
            cur.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[ChatHistoryService] Lỗi lưu message vào Neon DB: {e}")
            return False

    def list_sessions(
        self,
        username: Optional[str] = None,
        role: str = "user",
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Lấy danh sách các phiên chat từ Neon DB có phân quyền."""
        is_admin = (role == "admin" or (username and username.lower() == "admin"))
        sessions = []

        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            if is_admin:
                cur.execute(
                    """
                    SELECT s.session_id, s.username, s.title, s.chat_type, s.model, s.collections, s.created_at, s.updated_at,
                           COUNT(m.id) as msg_count
                    FROM chat_sessions s
                    LEFT JOIN chat_messages m ON s.session_id = m.session_id
                    GROUP BY s.session_id, s.username, s.title, s.chat_type, s.model, s.collections, s.created_at, s.updated_at
                    ORDER BY s.updated_at DESC
                    LIMIT %s;
                    """,
                    (limit,)
                )
            else:
                user_filter = (username or "user").strip()
                cur.execute(
                    """
                    SELECT s.session_id, s.username, s.title, s.chat_type, s.model, s.collections, s.created_at, s.updated_at,
                           COUNT(m.id) as msg_count
                    FROM chat_sessions s
                    LEFT JOIN chat_messages m ON s.session_id = m.session_id
                    WHERE LOWER(s.username) = LOWER(%s)
                    GROUP BY s.session_id, s.username, s.title, s.chat_type, s.model, s.collections, s.created_at, s.updated_at
                    ORDER BY s.updated_at DESC
                    LIMIT %s;
                    """,
                    (user_filter, limit)
                )

            rows = cur.fetchall()
            cur.close()
            conn.close()

            for r in rows:
                sessions.append({
                    "session_id": str(r[0]),
                    "username": str(r[1]),
                    "title": str(r[2]),
                    "chat_type": str(r[3]),
                    "model": str(r[4]),
                    "collections": str(r[5]),
                    "created_at": str(r[6])[:19] if r[6] else "",
                    "updated_at": str(r[7])[:19] if r[7] else "",
                    "message_count": int(r[8]) if r[8] else 0
                })
        except Exception as e:
            print(f"[ChatHistoryService] Lỗi đọc sessions từ Neon DB: {e}")

        return sessions

    def get_session_messages(
        self,
        session_id: str,
        username: Optional[str] = None,
        role: str = "user"
    ) -> List[Dict[str, Any]]:
        """Lấy toàn bộ tin nhắn thuộc về 1 session từ Neon DB."""
        if not session_id:
            return []

        messages = []
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, session_id, username, role, content, citations, images, model, created_at
                FROM chat_messages
                WHERE session_id = %s
                ORDER BY created_at ASC;
                """,
                (session_id,)
            )
            rows = cur.fetchall()
            cur.close()
            conn.close()

            for r in rows:
                cits = None
                if r[5]:
                    try:
                        cits = json.loads(r[5])
                    except Exception:
                        cits = r[5]

                imgs = None
                if r[6]:
                    try:
                        imgs = json.loads(r[6])
                    except Exception:
                        imgs = r[6]

                messages.append({
                    "id": r[0],
                    "session_id": r[1],
                    "username": r[2],
                    "role": r[3],
                    "content": r[4],
                    "citations": cits,
                    "images": imgs,
                    "model": r[7],
                    "created_at": str(r[8])[:19] if r[8] else ""
                })
        except Exception as e:
            print(f"[ChatHistoryService] Lỗi lấy messages của session '{session_id}': {e}")

        return messages

    def delete_session(
        self,
        session_id: str,
        username: Optional[str] = None,
        role: str = "user"
    ) -> Tuple[bool, str]:
        """Xóa một phiên hội thoại và toàn bộ tin nhắn liên quan."""
        if not session_id:
            return False, "Thiếu session_id."

        is_admin = (role == "admin" or (username and username.lower() == "admin"))

        try:
            conn = self.get_db_connection()
            cur = conn.cursor()

            # Kiểm tra quyền sở hữu
            cur.execute("SELECT username FROM chat_sessions WHERE session_id = %s", (session_id,))
            row = cur.fetchone()
            if not row:
                cur.close()
                conn.close()
                return False, f"Không tìm thấy phiên '{session_id}'."

            owner = row[0]
            if not is_admin and username and owner.lower() != username.lower():
                cur.close()
                conn.close()
                return False, "Bạn không có quyền xóa phiên hội thoại của người khác."

            cur.execute("DELETE FROM chat_sessions WHERE session_id = %s", (session_id,))
            conn.commit()
            cur.close()
            conn.close()
            return True, f"Đã xóa phiên hội thoại '{session_id}' thành công."
        except Exception as e:
            print(f"[ChatHistoryService] Lỗi xóa session '{session_id}': {e}")
            return False, str(e)

    def rename_session(
        self,
        session_id: str,
        new_title: str,
        username: Optional[str] = None,
        role: str = "user"
    ) -> Tuple[bool, str]:
        """Đổi tên tùy chỉnh cho phiên trò chuyện trong Neon DB."""
        if not session_id or not new_title:
            return False, "Thiếu mã phiên hoặc tiêu đề mới."

        clean_title = new_title.strip()
        if len(clean_title) > 200:
            clean_title = clean_title[:197] + "..."

        is_admin = (role == "admin" or (username and username.lower() == "admin"))

        try:
            conn = self.get_db_connection()
            cur = conn.cursor()

            # Kiểm tra quyền sở hữu
            cur.execute("SELECT username FROM chat_sessions WHERE session_id = %s", (session_id,))
            row = cur.fetchone()
            if not row:
                cur.close()
                conn.close()
                return False, f"Không tìm thấy phiên '{session_id}'."

            owner = row[0]
            if not is_admin and username and owner.lower() != username.lower():
                cur.close()
                conn.close()
                return False, "Bạn không có quyền sửa tên phiên hội thoại của người khác."

            cur.execute(
                "UPDATE chat_sessions SET title = %s, updated_at = CURRENT_TIMESTAMP WHERE session_id = %s;",
                (clean_title, session_id)
            )
            conn.commit()
            cur.close()
            conn.close()
            return True, clean_title
        except Exception as e:
            print(f"[ChatHistoryService] Lỗi đổi tên session '{session_id}': {e}")
            return False, str(e)

