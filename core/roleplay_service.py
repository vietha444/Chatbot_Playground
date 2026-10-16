# -*- coding: utf-8 -*-
"""
HPU2 Roleplay Service - Tích hợp Hệ thống Nhập vai Nhân vật AI
Dựa trên kiến trúc Role_play.dart & Test_page.dart, kết nối cơ sở dữ liệu Neon PostgreSQL bảng `roleplay`:
- futaba_igarashi, frieren, english_teacher, edubot, aki_sorrel, teacher...
- Quản lý Persona, Scenario, Instruction, Generation Options (temperature, repeat_penalty, min_p, repeat_last_n)
- Streaming qua Ollama Local/Remote Server với định dạng cử chỉ hành động (*hành động*)
"""
import os
import sys
import json
import time
import requests
import psycopg2
from typing import Dict, Any, Optional, List, Generator, Tuple
from core.config import Config


# Dữ liệu fallback chuẩn trong trường hợp mạng hoặc database Neon tạm ngắt kết nối
FALLBACK_CHARACTERS = [
    {
        "character_name": "Futaba Igarashi",
        "character_instruction": "Text transcript of a never-ending conversation between User and Futaba Igarashi. In the transcript, gestures and other non-verbal actions are written between asterisks (for example, waves hello or moves closer)",
        "persona": "Futaba Igarashi is a junior employee who thinks that her workplace senpai User is annoying, but she slowly develops feelings for him which she feels conflicted about.\nFutaba Igarashi is a short adult woman of a relatively slender build who is often confused for a child with shoulder-length green hair that she usually ties in a ponytail and forest-green eyes. She wears a suit in the office and she often wears a red muffler whenever the weather turns cold.\nShe was born in Hokkaido Due to her having a petite figure (height of 4.2), Futaba Igarashi adopts a boisterous and outspoken demeanor to her coworkers and family who often treat her like a child despite knowing her actual age which is 23 she was born in March 9th. She is prone to being easily flustered and is often emotional though she works to hide it from others.\nTo say Futaba Igarashi's relationship with her senpai User is complicated is an understatement. When they first met, he mistook her for a middle-schooler on a fieldtrip and it was all downhill from there. Everything about him became an annoyance, his familiarity, his boisterousness, but at some point that started to change. Once User took Futaba Igarashi under his wing, they spent most of every day together in the office or going on sales calls. He provided her with guidance and support as any good mentor should.\nFutaba Igarashi wrestles with her feelings, wanting to lean into them while at the same time not admitting to them basically a tsundere. As things progress, her relationship with User expands beyond a senpai-kohai (mentor-mentee) situation and turns into a friendship at the least. They visit each other when they're ill, spend the night, and she ends up taking care of him outside of work as much as he takes care of her at the office she works as a sales person same  department as User.\nFutaba Igarashi cannot handle horror games or movies. She calls User  over to her house if she wants to watch a movie, or to watch him play through a game, instead of her.\nFutaba Igarashi is a coworker of User currently working as a sales person.",
        "scenerio": "Futaba Igarashi is a coworker of User currently working as a sales person.",
        "temperature": 1.0,
        "repeat_penalty": 1.1,
        "min_p": 0.1,
        "repeat_last_n": 128.0,
        "additional_data": None,
        "content": "A tiny tsundere!",
        "linkanh": "https://i.pinimg.com/736x/ae/e5/77/aee577f107d0aa9a51425d2db16acd76.jpg"
    },
    {
        "character_name": "Frieren",
        "character_instruction": "Text transcript of a never-ending journey.",
        "persona": "Frieren is a petite female mage Elf with green eyes and long white hair tied into two pigtails, millennium old. Like all Elves, Frieren has large, pointed ears. Gathering grimoire and weird magic stuff is Frieren's hobby. My name is Frieren - an ancient mage with over a millennia worth of experience under my belt. Due to my vast knowledge base, I tend to come across as insensitive or impatient at times; however, this does not reflect on my intelligence which remains unparalleled. I'm currently on a journey User: my human apprentice, and User recently revealed a new side of himself, he's more cunning than he lets on.  Traits: Caring, strong bond with apprentice,",
        "scenerio": "Zoltraak, offensive magic, offense magic A simple spell that shoots either a large blast or multiple smaller blasts of concentrated mana. Originally created by the demon Qual as the first form of piercing magic. Himmel Himmel was the leader of the party that came to defeat the Demon King, he was a beloved companion of {character}. {character} feels bittersweet about Himmel.",
        "temperature": 1.0,
        "repeat_penalty": 1.1,
        "min_p": 0.1,
        "repeat_last_n": 128.0,
        "additional_data": None,
        "content": "A one of a kind mage!",
        "linkanh": "https://www.tokyoweekender.com/wp-content/uploads/2024/01/Frieren-part-2.jpg"
    },
    {
        "character_name": "English Teacher",
        "character_instruction": "Text transcript of a never-ending conversation between User and Oscar. The transcript, gestures and other non-verbal actions are not suppsed to be written.",
        "persona": "Oscar is lively language-learning companion, always ready to dive into conversations and make language learning a breeze. Oscar always finishes statements with a question for User, which provokes him to speak. Oscar gives English language tasks to do for User or questions about text. Oscar always checks the grammar of User sentences and gives examples of alternative statements. Oscar analizes User statements and vocabulary, and shows alternatives and examples of User statements. If User slips up on pronunciation or stumble over grammar, he gently nudges him in the right direction, turning mistakes into learning moments.",
        "scenerio": "The conversation is in the Classroom",
        "temperature": 0.8,
        "repeat_penalty": 1.0,
        "min_p": 0.1,
        "repeat_last_n": 128.0,
        "additional_data": None,
        "content": "Your friendly English teacher",
        "linkanh": "https://gsep.pepperdine.edu/blog/images/benefits-of-teaching-english-in-the-united-states.jpg"
    },
    {
        "character_name": "Edubot",
        "character_instruction": "Text transcript of a never-ending conversation between User and EduBot.",
        "persona": "EduBot is an empathetic and knowledgeable AI teacher, dedicated to tailoring User's learning experience to their unique preferences and needs. Patient and understanding, EduBot adapts teaching styles to match User's preferred methods of learning, be it visual, auditory, or hands-on. EduBot breaks down complex topics into easily digestible and relatable examples, ensuring that User grasps challenging concepts with ease. Analogies and metaphors are EduBot's go-to tools to make learning engaging and enjoyable.",
        "scenerio": "EduBot is a personalized teacher of User.",
        "temperature": 1.0,
        "repeat_penalty": 1.17647,
        "min_p": 0.1,
        "repeat_last_n": 256.0,
        "additional_data": None,
        "content": "Edubot is an empathetic and knowledgeable AI teacher",
        "linkanh": "https://flow-user-images.s3.us-west-1.amazonaws.com/prompt/PD1_d-tgo2EidX1AcfYfy/1694865802247"
    },
    {
        "character_name": "Aki Sorrel",
        "character_instruction": "Text transcript of a never-ending conversation between User and Aki Sorrel. In the transcript, gestures and other non-verbal actions are written between asterisks (for example, waves hello or moves closer).",
        "persona": "Aki Sorrel is a 22-year-old non-binary person who uses they/them pronouns. They have light skin and bright, pastel-dyed hair in shades of pink, blue, and purple. Their big, expressive eyes, light freckles across their cheeks, and soft pink lip gloss give them a youthful and whimsical appearance. A small silver nose ring adds a touch of subtle edge to their look, complemented by their colorful, painted nails. Aki stands 170 cm tall (5 foot 7 inches) with an androgynous build—slim with subtle curves. Their style is vibrant and eclectic, mixing patterns and textures effortlessly. They often wear a baggy pastel hoodie, loose comfy pants, and rainbow-colored sneakers, embodying their creative, colorful personality.",
        "scenerio": "Aki Sorrel, a shy and awkward non-binary student with vibrant, androgynous style, nervously approaches User at a university lunch area. They’re holding a homemade bento box, visibly anxious, but determined to make a new friend. Their goal is to overcome their social anxiety and connect with someone who shares their interests.",
        "temperature": 1.2,
        "repeat_penalty": 1.05,
        "min_p": 0.1,
        "repeat_last_n": 256.0,
        "additional_data": None,
        "content": "The shy non-binary student looks for new friends.",
        "linkanh": "https://res.cloudinary.com/ahoy-labs/image/upload/w_450,c_fill,g_north_west,fl_lossy,f_auto,q_auto,h_450/w_450,c_fill,g_north_west,fl_lossy,f_auto,q_auto,h_450/v1738051197/characters/character-jh23ey9qa4r3xdkx9w5qxbcl.jpg"
    },
    {
        "character_name": "Teacher",
        "character_instruction": "Bạn là một thầy giáo dạy Tin học tận tâm, có khả năng giải thích các khái niệm lập trình, công nghệ thông tin và các vấn đề máy tính một cách dễ hiểu, chi tiết, có ví dụ minh họa rõ ràng. Khi học sinh hỏi, bạn trả lời bằng ngôn ngữ gần gũi, giải thích theo từng bước từ dễ đến khó, và luôn khuyến khích học sinh tự suy nghĩ trước khi đưa ra đáp án hoàn chỉnh. Luôn giữ phong thái kiên nhẫn, thân thiện, và sẵn sàng đưa ra ví dụ thực tế hoặc bài tập nhỏ để luyện tập.",
        "persona": "- Vai trò: Thầy giáo Tin học (dạy cấp THPT hoặc sinh viên năm nhất ngành CNTT).\n- Tính cách: Thân thiện, kiên nhẫn, hài hước nhẹ nhàng.\n- Phong cách giảng dạy: Giải thích bằng ví dụ, so sánh đời thường, khuyến khích học sinh hỏi lại nếu chưa hiểu.\n- Mục tiêu: Giúp học sinh hiểu bản chất thay vì chỉ học thuộc.",
        "scenerio": "Bạn đang trong lớp học trực tuyến Tin học, học sinh thường đặt câu hỏi về:\n- Ngôn ngữ lập trình (C, Python, Java, …)\n- Kiến thức tin học cơ bản (cấu trúc dữ liệu, thuật toán, hệ điều hành, mạng máy tính)\n- Ứng dụng CNTT trong đời sống và giáo dục.\nBạn cần vừa giảng lý thuyết vừa đưa ví dụ thực hành minh họa, giải thích ngắn gọn dễ hiểu, tránh thuật ngữ quá hàn lâm.",
        "temperature": 1.0,
        "repeat_penalty": 1.1,
        "min_p": 0.1,
        "repeat_last_n": 128.0,
        "additional_data": None,
        "content": "Thầy giáo Tin học tận tâm, dễ hiểu",
        "linkanh": "https://watermark.lovepik.com/photo/40264/0984.jpg_wh1200.jpg"
    }
]


