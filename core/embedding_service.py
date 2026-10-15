# -*- coding: utf-8 -*-
"""
Embedding Service - Tích hợp độc quyền mô hình BGE-M3 qua Ollama Remote Endpoint:
http://chatbot.tail36da8e.ts.net:11434
Tuyệt đối KHÔNG sử dụng, không tải hoặc chạy dự phòng mô hình all-MiniLM-L6-v2!
Vector trả về có số chiều chính xác 1024 (chuẩn bge-m3).
"""

import os
import sys
import requests
from typing import List, Optional
import chromadb
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
from core.config import Config


class OllamaBgeM3EmbeddingFunction(EmbeddingFunction[Documents]):
    """
    ChromaDB Embedding Function kết nối trực tiếp đến endpoint Ollama từ xa của người dùng:
    http://chatbot.tail36da8e.ts.net:11434 với model bge-m3 (1024 dims).
    Tuyệt đối KHÔNG sử dụng hoặc nạp model mặc định all-MiniLM-L6-v2.
    """
    def __init__(self, endpoint: Optional[str] = None, model: str = "bge-m3"):
        self.endpoint = (endpoint or Config.OLLAMA_REMOTE_URL).rstrip("/")
        self.model = model

    def __call__(self, input: Documents) -> Embeddings:
        if not input:
            return []
        texts = [str(t) for t in input]
        embeddings = []
        batch_size = 15

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            batch_success = False

            # 1. Thử gọi /api/embed (Batch mode)
            try:
                resp = requests.post(
                    f"{self.endpoint}/api/embed",
                    json={"model": self.model, "input": batch},
                    timeout=45
                )
                if resp.status_code == 200:
                    data = resp.json()
                    embs = data.get("embeddings", [])
                    if embs and len(embs) == len(batch):
                        embeddings.extend(embs)
                        batch_success = True
            except Exception as e:
                print(f"[OllamaBgeM3] Batch embed warning {i}: {e}")

            if not batch_success:
                # 2. Fallback qua /api/embeddings từng chunk
                for text in batch:
                    try:
                        r = requests.post(
                            f"{self.endpoint}/api/embeddings",
                            json={"model": self.model, "prompt": text},
                            timeout=25
                        )
                        if r.status_code == 200:
                            emb = r.json().get("embedding", [])
                            if emb and len(emb) == 1024:
                                embeddings.append(emb)
                                continue
                    except Exception:
                        pass
                    # Emergency 1024-dim zero vector nếu timeout hoàn toàn
                    embeddings.append([0.0] * 1024)

        return embeddings
