# -*- coding: utf-8 -*-
"""
Created on Mon Jul 28 07:56:30 2025

@author: Ha Viet Nguyen
"""
from flask import Flask, jsonify, request, Response, session, stream_with_context
from rank_bm25 import BM25Okapi
import chromadb
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_ollama import OllamaEmbeddings
from flask_cors import CORS
import requests
import json
import psycopg2
from flask_caching import Cache
from collections import defaultdict
from typing import List, Dict, Tuple
from FlagEmbedding import FlagReranker
from google import genai
from openai import OpenAI

# ----- Config / Init -----
app = Flask(__name__)
CORS(app)
app.config["CACHE_TYPE"] = "SimpleCache"
app.config["CACHE_DEFAULT_TIMEOUT"] = 300
cache = Cache(app)
app.secret_key = 'secret_key'

DB_NAME = "VanBan"
DB_USER = "VanBan_owner"
DB_PASS = "I8Qjk7txvbou"
DB_HOST = "ep-solitary-surf-a1x7p6aa.ap-southeast-1.aws.neon.tech"
DB_PORT = "5432"

# Reranker (1 lần)
reranker = FlagReranker('BAAI/bge-reranker-v2-m3', use_fp16=True)


class Document:
    def __init__(self, page_content: str):
        self.page_content = page_content

    def __repr__(self):
        return f"{self.page_content}"


@app.route('/', methods=['GET', 'POST'])
def home():
    if request.method == 'GET':
        return jsonify({'data': "hello world"})


# ----- Helpers -----
def _extract_score(raw) -> float:
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


# ----- Search functions -----
def vector_search(query, collection_name):
    """
    Trả về list[Document] từ Chroma (mỗi Document.page_content là str).
    """
    embedder = OllamaEmbeddings(
        model="bge-m3",
        base_url="https://chatbot.tail36da8e.ts.net:10000"
    )
    embedding = embedder.embed_query(query)

    chroma_client = chromadb.HttpClient(
        host='https://chatbot.tail36da8e.ts.net:10000/chromadb', port=8000
    )
    collection = chroma_client.get_collection(name=collection_name)
    results = collection.query(query_embeddings=[embedding], n_results=30)

    vector_result = []
    # results['documents'] thường là list-of-lists (one per query); iterate safely
    docs_lists = results.get('documents', [])
    for docs in docs_lists:
        # docs may be a list of strings
        if isinstance(docs, (list, tuple)):
            for d in docs:
                vector_result.append(Document(str(d)))
        else:
            vector_result.append(Document(str(docs)))
    return vector_result


def BM25_search(query, collection_name):
    """
    Trả về list[Document] từ PostgreSQL + BM25.
    """
    conn = psycopg2.connect(database=DB_NAME,
                            user=DB_USER,
                            password=DB_PASS,
                            host=DB_HOST,
                            port=DB_PORT,
                            sslmode='require')
    cur = conn.cursor()
    cur.execute(f"""
        select doc from appdatabase where tencollection = '{collection_name}'
        """)
    rows = cur.fetchall()
    conn.close()

    # Join tất cả văn bản trong collection
    text = " ".join([str(r[0]) for r in rows]) if rows else ""
    if not text:
        return []

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1024,
        chunk_overlap=200,
        separators=["\n```", "\n#", "\n- ", "\n* ", "\n> ", "\n\n", "\n", " ", ""]
    )
    splits = text_splitter.create_documents([text])

    corpus = [str(s.page_content) for s in splits]
    tokenized_corpus = [doc.split() for doc in corpus]

    bm25 = BM25Okapi(tokenized_corpus)
    tokenized_query = query.split()
    top_docs = bm25.get_top_n(tokenized_query, corpus, n=30)

    return [Document(d) for d in top_docs]

def hybrid_rerank(
    query: str,
    bm25_results: List,
    vector_results: List,
    score_threshold: float = 0.4  # threshold 0.1
) -> List[Tuple[object, float]]:
    """
    Rerank trực tiếp các chunk document từ BM25 + Vector search.
    Lọc các chunk có score < threshold.
    """
    all_docs = bm25_results + vector_results
    scored_results = []

    for doc in all_docs:
        text = str(doc.page_content).lower().strip()
        score = reranker.compute_score([query, text], normalize=True)
        # Convert score nếu là list/tuple
        if isinstance(score, (list, tuple)):
            score = float(score[0])

        #if score >= score_threshold:
            #scored_results.append((doc, score))

        if score >= score_threshold:
            scored_results.append((doc, score))

    # Sắp xếp giảm dần theo score
    scored_results.sort(key=lambda x: x[1], reverse=True)
    return scored_results