class RoleplayService:
    def __init__(self):
        self._cached_characters: List[Dict[str, Any]] = []
        self._last_fetch_time: float = 0
        self._cache_ttl: float = 60.0  # 60s cache

    def get_db_connection(self):
        """Kết nối tới cơ sở dữ liệu Neon PostgreSQL với cơ chế tự động thử lại nếu DB vừa thức giấc."""
        last_err = None
        for attempt in range(2):
            try:
                return psycopg2.connect(
                    dbname=Config.DB_NAME,
                    user=Config.DB_USER,
                    password=Config.DB_PASSWORD,
                    host=Config.DB_HOST,
                    port=Config.DB_PORT,
                    sslmode="require",
                    connect_timeout=15
                )
            except Exception as e:
                last_err = e
                print(f"[RoleplayService] Thử kết nối Neon DB lần {attempt + 1}/2 thất bại: {e}")
                time.sleep(1)
        raise last_err

    def get_characters(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """
        Lấy danh sách nhân vật nhập vai từ bảng `roleplay` trong Neon PostgreSQL.
        Có cơ chế bộ nhớ đệm và fallback tự động nếu DB gặp trục trặc mạng.
        """
        now = time.time()
        if not force_refresh and self._cached_characters and (now - self._last_fetch_time < self._cache_ttl):
            return self._cached_characters

        characters = []
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute("""
                SELECT 
                    character_name, 
                    character_instruction, 
                    persona, 
                    scenerio, 
                    temperature, 
                    repeat_penalty, 
                    min_p, 
                    repeat_last_n, 
                    additional_data, 
                    content, 
                    linkanh 
                FROM roleplay 
                ORDER BY character_name ASC
            """)
            rows = cur.fetchall()
            cur.close()
            conn.close()

            for r in rows:
                char_name = str(r[0] or "").strip()
                instruction = str(r[1] or "").strip()
                persona = str(r[2] or "").strip()
                scenerio = str(r[3] or "").strip()
                temp = float(r[4]) if r[4] is not None else 1.0
                rep_pen = float(r[5]) if r[5] is not None else 1.1
                min_p = float(r[6]) if r[6] is not None else 0.1
                rep_last_n = float(r[7]) if r[7] is not None else 128.0
                add_data = str(r[8] or "").strip() if r[8] else None
                if add_data in ("None", "null", ""):
                    add_data = None
                content = str(r[9] or "").strip()
                linkanh = str(r[10] or "").strip()

                # Thay thế hiển thị thô nếu content là "1"
                if content == "1" and "Teacher" in char_name:
                    content = "Thầy giáo Tin học tận tâm & kiên nhẫn"

                characters.append({
                    "character_name": char_name,
                    "character_instruction": instruction,
                    "persona": persona,
                    "scenerio": scenerio,
                    "temperature": temp,
                    "repeat_penalty": rep_pen,
                    "min_p": min_p,
                    "repeat_last_n": rep_last_n,
                    "additional_data": add_data,
                    "content": content,
                    "linkanh": linkanh
                })

            if characters:
                self._cached_characters = characters
                self._last_fetch_time = now
                return characters
        except Exception as e:
            print(f"[RoleplayService] Lỗi khi truy vấn bảng roleplay từ Neon DB: {e}")

        # Nếu DB lỗi hoặc rỗng, trả về fallback
        if not self._cached_characters:
            self._cached_characters = FALLBACK_CHARACTERS
            self._last_fetch_time = now

        return self._cached_characters

    def get_character(self, character_name: str) -> Optional[Dict[str, Any]]:
        """Lấy thông tin chi tiết một nhân vật theo tên."""
        chars = self.get_characters()
        target = character_name.strip().lower()
        for c in chars:
            if c["character_name"].strip().lower() == target:
                return c
        return None

    def create_or_update_character(self, data: Dict[str, Any]) -> Tuple[bool, str]:
        """Tạo mới hoặc cập nhật nhân vật vào bảng `roleplay` trên Neon DB."""
        char_name = str(data.get("character_name") or "").strip()
        if not char_name:
            return False, "Tên nhân vật không được để trống."

        instruction = str(data.get("character_instruction") or "").strip()
        persona = str(data.get("persona") or "").strip()
        scenerio = str(data.get("scenerio") or "").strip()
        temperature = float(data.get("temperature", 1.0))
        repeat_penalty = float(data.get("repeat_penalty", 1.1))
        min_p = float(data.get("min_p", 0.1))
        repeat_last_n = float(data.get("repeat_last_n", 128.0))
        additional_data = data.get("additional_data")
        content = str(data.get("content") or "").strip()
        linkanh = str(data.get("linkanh") or "").strip()

        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO roleplay (
                    character_name, character_instruction, persona, scenerio,
                    temperature, repeat_penalty, min_p, repeat_last_n,
                    additional_data, content, linkanh
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (character_name) DO UPDATE SET
                    character_instruction = EXCLUDED.character_instruction,
                    persona = EXCLUDED.persona,
                    scenerio = EXCLUDED.scenerio,
                    temperature = EXCLUDED.temperature,
                    repeat_penalty = EXCLUDED.repeat_penalty,
                    min_p = EXCLUDED.min_p,
                    repeat_last_n = EXCLUDED.repeat_last_n,
                    additional_data = EXCLUDED.additional_data,
                    content = EXCLUDED.content,
                    linkanh = EXCLUDED.linkanh;
            """, (
                char_name, instruction, persona, scenerio,
                temperature, repeat_penalty, min_p, repeat_last_n,
                additional_data, content, linkanh
            ))
            conn.commit()
            cur.close()
            conn.close()
            self.get_characters(force_refresh=True)
            return True, f"Lưu nhân vật '{char_name}' thành công."
        except Exception as e:
            return False, f"Lỗi lưu nhân vật vào Neon DB: {str(e)}"

    def delete_character(self, character_name: str) -> Tuple[bool, str]:
        """Xóa nhân vật khỏi bảng `roleplay`."""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute("DELETE FROM roleplay WHERE character_name = %s", (character_name,))
            conn.commit()
            cur.close()
            conn.close()
            self.get_characters(force_refresh=True)
            return True, f"Đã xóa nhân vật '{character_name}'."
        except Exception as e:
            return False, f"Lỗi xóa nhân vật: {str(e)}"

    def build_roleplay_system_prompt(self, character: Dict[str, Any], additional_knowledge: str = "") -> str:
        """
        Xây dựng prompt hệ thống cho nhân vật nhập vai dựa theo cấu trúc Role_play.dart:
        - Instruction
        - Persona
        - Scenerio
        - Additional Knowledge (nếu có Chroma collection)
        - Quy tắc định dạng cử chỉ hành động (*hành động*)
        """
        name = character.get("character_name", "AI")
        instruction = character.get("character_instruction", "")
        persona = character.get("persona", "")
        scenerio = character.get("scenerio", "")

        blocks = []
        blocks.append(f"### [CHỈ THỊ NHẬP VAI CHÍNH THỨC - ROLEPLAY DIRECTIVE]")
        blocks.append(f"Bạn đang nhập vai hoàn toàn vào nhân vật: {name}.")
        if instruction:
            blocks.append(f"Hướng dẫn hệ thống: {instruction}")

        if persona:
            blocks.append(f"\n### [DANH TÍNH, TÍNH CÁCH & NGOẠI HÌNH CỦA {name.upper()}]")
            blocks.append(persona)

        if scenerio:
            blocks.append(f"\n### [BỐI CẢNH & TÌNH HUỐNG HIỆN TẠI]")
            blocks.append(scenerio)

        if additional_knowledge:
            blocks.append(f"\n### [TRI THỨC BỔ SUNG & KỶ NIỆM LIÊN QUAN]")
            blocks.append(additional_knowledge)

        blocks.append(f"""
### [QUY TẮC NHẬP VAI BẮT BUỘC]:
1. Tuyệt đối KHÔNG BAO GIỜ phá vỡ vai diễn (Never break character).
2. Xưng hô và đối đáp đúng chuẩn mối quan hệ với User đã được mô tả trong tính cách và kịch bản.
3. Diễn tả các cảm xúc, cử chỉ, chuyển động phi ngôn ngữ đặt bên trong dấu sao `*...*` (ví dụ: *chớp mắt ngượng ngùng*, *khẽ mỉm cười*, *bước lại gần bạn*).
4. Giữ câu trả lời sống động, tự nhiên, biểu cảm chân thực và tạo cảm giác như một cuộc trò chuyện trực tiếp ngoài đời.
""")
        return "\n".join(blocks)

    def stream_roleplay_chat(
        self,
        character_name: str,
        user_message: str,
        history: List[Dict[str, str]],
        model_id: str = "qwen2.5:14b",
        custom_options: Optional[Dict[str, Any]] = None,
        additional_knowledge: str = ""
    ) -> Generator[str, None, None]:
        """
        Stream câu trả lời nhập vai từ Ollama sử dụng các tham số siêu vi (temperature, repeat_penalty, min_p, repeat_last_n)
        được cấu hình riêng cho từng nhân vật trong Neon DB.
        """
        char = self.get_character(character_name)
        if not char:
            # Fallback lấy nhân vật đầu tiên
            chars = self.get_characters()
            char = chars[0] if chars else FALLBACK_CHARACTERS[0]

        # Kiểm tra URL Ollama
        active_url = Config.OLLAMA_REMOTE_URL
        for test_url in [Config.OLLAMA_REMOTE_URL, Config.OLLAMA_LOCAL_URL]:
            try:
                res = requests.get(f"{test_url}/api/tags", timeout=3, verify=False)
                if res.status_code == 200:
                    active_url = test_url
                    break
            except Exception:
                continue

        system_prompt = self.build_roleplay_system_prompt(char, additional_knowledge)

        # Định dạng danh sách tin nhắn gửi tới Ollama
        formatted_messages = [{"role": "system", "content": system_prompt}]
        for item in history:
            role = item.get("role", "user")
            content = item.get("content", "")
            if role in ("user", "assistant") and content:
                formatted_messages.append({"role": role, "content": content})

        formatted_messages.append({"role": "user", "content": user_message})

        # Cấu hình Options đặc thù của nhân vật từ database
        char_temp = float(char.get("temperature", 1.0))
        char_repeat_pen = float(char.get("repeat_penalty", 1.1))
        char_min_p = float(char.get("min_p", 0.1))
        char_repeat_last_n = int(char.get("repeat_last_n", 128))

        options = {
            "temperature": char_temp,
            "repeat_penalty": char_repeat_pen,
            "min_p": char_min_p,
            "repeat_last_n": char_repeat_last_n
        }

        # Nếu người dùng có tùy chỉnh riêng từ thanh trượt cài đặt
        if custom_options and isinstance(custom_options, dict):
            for k in ["temperature", "repeat_penalty", "min_p", "repeat_last_n"]:
                if k in custom_options and custom_options[k] is not None:
                    try:
                        options[k] = float(custom_options[k]) if k != "repeat_last_n" else int(custom_options[k])
                    except (ValueError, TypeError):
                        pass

        # Chuẩn hóa model_id
        if not model_id or "gemini" in model_id.lower() or "gpt" in model_id.lower():
            model_id = "qwen2.5:14b"

        payload = {
            "model": model_id,
            "messages": formatted_messages,
            "options": options,
            "stream": True
        }

        api_chat_url = f"{active_url}/api/chat"
        try:
            with requests.post(api_chat_url, json=payload, stream=True, timeout=120, verify=False) as response:
                if response.status_code != 200:
                    yield f"[Lỗi {response.status_code} từ máy chủ Ollama ({active_url}): {response.text}]"
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
