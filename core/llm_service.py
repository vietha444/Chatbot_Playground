# -*- coding: utf-8 -*-
"""
HPU2 LLM Service - Thuần kết nối Ollama Server
Tất cả các truy vấn trò chuyện thông thường và RAG đều được xử lý qua Ollama:
- Hỗ trợ mô hình ngôn ngữ lớn (Qwen 2.5, DeepSeek R1, Llama 3.1, Llama 3.2, Mistral, GLM)
- Hỗ trợ đa phương thức thị giác (Multimodal Vision) qua Qwen 2.5-VL và Granite Vision
- Tự động phát hiện và chuyển đổi sang model thị giác khi người dùng tải ảnh lên
"""
import os
import json
import requests
from typing import Generator, List, Dict, Any, Optional
from core.config import Config
from core.model_service import ModelService

import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')


class LLMService:
    def __init__(self):
        self.ollama_base = Config.OLLAMA_REMOTE_URL
        self.model_service = ModelService()

    def check_ollama_alive(self) -> str:
        """Kiểm tra URL Ollama nào đang hoạt động."""
        for url in [Config.OLLAMA_REMOTE_URL, Config.OLLAMA_LOCAL_URL]:
            try:
                res = requests.get(f"{url}/api/tags", timeout=3, verify=False)
                if res.status_code == 200:
                    return url
            except Exception:
                continue
        return Config.OLLAMA_REMOTE_URL

    def get_available_models(self) -> List[Dict[str, Any]]:
        """Lấy danh sách các mô hình hoạt động từ ModelService (Neon DB system_models)."""
        try:
            models = self.model_service.get_models()
            if models:
                return models
        except Exception as e:
            print(f"[LLMService] Lỗi khi tải mô hình từ ModelService: {e}")

        return Config.AVAILABLE_MODELS

    def build_rag_prompt(self, query: str, context_chunks: List[Dict[str, Any]]) -> str:
        """
        Xây dựng prompt chuẩn hóa cho RAG với đánh số trích dẫn.
        """
        if not context_chunks:
            return query

        formatted_context = []
        for idx, item in enumerate(context_chunks, start=1):
            text = item.get("text", "").strip()
            source = item.get("source", "Tài liệu hệ thống")
            score = item.get("score")
            score_str = f" (Độ liên quan: {score:.1%})" if score is not None else ""
            formatted_context.append(f"--- [NGUỒN {idx}: {source}{score_str}] ---\n{text}")

        context_str = "\n\n".join(formatted_context)

        prompt = (
            f"Bạn là một trợ lý ảo thông minh và chính xác. Hãy trả lời câu hỏi của người dùng "
            f"dựa trên các tài liệu được cung cấp dưới đây.\n\n"
            f"Quy tắc trả lời:\n"
            f"1. Ưu tiên sử dụng thông tin trong phần [TÀI LIỆU CUNG CẤP].\n"
            f"2. Luôn ghi chú số nguồn tham khảo trong câu trả lời (ví dụ: [1], [2]) tại các ý được trích xuất.\n"
            f"3. Nếu tài liệu không chứa đủ thông tin để trả lời, hãy nêu rõ điều đó và có thể bổ sung bằng kiến thức tổng quát của bạn nhưng cần phân biệt rõ.\n"
            f"4. Trả lời bằng tiếng Việt rõ ràng, mạch lạc, định dạng Markdown đẹp mắt (bảng, danh sách, công thức LaTeX nếu có).\n\n"
            f"[TÀI LIỆU CUNG CẤP]:\n{context_str}\n\n"
            f"[CÂU HỎI]:\n{query}\n\n"
            f"[CÂU TRẢ LỜI]:"
        )
        return prompt

    def stream_chat(
        self,
        messages: List[Dict[str, str]],
        model_id: str = "qwen2.5:14b",
        images: Optional[List[str]] = None,
        model: Optional[str] = None,
        **kwargs
    ) -> Generator[str, None, None]:
        """
        Stream câu trả lời thuần từ mô hình Ollama.
        Nếu có ảnh đính kèm mà người dùng chọn model không hỗ trợ vision, tự động dùng model vision của Ollama (qwen2.5vl:7b).
        """
        if model:
            model_id = model

        # Nếu model_id chứa gemini hoặc gpt cũ, chuyển về mô hình Ollama mặc định
        if not model_id or "gemini" in model_id.lower() or "gpt" in model_id.lower():
            model_id = "qwen2.5:14b"

        # Nếu có hình ảnh đính kèm và model hiện tại không có khả năng vision, chuyển sang qwen2.5vl:7b
        if images and len(images) > 0:
            is_vision_model = any(v in model_id.lower() for v in ["vl", "vision", "ocr", "gemma4"])
            if not is_vision_model:
                model_id = "qwen2.5vl:7b"

        yield from self._stream_ollama(messages, model_id, images)

    def _stream_ollama(
        self,
        messages: List[Dict[str, str]],
        model_id: str,
        images: Optional[List[Any]] = None
    ) -> Generator[str, None, None]:
        active_url = self.check_ollama_alive()
        api_chat_url = f"{active_url}/api/chat"

        # Định dạng payload gửi tới Ollama
        formatted_messages = []
        for msg in messages:
            formatted_messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", "")
            })

        payload: Dict[str, Any] = {
            "model": model_id,
            "messages": formatted_messages,
            "stream": True
        }

        # Nếu có hình ảnh đính kèm (multimodal)
        if images and len(formatted_messages) > 0:
            clean_images = []
            for img_data in images[:3]:
                raw_b64 = img_data.get("base64", img_data) if isinstance(img_data, dict) else img_data
                if isinstance(raw_b64, str):
                    if "," in raw_b64:
                        raw_b64 = raw_b64.split(",", 1)[1]
                    clean_images.append(raw_b64.strip())
            if clean_images:
                payload["messages"][-1]["images"] = clean_images

        try:
            with requests.post(api_chat_url, json=payload, stream=True, timeout=120, verify=False) as response:
                if response.status_code != 200:
                    yield f"[Lỗi {response.status_code} từ Ollama ({active_url}): {response.text}]"
                    return

                for line in response.iter_lines(decode_unicode=True):
                    if line:
                        try:
                            data = json.loads(line)
                            token = data.get("message", {}).get("content", "")
                            if token:
                                yield token
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            yield f"\n[Lỗi kết nối tới mô hình Ollama ({model_id}) tại {active_url}: {str(e)}]"