# ----- API endpoint -----
@app.route("/messages", methods=['POST'])
def disp3():
    username = 'web'
    v_combined = []
    bm25_combined = []

    data = request.get_json()
    user_message = data.get("message", "")
    colname = data.get("collectionName", "")

    # Lưu log user message (đơn giản theo cấu trúc cũ của bạn)
    conn = psycopg2.connect(database=DB_NAME,
                            user=DB_USER,
                            password=DB_PASS,
                            host=DB_HOST,
                            port=DB_PORT,
                            sslmode='require')
    cur = conn.cursor()
    cur.execute(f"""
    insert into raghistory values ($${user_message}$$, '{username}', $$'{user_message}'$$, $$'WebUser'$$, $$'{colname}'$$)
    """)
    conn.commit()
    conn.close()

    result = colname.split("+")
    print(result)
    for r in result:
        # mỗi vòng chỉ lấy docs từ nguồn đó, không dùng biến tạm cộng dồn sai
        v_docs = vector_search(user_message, r)
        bm25_docs = BM25_search(user_message, r)
        v_combined += v_docs
        bm25_combined += bm25_docs

    combined_result = hybrid_rerank(query=user_message, bm25_results=bm25_combined, vector_results=v_combined)
    print('--------------------------------------------------------')
    print(combined_result)  # list of (Document, score)

    # Chuyển combined_result thành chuỗi JSON an toàn để chèn DB / debug
    combined_result_str = json.dumps(
        [{"text": str(d.page_content), "score": float(s)} for d, s in combined_result],
        ensure_ascii=False
    )

    rag_prompt = f"Trả lời câu hỏi sau với dữ liệu được cung cấp: {user_message} Dữ liệu: {combined_result}"

    if 'chat_history' not in session:
        session['chat_history'] = []

    OLLAMA_API_URL = "https://chatbot.tail36da8e.ts.net:10000/api/chat"

    @stream_with_context
    def generate():
        with requests.post(
            OLLAMA_API_URL,
            json={
                "model": "gpt-oss",
                "messages": session['chat_history'] + [{"role": "user", "content": rag_prompt}],
                "stream": True
            },
            stream=True
        ) as r:
            bot_reply = ""
            for chunk in r.iter_lines(decode_unicode=True):
                if chunk:
                    try:
                        parsed = json.loads(chunk)
                        token = parsed.get("message", {}).get("content", "")
                        if token:
                            bot_reply += token
                            yield token
                    except json.JSONDecodeError as e:
                        yield f"[stream_error: JSON lỗi tại chunk: {str(e)}]"

            # update history + lưu kết quả (lưu combined_result_str để dễ đọc)
            session['chat_history'].append({'role': 'user', 'content': user_message})
            session['chat_history'].append({'role': 'assistant', 'content': bot_reply})

            conn = psycopg2.connect(database=DB_NAME,
                                user=DB_USER,
                                password=DB_PASS,
                                host=DB_HOST,
                                port=DB_PORT,
                                sslmode='require')
            cur = conn.cursor()
            cur.execute(f"""
            insert into raghistory values ($${user_message}$$, '{username}', $$'{bot_reply}'$$, $$'WebAI'$$, $$'{colname}'$$, $${combined_result_str}$$)
            """)
            conn.commit()
            conn.close()

    return Response(generate(), content_type="text/plain")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)


