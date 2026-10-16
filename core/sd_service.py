# -*- coding: utf-8 -*-
"""
Stable Diffusion 1.5 Service (AI Image Generation Engine)
Tối ưu chuyên sâu cho máy tính cục bộ & GPU VRAM thấp (Quadro P600 4GB / RTX 3050 / GTX 1650).
Các kỹ thuật tối ưu VRAM:
- torch.float16
- enable_attention_slicing("auto")
- enable_vae_slicing()
- Giải phóng bộ nhớ đệm (torch.cuda.empty_cache) sau mỗi lượt sinh ảnh
- Hỗ trợ Dịch & Tối ưu Prompt tiếng Việt sang chuẩn SD 1.5 qua Ollama
"""

import os
import sys
import json
import time
import random
import re
from datetime import datetime
from PIL import Image

import torch

# Các cấu hình phong cách nghệ thuật (Style Presets)
STYLE_PRESETS = {
    "none": {
        "name": "Mặc định (Không áp phong cách)",
        "prompt_suffix": "",
        "negative_suffix": ""
    },
    "photorealistic": {
        "name": "📸 Chân Thực (Photorealistic)",
        "prompt_suffix": ", 8k uhd, dslr, soft lighting, high quality, film grain, Fujifilm XT4, highly detailed, realistic texture",
        "negative_suffix": ", cartoon, anime, 3d render, illustration, drawing, painting, oversaturated"
    },
    "anime": {
        "name": "🎨 Anime / Manga (Nhật Bản)",
        "prompt_suffix": ", anime artwork, anime style, key visual, vibrant, studio ghibli, Makoto Shinkai style, highly detailed anime illustration",
        "negative_suffix": ", photo, realistic, 3d, deformed, disfigured"
    },
    "cyberpunk": {
        "name": "🌌 Cyberpunk / Viễn Tưởng",
        "prompt_suffix": ", cyberpunk aesthetic, neon lights, futuristic city street, rainy night, volumetric light, cinematic composition, 8k",
        "negative_suffix": ", vintage, medieval, natural, rustic"
    },
    "oil_painting": {
        "name": "🖌️ Tranh Sơn Dầu (Classical Oil)",
        "prompt_suffix": ", oil painting, textured canvas, visible brushstrokes, classical fine art, masterpiece, golden lighting, Rembrandt style",
        "negative_suffix": ", photo, digital 3d, flat, cartoon"
    },
    "digital_3d": {
        "name": "🎮 3D Digital Art / Pixar",
        "prompt_suffix": ", 3D render, Pixar style, Unreal Engine 5, Octane render, ray tracing, cute, smooth lighting, volumetric render",
        "negative_suffix": ", 2d, flat drawing, realistic photo"
    },
    "cinematic": {
        "name": "🎬 Điện Ảnh (Cinematic Movie)",
        "prompt_suffix": ", cinematic movie still, 35mm film photography, dramatic atmospheric lighting, shallow depth of field, anamorphic lens flare",
        "negative_suffix": ", low quality, amateur photo, phone camera, washed out"
    },
    "fantasy": {
        "name": "🐉 Thần Thoại / Fantasy",
        "prompt_suffix": ", epic fantasy concept art, magical glowing particles, mystical atmosphere, highly detailed, Artstation trending",
        "negative_suffix": ", modern city, photo, simple, sketch"
    }
}

DEFAULT_NEGATIVE_PROMPT = (
    "ugly, deformed, bad anatomy, bad hands, missing fingers, extra fingers, "
    "blurry, low quality, low resolution, pixelated, watermark, text, signature, duplicate"
)

