# -*- coding: utf-8 -*-
"""
RAG Service - Tích hợp đầy đủ các thuật toán từ flask_server_reranker_multimodal.py:
1. Vector Search (Chroma HttpClient + Ollama BGE-M3)
2. BM25 Search (PostgreSQL Neon + CharacterTextSplitter + BM25Okapi)
3. FlagReranker BGE-Reranker-v2-m3 với trích xuất điểm _extract_score
4. Chroma Multimodal Query (truy xuất ảnh liên quan từ M3Test và Base64 encode)
5. Multi-collection retrieval hỗ trợ chọn 1 hoặc nhiều tài liệu (colname.split('+'))
6. Lưu log vào bảng raghistory của Neon DB
"""

import os
import sys

# Suppress TensorFlow in Transformers / Keras 3 compatibility
os.environ["TRANSFORMERS_NO_TF"] = "1"
os.environ["USE_TF"] = "0"

import re
import json
import base64
import psycopg2

try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
from typing import List, Dict, Any, Tuple, Optional
import requests
from rank_bm25 import BM25Okapi
import chromadb
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter, CharacterTextSplitter
from core.config import Config


from core.embedding_service import OllamaBgeM3EmbeddingFunction


def _extract_score(raw) -> Optional[float]:
    """
    Cố gắng trích số float từ raw trả về của reranker.
    Hỗ trợ: int/float, list/tuple, dict, numpy/torch (has .item()).
    Trả về None nếu không chuyển được.
    """
    if raw is None:
        return None
    # direct numeric
    if isinstance(raw, (int, float)):
        return float(raw)
    # numpy / torch scalar-like
    if hasattr(raw, "item"):
        try:
            return float(raw.item())
        except Exception:
            pass
    # list / tuple: dùng phần tử số đầu tiên khả thi
    if isinstance(raw, (list, tuple)):
        for it in raw:
            s = _extract_score(it)
            if s is not None:
                return s
        return None
    # dict: thử các key phổ biến rồi values
    if isinstance(raw, dict):
        for key in ("score", "scores", "value", "prob"):
            if key in raw:
                s = _extract_score(raw[key])
                if s is not None:
                    return s
        for v in raw.values():
            s = _extract_score(v)
            if s is not None:
                return s
        return None
    # try cast
    try:
        return float(raw)
    except Exception:
        return None


class Document:
    def __init__(self, page_content: str, metadata: Optional[Dict[str, Any]] = None):
        self.page_content = str(page_content)
        self.metadata = metadata or {}

    def __repr__(self):
        return f"{self.page_content}"