@app.route("/messagess", methods= ['POST'])
#@app.route("/message/[Variable]", methods= ['POST'])
def disp2():
    data = request.get_json()
    user_message = data.get("message", "")
    colname = data.get("collectionName", "")
    conn = psycopg2.connect(database='neondb',
                        user='neondb_owner',
                        password='npg_q7UgMQ6EcrhC',
                        host='ep-withered-sound-a1m5gt8k-pooler.ap-southeast-1.aws.neon.tech',
                        port=DB_PORT,
                        sslmode='require')
    cur = conn.cursor()
    cur.execute(f"""
        SELECT "model_name " FROM public.appdatabase WHERE tencollection = '{colname}'
        """)
    a=cur.fetchall()
    model = str(a[0][0])
    vector_search_result = vector_search(user_message, colname)
    bm25_result = BM25_search(user_message, colname)
    combined_result = hybrid_rerank(bm25_result, vector_search_result)
    print ('--------------------------------------------------------')
    print (combined_result)
    OLLAMA_API_URL = "https://chatbot.tail36da8e.ts.net:10000/api/chat"
    # Gọi API Ollama với stream=True
    # Khởi tạo lịch sử nếu chưa có
    rag_prompt = f"Trả lời câu hỏi sau với dữ liệu được cung cấp: {user_message} Dữ liệu: {combined_result}"
    if 'chat_history' not in session:
        session['chat_history'] = []

    @stream_with_context
    def generate():
        with requests.post(
            OLLAMA_API_URL,
            json={
                "model": model,
                "messages": session['chat_history'] + [{"role": "user", "content": rag_prompt}],
                "stream": True
            },
            stream=True
        ) as r:
            buffer = ""
            bot_reply = ""
            for chunk in r.iter_lines(decode_unicode=True):
                if chunk:
                    try:
                        parsed = json.loads(chunk)
                        token = parsed.get("message", {}).get("content", "")
                        if token:
                            bot_reply += token
                            yield token
                    except json.JSONDecodeError as e:
                        yield f"[stream_error: JSON lỗi tại chunk: {str(e)}]"

            # Sau khi stream xong, cập nhật vào session
            session['chat_history'].append({'role': 'user', 'content': user_message})
            session['chat_history'].append({'role': 'assistant', 'content': bot_reply})
    
    return Response(generate(), content_type="text/plain")
    #return jsonify({"reply": bm25_result})

# 1. Cấu hình API Keys (Nên dùng biến môi trường os.environ trong thực tế)
genai.configure(api_key="AIzaSyDAOtgdRICLA9zPXp7qaTovM0De0mM-ssc")
openai_client = OpenAI(api_key="YOUR_OPENAI_API_KEY")

# Đường link dạng: abc.xyz/cloudmodel/cau_hoi_cua_user/ten_model
@app.route("/cloudmodel/<user_message>/<model_name>", methods=['GET', 'POST'])
def disp(user_message, model_name):
    
    # Khởi tạo lịch sử nếu chưa có
    if 'chat_history' not in session:
        session['chat_history'] = []

    model_name_lower = model_name.lower()

    # ==========================================
    # LUỒNG 1: XỬ LÝ CHO GOOGLE GEMINI
    # ==========================================
    if 'gemini' in model_name_lower:
        @stream_with_context
        def generate_gemini():
            # Chuyển đổi lịch sử cho Gemini (role: user/model)
            gemini_history = []
            for msg in session['chat_history']:
                role = 'user' if msg['role'] == 'user' else 'model'
                gemini_history.append({'role': role, 'parts': [msg['content']]})

            try:
                # Sử dụng chính tên model truyền vào (VD: gemini-1.5-flash)
                model = genai.GenerativeModel(model_name)
                chat = model.start_chat(history=gemini_history)
                
                response = chat.send_message(user_message, stream=True)
                bot_reply = ""
                
                for chunk in response:
                    if chunk.text:
                        bot_reply += chunk.text
                        yield chunk.text
                        
                # Lưu lịch sử
                session['chat_history'].append({'role': 'user', 'content': user_message})
                session['chat_history'].append({'role': 'assistant', 'content': bot_reply})
                session.modified = True 
                
            except Exception as e:
                yield f"[stream_error: Lỗi từ Google Gemini API: {str(e)}]"

        return Response(generate_gemini(), content_type="text/plain; charset=utf-8")

    # ==========================================
    # LUỒNG 2: XỬ LÝ CHO OPENAI GPT
    # ==========================================
    elif 'gpt' in model_name_lower:
        @stream_with_context
        def generate_gpt():
            # OpenAI dùng chuẩn 'user' và 'assistant', nên có thể dùng thẳng history
            messages = session['chat_history'] + [{"role": "user", "content": user_message}]
            
            try:
                # Sử dụng chính tên model truyền vào (VD: gpt-4o, gpt-3.5-turbo)
                stream = openai_client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    stream=True,
                )
                bot_reply = ""
                
                for chunk in stream:
                    # Lấy text từ chunk của OpenAI
                    if chunk.choices[0].delta.content is not None:
                        token = chunk.choices[0].delta.content
                        bot_reply += token
                        yield token
                        
                # Lưu lịch sử
                session['chat_history'].append({'role': 'user', 'content': user_message})
                session['chat_history'].append({'role': 'assistant', 'content': bot_reply})
                session.modified = True
                
            except Exception as e:
                yield f"[stream_error: Lỗi từ OpenAI API: {str(e)}]"

        return Response(generate_gpt(), content_type="text/plain; charset=utf-8")

    # ==========================================
    # LUỒNG 3: MODEL KHÔNG HỢP LỆ
    # ==========================================
    else:
        return Response("Lỗi: Tên model không được hỗ trợ. Vui lòng sử dụng model có chứa từ 'gemini' hoặc 'gpt'.", status=400)
    #return jsonify({"reply": bm25_result})