class SDService:
    def __init__(self, output_dir=None, history_file=None):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.torch_dtype = torch.float16 if self.device == "cuda" else torch.float32
        self.pipe = None
        self.current_model_id = None
        self.is_loading = False

        # Thư mục lưu ảnh đã sinh
        if output_dir:
            self.output_dir = output_dir
        file_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(file_dir)
        project_root = os.path.dirname(parent_dir) if os.path.basename(parent_dir) in ("backend_api", "unified_app") else parent_dir

        # Thư mục lưu ảnh đã sinh
        if output_dir:
            self.output_dir = output_dir
        else:
            self.output_dir = os.path.join(project_root, "uploads", "generated_images")
        os.makedirs(self.output_dir, exist_ok=True)

        # File lưu lịch sử ảnh
        if history_file:
            self.history_file = history_file
        else:
            self.history_file = os.path.join(project_root, "data", "image_history.json")
        os.makedirs(os.path.dirname(self.history_file), exist_ok=True)

        # Thư mục chứa checkpoints custom của người dùng nếu có (.safetensors)
        self.models_dir = os.path.join(project_root, "models", "checkpoints")
        os.makedirs(self.models_dir, exist_ok=True)

        # Thư mục chứa mô hình SD 1.5 FP16 tải cục bộ
        self.local_sd_dir = os.path.join(project_root, "models", "sd_v15_fp16")
        self.status_file = os.path.join(project_root, "data", "sd_download_status.json")

    def is_local_model_ready(self):
        """Kiểm tra xem mô hình SD 1.5 FP16 đã được tải đủ tệp ở thư mục cục bộ chưa."""
        if not os.path.exists(self.local_sd_dir):
            return False
        vae_ready = (
            os.path.exists(os.path.join(self.local_sd_dir, "vae", "diffusion_pytorch_model.safetensors")) or
            os.path.exists(os.path.join(self.local_sd_dir, "vae", "diffusion_pytorch_model.fp16.safetensors"))
        )
        te_ready = (
            os.path.exists(os.path.join(self.local_sd_dir, "text_encoder", "model.safetensors")) or
            os.path.exists(os.path.join(self.local_sd_dir, "text_encoder", "model.fp16.safetensors"))
        )
        unet_ready = (
            os.path.exists(os.path.join(self.local_sd_dir, "unet", "diffusion_pytorch_model.safetensors")) or
            os.path.exists(os.path.join(self.local_sd_dir, "unet", "diffusion_pytorch_model.fp16.safetensors"))
        )
        return vae_ready and te_ready and unet_ready

    def get_status(self):
        """Trả về thông tin trạng thái phần cứng, mô hình và tiến trình tải."""
        vram_total = 0.0
        vram_used = 0.0
        device_name = "CPU"

        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            vram_total = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2)
            vram_used = round(torch.cuda.memory_allocated(0) / (1024**3), 2)

        # Đọc tiến trình tải nếu có
        download_info = None
        if os.path.exists(self.status_file):
            try:
                with open(self.status_file, "r", encoding="utf-8") as f:
                    download_info = json.load(f)
            except Exception:
                pass

        is_ready = self.pipe is not None
        is_local = self.is_local_model_ready()

        state = "idle"
        msg = "Chưa nạp vào GPU"
        if is_ready:
            state = "ready"
            msg = f"Đã nạp sẵn trong VRAM GPU {device_name} ({vram_used} GB / {vram_total} GB)"
        elif self.is_loading:
            state = "loading_gpu"
            msg = f"Đang nạp mô hình vào VRAM GPU {device_name}..."
        elif download_info and download_info.get("status") == "downloading":
            state = "downloading"
            msg = download_info.get("message", "Đang tải mô hình...")
        elif is_local:
            state = "downloaded_ready_to_load"
            msg = "Mô hình đã có sẵn trên máy. Bấm 'Nạp vào GPU' để kích hoạt."

        return {
            "success": True,
            "device": self.device,
            "device_name": device_name,
            "vram_total_gb": vram_total,
            "vram_used_gb": vram_used,
            "model_loaded": is_ready,
            "is_local_ready": is_local,
            "state": state,
            "message": msg,
            "download_info": download_info,
            "current_model": self.current_model_id or ("SD 1.5 Cục bộ" if is_local else "runwayml/stable-diffusion-v1-5"),
            "styles": {k: v["name"] for k, v in STYLE_PRESETS.items()}
        }

    def get_available_models(self):
        """Liệt kê các mô hình SD 1.5 có sẵn (HuggingFace + Local checkpoints)."""
        models = []
        if self.is_local_model_ready():
            models.append({
                "id": "local_sd_v15_fp16",
                "name": "⚡ SD 1.5 Cục bộ (FP16 Đã Tải - Nạp Tức Thì)",
                "type": "local_dir",
                "is_local": True
            })

        models.append({
            "id": "runwayml/stable-diffusion-v1-5",
            "name": "⭐ Stable Diffusion v1.5 (Chuẩn Gốc - Hugging Face)",
            "type": "huggingface",
            "is_local": False
        })

        if os.path.exists(self.models_dir):
            for fname in os.listdir(self.models_dir):
                if fname.lower().endswith((".safetensors", ".ckpt")):
                    models.append({
                        "id": os.path.join(self.models_dir, fname),
                        "name": f"📁 Local: {fname}",
                        "type": "local_file",
                        "is_local": True
                    })

        return models

    def load_pipeline(self, model_id=None):
        """Nạp pipeline Stable Diffusion 1.5 với tối ưu VRAM cho card 4GB."""
        from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler

        target_model = model_id or self.current_model_id

        # Tự động ưu tiên thư mục cục bộ nếu khả dụng
        if not target_model or target_model in ("runwayml/stable-diffusion-v1-5", "local_sd_v15_fp16"):
            if self.is_local_model_ready():
                target_model = self.local_sd_dir
            else:
                target_model = "runwayml/stable-diffusion-v1-5"

        if self.pipe is not None and self.current_model_id == target_model:
            return self.pipe

        print(f"[SDService] Đang nạp mô hình SD 1.5: {target_model} trên {self.device} ({self.torch_dtype})...")
        self.is_loading = True

        try:
            if target_model.endswith((".safetensors", ".ckpt")) and os.path.isfile(target_model):
                pipe = StableDiffusionPipeline.from_single_file(
                    target_model,
                    torch_dtype=self.torch_dtype,
                    use_safetensors=True
                )
            elif os.path.isdir(target_model):
                # Nạp trực tiếp từ thư mục cục bộ (siêu tốc, offline 100%)
                pipe = StableDiffusionPipeline.from_pretrained(
                    target_model,
                    torch_dtype=self.torch_dtype,
                    safety_checker=None,
                    requires_safety_checker=False,
                    local_files_only=True
                )
            else:
                pipe = StableDiffusionPipeline.from_pretrained(
                    target_model,
                    torch_dtype=self.torch_dtype,
                    variant="fp16",
                    use_safetensors=True,
                    safety_checker=None,
                    requires_safety_checker=False
                )

            # Sử dụng DPMSolverMultistepScheduler để tạo ảnh nhanh và nét hơn (chỉ cần 20-25 steps)
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)

            if self.device == "cuda":
                pipe.to("cuda")
                # Kỹ thuật giảm tải VRAM bắt buộc cho card <= 4GB
                pipe.enable_attention_slicing("auto")
                pipe.enable_vae_slicing()
            else:
                pipe.to("cpu")

            self.pipe = pipe
            self.current_model_id = target_model
            print(f"[SDService] Đã nạp thành công mô hình: {target_model} vào {self.device}")
            return self.pipe

        except Exception as e:
            print(f"[SDService] Lỗi khi nạp mô hình SD 1.5: {e}")
            raise e
        finally:
            self.is_loading = False

    def unload_pipeline(self):
        """Giải phóng VRAM bằng cách dọn dẹp mô hình khỏi bộ nhớ GPU."""
        if self.pipe is not None:
            del self.pipe
            self.pipe = None
            self.current_model_id = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            print("[SDService] Đã giải phóng bộ nhớ GPU.")
            return True
        return False

    def start_loading_model(self, model_id=None):
        """Kích hoạt nạp mô hình bất đồng bộ (tải nếu chưa có, nạp vào GPU)."""
        import threading
        if self.is_loading:
            return {"success": False, "message": "Mô hình đang trong quá trình nạp."}
        if self.pipe is not None:
            return {"success": True, "message": "Mô hình đã sẵn sàng trong GPU."}

        def worker():
            try:
                target = model_id or "runwayml/stable-diffusion-v1-5"
                if target in ("runwayml/stable-diffusion-v1-5", "local_sd_v15_fp16") and not self.is_local_model_ready():
                    import sys
                    tools_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools")
                    if tools_path not in sys.path:
                        sys.path.insert(0, tools_path)
                    try:
                        import download_sd15
                        print("[SDService] Bắt đầu tải tệp mô hình FP16 trong luồng ngầm...")
                        success = download_sd15.run_download()
                        if not success:
                            print("[SDService] Tải mô hình thất bại.")
                            return
                    except Exception as err:
                        print(f"[SDService] Lỗi chạy download_sd15: {err}")
                        return

                self.load_pipeline(model_id)
            except Exception as e:
                print(f"[SDService] Lỗi worker nạp mô hình: {e}")

        t = threading.Thread(target=worker, daemon=True)
        t.start()
        return {"success": True, "message": "Đã bắt đầu nạp mô hình vào GPU..."}

    def enhance_prompt_with_llm(self, user_prompt, style_name="none"):
        """Dịch và làm giàu prompt tiếng Việt/Anh sang phong cách SD 1.5 qua Ollama."""
        try:
            import requests
            style_hint = STYLE_PRESETS.get(style_name, {}).get("name", "Chi tiết, nghệ thuật")
            
            system_instruction = (
                "You are an expert prompt engineer for Stable Diffusion 1.5. "
                "Your task: Convert the user's input (which may be in Vietnamese or English) "
                "into an evocative, concise, high-quality English text-to-image prompt. "
                "Include visual descriptors: subject details, lighting, mood, camera angle, and artistic rendering. "
                "Output ONLY the prompt text, no quotes, no introductions, no explanations."
            )

            user_query = f"User idea: {user_prompt}\nTarget style: {style_hint}"

            # Gọi Ollama local
            res = requests.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": "qwen2.5:14b",
                    "prompt": f"{system_instruction}\n\n{user_query}\n\nEnhanced English Prompt:",
                    "stream": False,
                    "options": {
                        "temperature": 0.3,
                        "num_predict": 120
                    }
                },
                timeout=12
            )
            if res.ok:
                enhanced = res.json().get("response", "").strip().strip('"').strip("'")
                if len(enhanced) > 5:
                    return enhanced
        except Exception as e:
            print(f"[SDService] Lưu ý: Không thể dùng Ollama để mở rộng prompt ({e}), sử dụng prompt gốc.")
        
        return user_prompt

    def generate(self, prompt, negative_prompt=None, style="none", width=512, height=512,
                 steps=25, cfg_scale=7.5, seed=-1, enhance_prompt=False, model_id=None):
        """Sinh ảnh nghệ thuật với SD 1.5."""
        if not prompt or not prompt.strip():
            raise ValueError("Prompt không được để trống!")

        raw_prompt = prompt.strip()
        final_prompt = raw_prompt

        # 1. Tối ưu prompt qua LLM nếu bật
        enhanced_note = ""
        if enhance_prompt:
            enhanced_val = self.enhance_prompt_with_llm(raw_prompt, style)
            if enhanced_val and enhanced_val != raw_prompt:
                final_prompt = enhanced_val
                enhanced_note = enhanced_val

        # 2. Ghép Style Preset
        preset_info = STYLE_PRESETS.get(style, STYLE_PRESETS["none"])
        final_prompt = f"{final_prompt}{preset_info['prompt_suffix']}"

        # 3. Negative Prompt
        final_neg = negative_prompt.strip() if negative_prompt and negative_prompt.strip() else DEFAULT_NEGATIVE_PROMPT
        if preset_info['negative_suffix']:
            final_neg = f"{final_neg}{preset_info['negative_suffix']}"

        # 4. Kích thước (bội số của 8, giới hạn an toàn cho card 4GB)
        width = int(width) if width else 512
        height = int(height) if height else 512
        width = max(256, min(width, 768)) // 8 * 8
        height = max(256, min(height, 768)) // 8 * 8

        # 5. Steps & Guidance Scale
        steps = max(10, min(int(steps or 25), 50))
        cfg_scale = max(1.0, min(float(cfg_scale or 7.5), 20.0))

        # 6. Seed
        if seed is None or int(seed) < 0:
            actual_seed = random.randint(0, 2147483647)
        else:
            actual_seed = int(seed)

        generator = torch.Generator(device=self.device).manual_seed(actual_seed)

        # 7. Nạp mô hình nếu chưa có
        pipe = self.load_pipeline(model_id)

        print(f"[SDService] Bắt đầu sinh ảnh: size={width}x{height}, steps={steps}, cfg={cfg_scale}, seed={actual_seed}")
        start_time = time.time()

        try:
            result = pipe(
                prompt=final_prompt,
                negative_prompt=final_neg,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=cfg_scale,
                generator=generator
            )

            generated_image = result.images[0]
            time_taken = round(time.time() - start_time, 2)

            # Lưu ảnh vào ổ đĩa
            timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"sd15_{timestamp_str}_{actual_seed}.png"
            file_path = os.path.join(self.output_dir, filename)
            generated_image.save(file_path, format="PNG")

            # Lưu lịch sử
            history_record = {
                "id": f"img_{int(time.time())}_{actual_seed}",
                "filename": filename,
                "url": f"/api/image/view/{filename}",
                "prompt": raw_prompt,
                "enhanced_prompt": enhanced_note,
                "negative_prompt": final_neg,
                "style": style,
                "style_name": preset_info["name"],
                "width": width,
                "height": height,
                "steps": steps,
                "cfg_scale": cfg_scale,
                "seed": actual_seed,
                "time_taken": time_taken,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            self._save_to_history(history_record)

            print(f"[SDService] Hoàn thành sinh ảnh trong {time_taken}s -> {filename}")

            return {
                "success": True,
                **history_record
            }

        except Exception as e:
            print(f"[SDService] Lỗi khi tạo ảnh: {e}")
            raise e
        finally:
            # Giải phóng VRAM
            if self.device == "cuda":
                torch.cuda.empty_cache()

    def _save_to_history(self, record):
        """Lưu bản ghi vào file JSON lịch sử."""
        try:
            history = []
            if os.path.exists(self.history_file):
                with open(self.history_file, "r", encoding="utf-8") as f:
                    history = json.load(f)
            
            # Thêm vào đầu danh sách
            history.insert(0, record)
            # Giữ tối đa 100 ảnh gần nhất
            history = history[:100]

            with open(self.history_file, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[SDService] Lỗi ghi lịch sử ảnh: {e}")

    def get_history(self, limit=30):
        """Lấy danh sách các ảnh đã sinh gần nhất."""
        try:
            if os.path.exists(self.history_file):
                with open(self.history_file, "r", encoding="utf-8") as f:
                    history = json.load(f)
                    return history[:limit]
        except Exception as e:
            print(f"[SDService] Lỗi đọc lịch sử ảnh: {e}")
        return []

    def delete_image(self, filename):
        """Xóa 1 ảnh khỏi ổ đĩa và lịch sử."""
        try:
            file_path = os.path.join(self.output_dir, filename)
            if os.path.exists(file_path):
                os.remove(file_path)

            if os.path.exists(self.history_file):
                with open(self.history_file, "r", encoding="utf-8") as f:
                    history = json.load(f)
                history = [h for h in history if h.get("filename") != filename]
                with open(self.history_file, "w", encoding="utf-8") as f:
                    json.dump(history, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"[SDService] Lỗi khi xóa ảnh {filename}: {e}")
            return False