class RAGService:
    _reranker_instance = None
    _qwen_model_instance = None

    def __init__(self):
        self.chroma_remote_url = Config.CHROMA_REMOTE_URL
        self.chroma_local_path = Config.CHROMA_LOCAL_PATH
        self.m3test_path = "C:\\Users\\admin\\Downloads\\M3Test"
        os.makedirs(self.chroma_local_path, exist_ok=True)
        
        # Local persistent clients
        self.local_chroma = chromadb.PersistentClient(path=self.chroma_local_path)
        
        if os.path.exists(self.m3test_path):
            try:
                self.m3test_chroma = chromadb.PersistentClient(path=self.m3test_path)
            except Exception:
                self.m3test_chroma = None
        else:
            self.m3test_chroma = None

        # Embedder BGE-M3 chuyên biệt cho Vector Search (1024 dims)
        self.bge_ef = OllamaBgeM3EmbeddingFunction(
            endpoint=Config.OLLAMA_REMOTE_URL,
            model=Config.EMBEDDING_MODEL
        )

    @classmethod
    def get_reranker(cls):
        """Khởi tạo FlagReranker BAAI/bge-reranker-v2-m3 theo kiểu Singleton."""
        if cls._reranker_instance is None:
            print("[RAGService] Đang tải mô hình BAAI/bge-reranker-v2-m3 (FlagReranker)...")
            from FlagEmbedding import FlagReranker
            try:
                import torch
                use_fp16 = torch.cuda.is_available()
            except Exception:
                use_fp16 = False
            cls._reranker_instance = FlagReranker(Config.RERANKER_MODEL, use_fp16=use_fp16)
            print("[RAGService] BGE-Reranker đã sẵn sàng!")
        return cls._reranker_instance

    def get_db_connection(self):
        """Kết nối tới PostgreSQL Neon DB (VanBan)."""
        return psycopg2.connect(
            database=Config.DB_NAME,
            user=Config.DB_USER,
            password=Config.DB_PASS,
            host=Config.DB_HOST,
            port=Config.DB_PORT,
            sslmode="require",
            connect_timeout=6
        )

    def get_available_collections(self, username: Optional[str] = None, role: str = "user") -> List[Dict[str, Any]]:
        """Lấy danh sách các collections từ cả Neon DB, M3Test và Local Chroma có phân quyền."""
        is_admin = (role == "admin" or (username and username.lower() == "admin"))
        collections_map = {}
        
        # 1. Từ Neon DB
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            if is_admin:
                cur.execute("SELECT tencollection, COUNT(*), COALESCE(MAX(uploader), 'system') FROM appdatabase GROUP BY tencollection")
            else:
                user_filter = username if username else "system"
                cur.execute(
                    """
                    SELECT tencollection, COUNT(*), COALESCE(MAX(uploader), 'system') 
                    FROM appdatabase 
                    WHERE LOWER(uploader) = LOWER(%s) OR uploader = 'system' OR uploader IS NULL 
                    GROUP BY tencollection
                    """,
                    (user_filter,)
                )
            rows = cur.fetchall()
            for r in rows:
                col_name = str(r[0]).strip()
                uploader_name = str(r[2]).strip()
                if col_name:
                    collections_map[col_name] = {
                        "name": col_name,
                        "source": f"Neon DB ({uploader_name})",
                        "doc_count": r[1],
                        "type": "text",
                        "uploader": uploader_name
                    }
            cur.close()
            conn.close()
        except Exception as e:
            print(f"[RAGService] Lỗi đọc collections từ Neon DB: {e}")

        # 2. Từ M3Test Chroma (Multimodal)
        if self.m3test_chroma:
            try:
                for col in self.m3test_chroma.list_collections():
                    collections_map[col.name] = {
                        "name": col.name,
                        "source": "M3Test (Multimodal / Ảnh)",
                        "doc_count": col.count(),
                        "type": "multimodal",
                        "uploader": "system"
                    }
            except Exception:
                pass

        # 3. Từ Local ChromaDB
        try:
            local_cols = self.local_chroma.list_collections()
            for col in local_cols:
                if col.name not in collections_map:
                    collections_map[col.name] = {
                        "name": col.name,
                        "source": "Tài liệu cục bộ (Chroma Local)",
                        "doc_count": col.count(),
                        "type": "local",
                        "uploader": "local"
                    }
        except Exception as e:
            print(f"[RAGService] Lỗi đọc local chroma: {e}")

        # Fallback danh sách mặc định nếu rỗng
        if not collections_map:
            defaults = ["m3docdep", "20PP", "ppdhc", "cpro1", "MD4THPT", "TLTHTH"]
            for d in defaults:
                collections_map[d] = {"name": d, "source": "Mặc định hệ thống", "doc_count": 1, "type": "text", "uploader": "system"}

        return list(collections_map.values())

    # ==========================================
    # 1. VECTOR SEARCH (Ollama BGE-M3 + Chroma)
    # ==========================================
    def vector_search(self, query: str, collection_name: str) -> List[Document]:
        """
        Trả về list[Document] từ ChromaDB (Ollama Embeddings bge-m3 1024 dims).
        Tuyệt đối không sử dụng all-MiniLM-L6-v2.
        """
        vector_result = []

        # 1. Tính query embedding với Ollama bge-m3 từ xa (1024 dims)
        query_embeddings = None
        try:
            embs = self.bge_ef([query])
            if embs and len(embs) > 0 and len(embs[0]) == 1024:
                query_embeddings = embs
        except Exception as qe_err:
            print(f"[RAGService] Lỗi tính bge-m3 query embedding: {qe_err}")

        # 2. Thử tìm trên Remote ChromaDB
        if query_embeddings:
            try:
                chroma_client = chromadb.HttpClient(host=self.chroma_remote_url)
                collection = chroma_client.get_collection(
                    name=collection_name,
                    embedding_function=self.bge_ef
                )
                results = collection.query(query_embeddings=query_embeddings, n_results=30)
                docs_lists = results.get('documents', [])
                for docs in docs_lists:
                    if isinstance(docs, (list, tuple)):
                        for d in docs:
                            vector_result.append(Document(str(d), {"source": f"Chroma/{collection_name}"}))
                    else:
                        vector_result.append(Document(str(docs), {"source": f"Chroma/{collection_name}"}))
                if vector_result:
                    return vector_result
            except Exception as e:
                print(f"[RAGService] Vector search remote error '{collection_name}': {e}")

        # 3. Fallback sang Local Chroma
        try:
            col = self.local_chroma.get_collection(
                name=collection_name,
                embedding_function=self.bge_ef
            )
            count = col.count()
            if count > 0:
                if query_embeddings:
                    res = col.query(query_embeddings=query_embeddings, n_results=min(30, count))
                else:
                    res = col.query(query_texts=[query], n_results=min(30, count))

                docs_lists = res.get('documents', [[]])[0]
                metas = res.get('metadatas', [[]])[0]
                for idx, doc in enumerate(docs_lists):
                    meta = metas[idx] if idx < len(metas) else {}
                    vector_result.append(Document(str(doc), meta))
        except Exception as le:
            print(f"[RAGService] Vector search local error '{collection_name}': {le}")

        return vector_result

    # ==========================================
    # 2. BM25 SEARCH (PostgreSQL Neon + Text Splitter)
    # ==========================================
    def BM25_search(self, query: str, collection_name: str) -> List[Document]:
        """
        Trả về list[Document] từ PostgreSQL Neon DB + BM25Okapi theo thuật toán gốc.
        """
        corpus = []

        # Lấy văn bản từ PostgreSQL Neon
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute(f"SELECT doc FROM appdatabase WHERE tencollection = '{collection_name}'")
            rows = cur.fetchall()
            conn.close()

            text = " ".join([str(r[0]) for r in rows if r and r[0]]) if rows else ""
            if text:
                # Dùng CharacterTextSplitter như thuật toán trong file gốc
                text_splitter = CharacterTextSplitter(
                    separator="\n\n",
                    chunk_size=1000,
                    chunk_overlap=200,
                    length_function=len,
                    is_separator_regex=False,
                )
                splits = text_splitter.create_documents([text])
                corpus = [str(s.page_content) for s in splits]
        except Exception as e:
            print(f"[RAGService] BM25 Neon DB error '{collection_name}': {e}")

        # Fallback nếu Neon không có, thử lấy từ Local Chroma
        if not corpus:
            try:
                col = self.local_chroma.get_collection(name=collection_name)
                all_data = col.get(include=['documents'])
                corpus = all_data.get('documents', [])
            except Exception:
                pass

        if not corpus:
            return []

        tokenized_corpus = [doc.split() for doc in corpus]
        bm25 = BM25Okapi(tokenized_corpus)
        tokenized_query = query.split()

        if not tokenized_query:
            return [Document(d, {"source": f"BM25/{collection_name}"}) for d in corpus[:30]]

        top_docs = bm25.get_top_n(tokenized_query, corpus, n=30)
        return [Document(d, {"source": f"BM25/{collection_name}"}) for d in top_docs]

    # ==========================================
    # 3. HYBRID RERANK (FlagReranker BGE-v2-m3)
    # ==========================================
    def hybrid_rerank(
        self,
        query: str,
        bm25_results: List[Document],
        vector_results: List[Document],
        score_threshold: float = 0.30
    ) -> List[Tuple[Document, float]]:
        """
        Rerank trực tiếp các chunk document từ BM25 + Vector search bằng BAAI/bge-reranker-v2-m3.
        Lọc các chunk có score < threshold và sắp xếp giảm dần.
        """
        all_docs = bm25_results + vector_results
        scored_results = []
        reranker = self.get_reranker()

        for doc in all_docs:
            text = str(doc.page_content).lower().strip()
            if not text:
                continue

            try:
                raw_score = reranker.compute_score([query, text], normalize=True)
                score = _extract_score(raw_score)
            except Exception:
                score = 0.5

            if score is not None and score >= score_threshold:
                scored_results.append((doc, float(score)))

        # Sắp xếp giảm dần theo điểm số
        scored_results.sort(key=lambda x: x[1], reverse=True)
        return scored_results

    # ==========================================
    # 4. CHROMA MULTIMODAL QUERY (Truy xuất ảnh từ M3Test)
    # ==========================================
    def chroma_multimodal_query(self, user_query: str, collection_name: str = "m3docdep") -> List[str]:
        """
        Truy xuất các ảnh liên quan từ M3Test ChromaDB và mã hóa Base64 theo thuật toán gốc từ file flask_server_reranker_multimodal.py.
        """
        if not self.m3test_chroma:
            return []

        try:
            collection = self.m3test_chroma.get_collection(name=collection_name)
            encoded_strings = []

            # Lấy toàn bộ items và metadata trong collection
            data = collection.get(include=['metadatas'])
            if not data or not data.get('ids'):
                return []

            q_lower = user_query.lower()
            matches = []

            # 1. Trích xuất số trang (nếu có): e.g. "trang 10", "page 12", "p15"
            page_match = re.search(r'(?:trang|page|p)[\s_]*(\d+)', q_lower)
            target_page = page_match.group(1) if page_match else None

            # 2. Nhận diện loại ảnh trong câu hỏi: bảng biểu vs hình ảnh sơ đồ
            is_table = any(k in q_lower for k in ['bang', 'bảng', 'bieu', 'biểu', 'table', 'so do', 'sơ đồ', 'thong ke', 'thống kê'])
            is_image = any(k in q_lower for k in ['hinh', 'hình', 'anh', 'ảnh', 'image', 'photo', 'diagram', 'chart', 'minh hoa', 'minh họa'])

            for i, item_id in enumerate(data['ids']):
                score = 0
                id_lower = item_id.lower()
                if target_page and f'trang{target_page}' in id_lower:
                    score += 15
                if is_table and ('bang' in id_lower or 'bieu' in id_lower):
                    score += 5
                if is_image and ('hinh' in id_lower or 'anh' in id_lower):
                    score += 5

                meta = data['metadatas'][i] if i < len(data['metadatas']) else {}
                img_path = meta.get('source') if meta else None
                if img_path and os.path.exists(img_path):
                    if score > 0:
                        matches.append((score, img_path))

            matches.sort(key=lambda x: x[0], reverse=True)
            top_paths = [m[1] for m in matches[:2]]

            if not top_paths:
                # Fallback: Lấy 2 ảnh đầu tiên nếu không có match cụ thể
                top_paths = [m['source'] for m in data['metadatas'][:2] if m and 'source' in m and os.path.exists(m['source'])]

            for path in top_paths:
                try:
                    with open(path, "rb") as img_file:
                        encoded_strings.append(base64.b64encode(img_file.read()).decode('utf-8'))
                except Exception as read_err:
                    print(f"[Multimodal] Lỗi đọc ảnh {path}: {read_err}")

            return encoded_strings
        except Exception as e:
            print(f"[Multimodal] Lỗi chroma_multimodal_query: {e}")
            return []

    # ==========================================
    # 5. RETRIEVE TỪ 1 HOẶC NHIỀU TÀI LIỆU (colname.split('+'))
    # ==========================================
    def retrieve_multi_collections(
        self,
        query: str,
        collection_names: Any,
        score_threshold: float = 0.30,
        top_k: int = 5
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        """
        Thực hiện RAG Hybrid Search trên 1 hoặc NHIỀU collection/tài liệu:
        - Tách collection_names theo dấu '+' hoặc nhận danh sách list.
        - Chạy vector_search + BM25_search trên từng collection.
        - Gộp và rerank bằng BGE-Reranker.
        - Trả về: (context_chunks_list, encoded_images, combined_result_json_str).
        """
        if isinstance(collection_names, list):
            col_list = [str(c).strip() for c in collection_names if str(c).strip()]
        elif isinstance(collection_names, str):
            col_list = [c.strip() for c in collection_names.split("+") if c.strip()]
        else:
            col_list = ["m3docdep"]

        if not col_list:
            col_list = ["m3docdep"]

        print(f"[RAG Multi] Đang truy xuất từ {len(col_list)} collections: {col_list}")

        v_combined = []
        bm25_combined = []
        encoded_images = []

        for col in col_list:
            # 1. Vector Search
            v_docs = self.vector_search(query, col)
            v_combined.extend(v_docs)

            # 2. BM25 Search
            b_docs = self.BM25_search(query, col)
            bm25_combined.extend(b_docs)

            # 3. Multimodal Search nếu là collection m3docdep hoặc có ảnh
            if "m3doc" in col.lower() or "image" in col.lower():
                imgs = self.chroma_multimodal_query(query, col)
                if imgs:
                    encoded_images.extend(imgs[:2])

        # 4. Rerank hợp nhất
        scored_tuples = self.hybrid_rerank(
            query=query,
            bm25_results=bm25_combined,
            vector_results=v_combined,
            score_threshold=score_threshold
        )

        # Lấy Top K kết quả tốt nhất
        top_scored = scored_tuples[:top_k]

        context_chunks = []
        for doc, score in top_scored:
            source_info = doc.metadata.get("source", "Tài liệu hệ thống")
            context_chunks.append({
                "text": doc.page_content,
                "score": round(score, 4),
                "source": source_info
            })

        # Chuyển combined_result thành chuỗi JSON an toàn để lưu Database
        combined_result_str = json.dumps(
            [{"text": str(d.page_content), "score": float(s)} for d, s in top_scored],
            ensure_ascii=False
        )

        return context_chunks, encoded_images[:4], combined_result_str

    # ==========================================
    # 6. LƯU LOG VÀO BẢNG RAGHISTORY CỦA NEON DB
    # ==========================================
    def log_rag_history(
        self,
        user_message: str,
        username: str,
        bot_reply: str,
        colname: str,
        combined_result_str: str = ""
    ):
        """
        Lưu lịch sử hỏi đáp và kết quả rerank vào bảng raghistory của Neon PostgreSQL
        theo đúng định dạng trong code gốc của người dùng.
        """
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            
            # Ghi log câu hỏi người dùng
            cur.execute(f"""
            INSERT INTO raghistory VALUES ($${user_message}$$, '{username}', $$'{user_message}'$$, $$'WebUser'$$, $$'{colname}'$$)
            """)
            
            # Ghi log câu trả lời của AI và kết quả trích xuất
            if combined_result_str:
                cur.execute(f"""
                INSERT INTO raghistory VALUES ($${user_message}$$, '{username}', $$'{bot_reply}'$$, $$'WebAI'$$, $$'{colname}'$$, $${combined_result_str}$$)
                """)
            else:
                cur.execute(f"""
                INSERT INTO raghistory VALUES ($${user_message}$$, '{username}', $$'{bot_reply}'$$, $$'WebAI'$$, $$'{colname}'$$)
                """)

            conn.commit()
            cur.close()
            conn.close()
            print("[RAGService] Đã lưu log thành công vào bảng raghistory (Neon DB).")
        except Exception as e:
            print(f"[RAGService] Lỗi khi lưu log vào raghistory: {e}")

    # ==========================================
    # 7. NẠP CHUNKS VÀO LOCAL CHROMADB
    # ==========================================
    def add_document_chunks_to_collection(
        self,
        collection_name: str,
        chunks: List[str],
        metadatas: Optional[List[Dict[str, Any]]] = None
    ) -> bool:
        """Nạp các chunks văn bản mới vào ChromaDB cục bộ sử dụng mô hình bge-m3."""
        try:
            col = self.local_chroma.get_or_create_collection(
                name=collection_name,
                embedding_function=self.bge_ef
            )
            embeddings = self.bge_ef(chunks)
            ids = [f"{collection_name}_chunk_{i}_{os.urandom(4).hex()}" for i in range(len(chunks))]
            col.add(
                documents=chunks,
                embeddings=embeddings,
                metadatas=metadatas or [{"collection": collection_name, "source": collection_name} for _ in chunks],
                ids=ids
            )
            print(f"[RAGService] Đã nạp thành công {len(chunks)} chunks vào collection '{collection_name}' với bge-m3!")
            return True
        except Exception as e:
            print(f"[RAGService] Lỗi nạp chunks vào collection: {e}")
            return False