# driver function
@app.route("/messages", methods=['POST'])
def disp3():
    username = 'web'
    v_combined = []
    bm25_combined = []

    data = request.get_json()
    user_message = data.get("message", "")
    colname = data.get("collectionName", "")

    # Lưu log user message (đơn giản theo cấu trúc cũ của bạn)
    conn = psycopg2.connect(database=DB_NAME,
                            user=DB_USER,
                            password=DB_PASS,
                            host=DB_HOST,
                            port=DB_PORT,
                            sslmode='require')
    cur = conn.cursor()
    cur.execute(f"""
    insert into raghistory values ($${user_message}$$, '{username}', $$'{user_message}'$$, $$'WebUser'$$, $$'{colname}'$$)
    """)
    conn.commit()
    conn.close()

    result = colname.split("+")
    print(result)
    for r in result:
        # mỗi vòng chỉ lấy docs từ nguồn đó, không dùng biến tạm cộng dồn sai
        v_docs = vector_search(user_message, r)
        bm25_docs = BM25_search(user_message, r)
        v_combined += v_docs
        bm25_combined += bm25_docs

    combined_result = hybrid_rerank(query=user_message, bm25_results=bm25_combined, vector_results=v_combined)
    print('--------------------------------------------------------')
    print(combined_result)  # list of (Document, score)

    # Chuyển combined_result thành chuỗi JSON an toàn để chèn DB / debug
    combined_result_str = json.dumps(
        [{"text": str(d.page_content), "score": float(s)} for d, s in combined_result],
        ensure_ascii=False
    )

    rag_prompt = f"Trả lời câu hỏi sau với dữ liệu được cung cấp: {user_message} Dữ liệu: {combined_result}"

    if 'chat_history' not in session:
        session['chat_history'] = []

    OLLAMA_API_URL = "https://chatbot.tail36da8e.ts.net:10000/api/chat"

    @stream_with_context
    def generate():
        with requests.post(
            OLLAMA_API_URL,
            json={
                "model": "gpt-oss",
                "messages": session['chat_history'] + [{"role": "user", "content": rag_prompt}],
                "stream": True
            },
            stream=True
        ) as r:
            bot_reply = ""
            for chunk in r.iter_lines(decode_unicode=True):
                if chunk:
                    try:
                        parsed = json.loads(chunk)
                        token = parsed.get("message", {}).get("content", "")
                        if token:
                            bot_reply += token
                            yield token
                    except json.JSONDecodeError as e:
                        yield f"[stream_error: JSON lỗi tại chunk: {str(e)}]"

            # update history + lưu kết quả (lưu combined_result_str để dễ đọc)
            session['chat_history'].append({'role': 'user', 'content': user_message})
            session['chat_history'].append({'role': 'assistant', 'content': bot_reply})

            conn = psycopg2.connect(database=DB_NAME,
                                user=DB_USER,
                                password=DB_PASS,
                                host=DB_HOST,
                                port=DB_PORT,
                                sslmode='require')
            cur = conn.cursor()
            cur.execute(f"""
            insert into raghistory values ($${user_message}$$, '{username}', $$'{bot_reply}'$$, $$'WebAI'$$, $$'{colname}'$$, $${combined_result_str}$$)
            """)
            conn.commit()
            conn.close()

    return Response(generate(), content_type="text/plain")


if __name__ == '__main__':

    app.run(debug = True)