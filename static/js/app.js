/**
 * AI Playground - Cloudflare Frontend Client Logic (v2.3)
 * - Giao diện mặc định là SÁNG (Light Theme) cao cấp, thẩm mỹ Apple/Stripe
 * - Tách riêng 2 tab: Trò Chuyện AI Trực Tiếp & Hỏi Đáp RAG Tài Liệu
 * - Bộ chọn mô hình và thanh điều khiển chuyển xuống đáy khung chat
 * - Bong bóng chat User & Bot được thiết kế hiện đại, avatar tròn gradient, timestamp & sender badge
 * - Phân quyền Người Dùng & Quản Trị Viên (Admin) kết nối Neon DB userid
 * - Tải lên tài liệu người dùng, trích xuất text, nạp ChromaDB & PostgreSQL
 * - Admin quản lý và lọc toàn bộ tài liệu; Người dùng quản lý tài liệu của mình
 */

document.addEventListener("DOMContentLoaded", () => {
    // ---------------------- USER & AUTH STATE ----------------------
    let currentUser = {
        username: "haviet",
        role: "user",
        is_admin: false
    };

    const savedUser = localStorage.getItem("HPU2_USER");
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
        } catch (e) {
            console.error("Lỗi parse saved user:", e);
        }
    }

    // ---------------------- APP STATE ----------------------
    let currentConfig = null;
    let selectedOcrFile = null;
    let currentOcrResult = null;
    let currentSelectedDoc = null;
    let currentLoadedDocs = [];
    
    // Lưu lịch sử chat độc lập cho 2 tab (Stateless API)
    let directChatHistory = [];
    let ragChatHistory = [];
    
    // Quản lý chọn 1 hoặc nhiều tài liệu RAG
    let selectedCollections = new Set(["m3docdep"]);
    let allAvailableCollections = [];
    let tableSelectedDocIds = new Set();

    // =========================================================================
    // AI PLAYGROUND: LLM PARAMETERS MANAGEMENT (DRAWER & PRESETS)
    // =========================================================================
    const DEFAULT_CHAT_PARAMS = {
        temperature: 0.70,
        num_ctx: 8192,
        top_p: 0.90,
        repeat_penalty: 1.10,
        num_predict: 2048,
        system_prompt: ""
    };

    const CHAT_PRESETS = {
        default: {
            temperature: 0.70,
            num_ctx: 8192,
            top_p: 0.90,
            repeat_penalty: 1.10,
            num_predict: 2048
        },
        coding: {
            temperature: 0.15,
            num_ctx: 8192,
            top_p: 0.80,
            repeat_penalty: 1.05,
            num_predict: 4096
        },
        creative: {
            temperature: 1.25,
            num_ctx: 8192,
            top_p: 0.95,
            repeat_penalty: 1.15,
            num_predict: 2048
        },
        deep: {
            temperature: 0.30,
            num_ctx: 16384,
            top_p: 0.85,
            repeat_penalty: 1.10,
            num_predict: 4096
        }
    };

    let activeChatParams = { ...DEFAULT_CHAT_PARAMS };

    function loadSavedChatParams() {
        try {
            const raw = localStorage.getItem("AI_PLAYGROUND_PARAMS");
            if (raw) {
                const parsed = JSON.parse(raw);
                activeChatParams = { ...DEFAULT_CHAT_PARAMS, ...parsed };
            }
        } catch (_) {}
    }

    function saveChatParams() {
        try {
            localStorage.setItem("AI_PLAYGROUND_PARAMS", JSON.stringify(activeChatParams));
        } catch (_) {}
    }

    function updateChatParamsBadges() {
        const tempStr = parseFloat(activeChatParams.temperature || 0.7).toFixed(2);
        const ctxK = Math.round(parseInt(activeChatParams.num_ctx || 8192) / 1024) + "K";
        const badgeText = `${tempStr} / ${ctxK}`;

        const directIndicator = document.getElementById("direct-params-indicator");
        if (directIndicator) directIndicator.textContent = badgeText;

        const ragIndicator = document.getElementById("rag-params-indicator");
        if (ragIndicator) ragIndicator.textContent = badgeText;
    }

    function syncChatParamsUI() {
        // Direct drawer elements
        const dTempSlider = document.getElementById("direct-param-temp");
        const dTempVal = document.getElementById("direct-param-temp-val");
        if (dTempSlider) dTempSlider.value = activeChatParams.temperature;
        if (dTempVal) dTempVal.textContent = parseFloat(activeChatParams.temperature || 0.7).toFixed(2);

        const dCtxSelect = document.getElementById("direct-param-ctx");
        const dCtxVal = document.getElementById("direct-param-ctx-val");
        if (dCtxSelect) dCtxSelect.value = activeChatParams.num_ctx;
        if (dCtxVal) dCtxVal.textContent = Number(activeChatParams.num_ctx || 8192).toLocaleString() + " tokens";

        const dToppSlider = document.getElementById("direct-param-topp");
        const dToppVal = document.getElementById("direct-param-topp-val");
        if (dToppSlider) dToppSlider.value = activeChatParams.top_p;
        if (dToppVal) dToppVal.textContent = parseFloat(activeChatParams.top_p || 0.9).toFixed(2);

        const dRepSlider = document.getElementById("direct-param-rep");
        const dRepVal = document.getElementById("direct-param-rep-val");
        if (dRepSlider) dRepSlider.value = activeChatParams.repeat_penalty;
        if (dRepVal) dRepVal.textContent = parseFloat(activeChatParams.repeat_penalty || 1.1).toFixed(2);

        const dMaxSelect = document.getElementById("direct-param-max-tokens");
        const dMaxVal = document.getElementById("direct-param-max-tokens-val");
        if (dMaxSelect) dMaxSelect.value = activeChatParams.num_predict;
        if (dMaxVal) dMaxVal.textContent = activeChatParams.num_predict === -1 ? "Không giới hạn" : Number(activeChatParams.num_predict || 2048).toLocaleString();

        const dSysPrompt = document.getElementById("direct-param-system-prompt");
        if (dSysPrompt) dSysPrompt.value = activeChatParams.system_prompt || "";

        // RAG drawer elements
        const rTempSlider = document.getElementById("rag-param-temp");
        const rTempVal = document.getElementById("rag-param-temp-val");
        if (rTempSlider) rTempSlider.value = activeChatParams.temperature;
        if (rTempVal) rTempVal.textContent = parseFloat(activeChatParams.temperature || 0.7).toFixed(2);

        const rCtxSelect = document.getElementById("rag-param-ctx");
        const rCtxVal = document.getElementById("rag-param-ctx-val");
        if (rCtxSelect) rCtxSelect.value = activeChatParams.num_ctx;
        if (rCtxVal) rCtxVal.textContent = Number(activeChatParams.num_ctx || 8192).toLocaleString() + " tokens";

        const rToppSlider = document.getElementById("rag-param-topp");
        const rToppVal = document.getElementById("rag-param-topp-val");
        if (rToppSlider) rToppSlider.value = activeChatParams.top_p;
        if (rToppVal) rToppVal.textContent = parseFloat(activeChatParams.top_p || 0.9).toFixed(2);

        const rRepSlider = document.getElementById("rag-param-rep");
        const rRepVal = document.getElementById("rag-param-rep-val");
        if (rRepSlider) rRepSlider.value = activeChatParams.repeat_penalty;
        if (rRepVal) rRepVal.textContent = parseFloat(activeChatParams.repeat_penalty || 1.1).toFixed(2);

        const rMaxSelect = document.getElementById("rag-param-max-tokens");
        const rMaxVal = document.getElementById("rag-param-max-tokens-val");
        if (rMaxSelect) rMaxSelect.value = activeChatParams.num_predict;
        if (rMaxVal) rMaxVal.textContent = activeChatParams.num_predict === -1 ? "Không giới hạn" : Number(activeChatParams.num_predict || 2048).toLocaleString();

        const rSysPrompt = document.getElementById("rag-param-system-prompt");
        if (rSysPrompt) rSysPrompt.value = activeChatParams.system_prompt || "";

        updateChatParamsBadges();
    }

    function applyChatPreset(presetName) {
        const preset = CHAT_PRESETS[presetName];
        if (!preset) return;
        activeChatParams = {
            ...activeChatParams,
            ...preset
        };
        saveChatParams();
        syncChatParamsUI();

        // Update active class on preset pills in both drawers
        document.querySelectorAll(".param-preset-pill").forEach(pill => {
            if (pill.getAttribute("data-preset") === presetName) {
                pill.classList.add("active");
            } else {
                pill.classList.remove("active");
            }
        });
    }

    function toggleChatParamsDrawer(type = 'direct') {
        const isRag = type === 'rag';
        const drawerId = isRag ? 'rag-params-drawer' : 'direct-params-drawer';
        const btnId = isRag ? 'rag-toggle-params-btn' : 'direct-toggle-params-btn';
        const otherDrawerId = isRag ? 'direct-params-drawer' : 'rag-params-drawer';
        const otherBtnId = isRag ? 'direct-toggle-params-btn' : 'rag-toggle-params-btn';

        const drawer = document.getElementById(drawerId);
        const btn = document.getElementById(btnId);
        if (!drawer) {
            console.warn("[ChatParams] Drawer not found:", drawerId);
            return;
        }

        // Đóng ngăn kéo còn lại nếu đang mở
        const otherDrawer = document.getElementById(otherDrawerId);
        const otherBtn = document.getElementById(otherBtnId);
        if (otherDrawer && (otherDrawer.classList.contains('is-open') || otherDrawer.style.display === 'block')) {
            otherDrawer.classList.remove('is-open');
            otherDrawer.style.display = 'none';
            if (otherBtn) otherBtn.classList.remove('active');
        }

        const isCurrentlyOpen = drawer.classList.contains('is-open') || (drawer.style.display && drawer.style.display !== 'none');

        if (isCurrentlyOpen) {
            drawer.classList.remove('is-open');
            drawer.style.display = 'none';
            if (btn) btn.classList.remove('active');
        } else {
            drawer.classList.add('is-open');
            drawer.style.display = 'block';
            if (btn) btn.classList.add('active');
            syncChatParamsUI();
            try {
                drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (_) {}
        }
    }

    function resetChatParams() {
        activeChatParams = { ...DEFAULT_CHAT_PARAMS };
        saveChatParams();
        syncChatParamsUI();
        applyChatPreset("default");
    }

    // Expose globally for inline onclick handlers and accessibility across modules
    window.toggleChatParamsDrawer = toggleChatParamsDrawer;
    window.applyChatPreset = applyChatPreset;
    window.resetChatParams = resetChatParams;
    window.syncChatParamsUI = syncChatParamsUI;
    window.getActiveChatOptions = getActiveChatOptions;
    window.getActiveSystemPrompt = getActiveSystemPrompt;

    function initChatParameters() {
        loadSavedChatParams();
        syncChatParamsUI();

        // Bind toggle buttons (Fail-safe inline + event listener)
        const directToggleBtn = document.getElementById("direct-toggle-params-btn");
        if (directToggleBtn) {
            directToggleBtn.onclick = (e) => {
                e.preventDefault();
                toggleChatParamsDrawer('direct');
            };
        }

        const ragToggleBtn = document.getElementById("rag-toggle-params-btn");
        if (ragToggleBtn) {
            ragToggleBtn.onclick = (e) => {
                e.preventDefault();
                toggleChatParamsDrawer('rag');
            };
        }

        // Close buttons
        const directCloseBtn = document.getElementById("direct-params-close-btn");
        if (directCloseBtn) {
            directCloseBtn.onclick = (e) => {
                e.preventDefault();
                toggleChatParamsDrawer('direct');
            };
        }

        const ragCloseBtn = document.getElementById("rag-params-close-btn");
        if (ragCloseBtn) {
            ragCloseBtn.onclick = (e) => {
                e.preventDefault();
                toggleChatParamsDrawer('rag');
            };
        }

        // Reset buttons
        const directResetBtn = document.getElementById("direct-params-reset-btn");
        if (directResetBtn) {
            directResetBtn.onclick = (e) => {
                e.preventDefault();
                resetChatParams();
            };
        }
        const ragResetBtn = document.getElementById("rag-params-reset-btn");
        if (ragResetBtn) {
            ragResetBtn.onclick = (e) => {
                e.preventDefault();
                resetChatParams();
            };
        }

        // Preset pill clicks
        document.querySelectorAll(".param-preset-pill").forEach(pill => {
            pill.onclick = (e) => {
                e.preventDefault();
                const preset = pill.getAttribute("data-preset");
                applyChatPreset(preset);
            };
        });

        // Sliders binding
        const bindSlider = (sliderId, valId, key, isFloat) => {
            const el = document.getElementById(sliderId);
            const valEl = document.getElementById(valId);
            if (el) {
                el.addEventListener("input", () => {
                    const parsedVal = isFloat ? parseFloat(el.value) : parseInt(el.value);
                    activeChatParams[key] = parsedVal;
                    if (valEl) valEl.textContent = isFloat ? parsedVal.toFixed(2) : parsedVal;
                    saveChatParams();
                    updateChatParamsBadges();
                });
            }
        };

        bindSlider("direct-param-temp", "direct-param-temp-val", "temperature", true);
        bindSlider("rag-param-temp", "rag-param-temp-val", "temperature", true);

        bindSlider("direct-param-topp", "direct-param-topp-val", "top_p", true);
        bindSlider("rag-param-topp", "rag-param-topp-val", "top_p", true);

        bindSlider("direct-param-rep", "direct-param-rep-val", "repeat_penalty", true);
        bindSlider("rag-param-rep", "rag-param-rep-val", "repeat_penalty", true);

        const bindSelect = (selectId, valId, key, isInt, suffix = "") => {
            const el = document.getElementById(selectId);
            const valEl = document.getElementById(valId);
            if (el) {
                el.addEventListener("change", () => {
                    const parsedVal = isInt ? parseInt(el.value) : el.value;
                    activeChatParams[key] = parsedVal;
                    if (valEl) valEl.textContent = isInt ? (parsedVal === -1 ? "Không giới hạn" : Number(parsedVal).toLocaleString() + suffix) : parsedVal;
                    saveChatParams();
                    updateChatParamsBadges();
                });
            }
        };

        bindSelect("direct-param-ctx", "direct-param-ctx-val", "num_ctx", true, " tokens");
        bindSelect("rag-param-ctx", "rag-param-ctx-val", "num_ctx", true, " tokens");

        bindSelect("direct-param-max-tokens", "direct-param-max-tokens-val", "num_predict", true);
        bindSelect("rag-param-max-tokens", "rag-param-max-tokens-val", "num_predict", true);

        const bindText = (textareaId, key) => {
            const el = document.getElementById(textareaId);
            if (el) {
                el.addEventListener("input", () => {
                    activeChatParams[key] = el.value.trim();
                    saveChatParams();
                });
            }
        };
        bindText("direct-param-system-prompt", "system_prompt");
        bindText("rag-param-system-prompt", "system_prompt");
    }

    function getActiveChatOptions() {
        return {
            temperature: parseFloat(activeChatParams.temperature !== undefined ? activeChatParams.temperature : 0.70),
            num_ctx: parseInt(activeChatParams.num_ctx || 8192),
            top_p: parseFloat(activeChatParams.top_p !== undefined ? activeChatParams.top_p : 0.90),
            repeat_penalty: parseFloat(activeChatParams.repeat_penalty !== undefined ? activeChatParams.repeat_penalty : 1.10),
            num_predict: parseInt(activeChatParams.num_predict !== undefined ? activeChatParams.num_predict : 2048)
        };
    }

    function getActiveSystemPrompt() {
        return (activeChatParams.system_prompt || "").trim();
    }


    // ---------------------- DOM ELEMENTS ----------------------
    // Navigation & Theme
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    const themeToggleBtn = document.getElementById("theme-toggle");

    // User Header & Auth Modal
    const userHeaderSection = document.getElementById("user-header-section");
    const loggedInBox = document.getElementById("logged-in-box");
    const userRoleBadge = document.getElementById("user-role-badge");
    const userDisplayName = document.getElementById("user-display-name");
    const logoutBtn = document.getElementById("logout-btn");
    const authButtonsGroup = document.getElementById("auth-buttons-group");
    const openLoginBtn = document.getElementById("open-login-btn");
    const openSignupBtn = document.getElementById("open-signup-btn");

    const authModal = document.getElementById("auth-modal");
    const closeAuthModalBtn = document.getElementById("close-auth-modal-btn");
    const authForm = document.getElementById("auth-form");
    const authUsernameInput = document.getElementById("auth-username");
    const authPasswordInput = document.getElementById("auth-password");
    const authPasswordConfirm = document.getElementById("auth-password-confirm");
    const confirmPasswordGroup = document.getElementById("confirm-password-group");
    const authErrorMsg = document.getElementById("auth-error-msg");
    const authSuccessMsg = document.getElementById("auth-success-msg");
    const tabLoginBtn = document.getElementById("tab-login-btn");
    const tabRegisterBtn = document.getElementById("tab-register-btn");
    const authSubmitBtn = document.getElementById("auth-submit-btn");
    const authModalTitle = document.getElementById("auth-modal-title");
    const signupNoEmailBanner = document.getElementById("signup-no-email-banner");
    const quickLoginHintsBox = document.getElementById("quick-login-hints-box");
    const authSwitchAction = document.getElementById("auth-switch-action");
    const authSwitchPrompt = document.getElementById("auth-switch-prompt");
    const quickAccountBtns = document.querySelectorAll(".quick-account-btn");
    const togglePasswordBtns = document.querySelectorAll(".toggle-password-btn");
    let authMode = "login"; // "login" | "register"

    // Multi-Collection RAG Selector
    const collectionsCheckboxList = document.getElementById("collections-checkbox-list");
    const selectedDocsCountEl = document.getElementById("selected-docs-count");
    const selectedDocsChipsEl = document.getElementById("selected-docs-chips");
    const selectAllDocsBtn = document.getElementById("select-all-docs-btn");
    const clearAllDocsBtn = document.getElementById("clear-all-docs-btn");
    const docSearchInput = document.getElementById("doc-search-input");
    const rerankerThresholdSlider = document.getElementById("reranker-threshold-slider");
    const thresholdValText = document.getElementById("threshold-val-text");

    // Responsive Mobile RAG Elements
    const chatSidebar = document.getElementById("chat-sidebar");
    const mobileRagSidebarToggle = document.getElementById("mobile-rag-sidebar-toggle");
    const closeMobileSidebarBtn = document.getElementById("close-mobile-sidebar-btn");
    const sidebarBackdrop = document.getElementById("sidebar-backdrop");
    const mobileSelectedCount = document.getElementById("mobile-selected-count");

    // Multimodal Image Attachment State
    let directAttachedImages = []; // { name, base64, url }
    let ragAttachedImages = [];    // { name, base64, url }

    // TAB 1: Direct Chat Elements
    const directMessagesContainer = document.getElementById("direct-messages-container");
    const directChatInput = document.getElementById("direct-chat-input");
    const directChatSendBtn = document.getElementById("direct-chat-send-btn");
    const selectModelDirect = document.getElementById("select-model-direct");
    const newDirectChatBtn = document.getElementById("new-direct-chat-btn");
    const promptChips = document.querySelectorAll(".prompt-chip");
    const directAttachedPreview = document.getElementById("direct-attached-preview");
    const directImageFileInput = document.getElementById("direct-image-file-input");
    const directAttachImgBtn = document.getElementById("direct-attach-img-btn");

    // TAB 2: RAG Chat Elements
    const ragMessagesContainer = document.getElementById("rag-messages-container");
    const ragChatInput = document.getElementById("rag-chat-input");
    const ragChatSendBtn = document.getElementById("rag-chat-send-btn");
    const selectModelRag = document.getElementById("select-model-rag");
    const newRagChatBtn = document.getElementById("new-rag-chat-btn");
    const ragAttachedPreview = document.getElementById("rag-attached-preview");
    const ragImageFileInput = document.getElementById("rag-image-file-input");
    const ragAttachImgBtn = document.getElementById("rag-attach-img-btn");

    // OCR Elements
    const ocrDropzone = document.getElementById("ocr-dropzone");
    const ocrFileInput = document.getElementById("ocr-file-input");
    const fileSelectedCard = document.getElementById("file-selected-card");
    const selectedFileName = document.getElementById("selected-file-name");
    const selectedFileSize = document.getElementById("selected-file-size");
    const startOcrBtn = document.getElementById("start-ocr-btn");
    const ocrProgress = document.getElementById("ocr-progress");
    const ocrActionsCard = document.getElementById("ocr-actions-card");
    const targetCollectionInput = document.getElementById("target-collection-input");
    const indexToRagBtn = document.getElementById("index-to-rag-btn");
    const ocrEmptyState = document.getElementById("ocr-empty-state");
    const ocrResultsContent = document.getElementById("ocr-results-content");
    const resultActionsBtns = document.getElementById("result-actions-btns");
    const totalFormulasCount = document.getElementById("total-formulas-count");
    const formulasList = document.getElementById("formulas-list");
    const layoutPagesContainer = document.getElementById("layout-pages-container");
    const extractedTextView = document.getElementById("extracted-text-view");
    const copyMarkdownBtn = document.getElementById("copy-markdown-btn");
    const downloadJsonBtn = document.getElementById("download-json-btn");

    // Documents Tab
    const docsTbody = document.getElementById("docs-tbody");
    const refreshDocsBtn = document.getElementById("refresh-docs-btn");
    const checkAllDocsTable = document.getElementById("check-all-docs-table");
    const chatWithSelectedDocsBtn = document.getElementById("chat-with-selected-docs-btn");
    const batchSelectedCount = document.getElementById("batch-selected-count");
    const adminUserFilter = document.getElementById("admin-user-filter");
    const pdfViewerFrame = document.getElementById("pdf-viewer-frame");
    const imageViewerFrame = document.getElementById("image-viewer-frame");
    const viewerPlaceholder = document.querySelector(".viewer-placeholder");
    const viewerTitle = document.getElementById("viewer-title");
    const chatWithThisDocBtn = document.getElementById("chat-with-this-doc-btn");

    // Upload Document Modal
    const openUploadModalBtn = document.getElementById("open-upload-modal-btn");
    const uploadDocModal = document.getElementById("upload-doc-modal");
    const closeUploadModalBtn = document.getElementById("close-upload-modal-btn");
    const cancelUploadBtn = document.getElementById("cancel-upload-btn");
    const uploadDocForm = document.getElementById("upload-doc-form");
    const docFileInput = document.getElementById("doc-file-input");
    const docNameInput = document.getElementById("doc-name-input");
    const docCollectionInput = document.getElementById("doc-collection-input");
    const uploadProgressBox = document.getElementById("upload-progress-box");
    const uploadProgressText = document.getElementById("upload-progress-text");
    const uploadErrorMsg = document.getElementById("upload-error-msg");
    const submitUploadBtn = document.getElementById("submit-upload-btn");

    // Citation & Multimodal Modals
    const citationModal = document.getElementById("citation-modal");
    const citationModalTitle = document.getElementById("citation-modal-title");
    const citationModalBody = document.getElementById("citation-modal-body");
    const closeModalBtn = document.getElementById("close-modal-btn");

    const imagePreviewModal = document.getElementById("image-preview-modal");
    const closeImageModalBtn = document.getElementById("close-image-modal-btn");
    const enlargedModalImg = document.getElementById("enlarged-modal-img");

    // Cấu hình Marked Markdown parser
    marked.setOptions({
        breaks: true,
        gfm: true,
        highlight: function(code, lang) {
            if (window.hljs && hljs.getLanguage && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (e) {}
            }
            if (window.hljs) {
                try {
                    return hljs.highlightAuto(code).value;
                } catch (e) {}
            }
            return code;
        }
    });

    // ---------------------- HỖ TRỢ XỬ LÝ TOÁN LATEX & CODE BLOCK NÂNG CAO ----------------------
    function renderKaTeX(container) {
        if (window.renderMathInElement && container) {
            try {
                renderMathInElement(container, {
                    delimiters: [
                        { left: "$$", right: "$$", display: true },
                        { left: "$", right: "$", display: false },
                        { left: "\\(", right: "\\)", display: false },
                        { left: "\\[", right: "\\]", display: true }
                    ],
                    throwOnError: false
                });
            } catch (err) {
                console.warn("[KaTeX] Lỗi render công thức toán:", err);
            }
        }
    }

    function protectMathTokens(text) {
        if (!text) return { text: "", tokens: [] };
        const tokens = [];

        // 1. Display Math ($$ ... $$ hoặc \[ ... \])
        let safeText = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
            const key = `@@MATH_DISP_${tokens.length}@@`;
            tokens.push({ key, formula: formula.trim(), display: true });
            return key;
        });

        safeText = safeText.replace(/\\\[([\s\S]*?)\\\]/g, (match, formula) => {
            const key = `@@MATH_DISP_${tokens.length}@@`;
            tokens.push({ key, formula: formula.trim(), display: true });
            return key;
        });

        // 2. Inline Math ($ ... $ hoặc \( ... \))
        safeText = safeText.replace(/(^|[^\\])\$([^\$\n\r]+?)\$/g, (match, prefix, formula) => {
            const trimmed = formula.trim();
            // Tránh parse giá tiền như $100 hoặc $5.25
            if (!trimmed || /^\d+(\.\d+)?$/.test(trimmed) || formula.startsWith(" ") || formula.endsWith(" ")) {
                return match;
            }
            const key = `@@MATH_INL_${tokens.length}@@`;
            tokens.push({ key, formula: trimmed, display: false });
            return `${prefix}${key}`;
        });

        safeText = safeText.replace(/\\\(([\s\S]*?)\\\)/g, (match, formula) => {
            const key = `@@MATH_INL_${tokens.length}@@`;
            tokens.push({ key, formula: formula.trim(), display: false });
            return key;
        });

        return { text: safeText, tokens };
    }

    function restoreMathTokens(html, tokens) {
        if (!html || !tokens || !tokens.length) return html;
        let restored = html;
        tokens.forEach(t => {
            const mathSyntax = t.display ? `$$${t.formula}$$` : `$${t.formula}$`;
            restored = restored.split(t.key).join(mathSyntax);
        });
        return restored;
    }

    // Nâng cấp khối code block: bọc wrapper, thêm header ngôn ngữ và nút Copy code
    function enhanceCodeBlocks(container) {
        if (!container) return;
        const preElements = container.querySelectorAll("pre");
        preElements.forEach(pre => {
            if (pre.parentElement && pre.parentElement.classList.contains("code-block-wrapper")) {
                return;
            }

            const codeEl = pre.querySelector("code");
            let lang = "CODE";
            if (codeEl) {
                const classes = codeEl.className.split(/\s+/);
                for (const cls of classes) {
                    if (cls.startsWith("language-")) {
                        lang = cls.replace("language-", "").toUpperCase();
                        break;
                    }
                }
            }

            const wrapper = document.createElement("div");
            wrapper.className = "code-block-wrapper";

            const header = document.createElement("div");
            header.className = "code-block-header";
            header.innerHTML = `
                <span class="code-lang-badge">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                    <span>${escapeHtml(lang)}</span>
                </span>
                <button class="code-copy-btn" type="button" title="Sao chép mã nguồn">
                    <svg class="copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <span class="copy-text">Sao chép</span>
                </button>
            `;

            const copyBtn = header.querySelector(".code-copy-btn");
            if (copyBtn) {
                copyBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const codeToCopy = codeEl ? codeEl.innerText : pre.innerText;
                    let copied = false;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        try {
                            await navigator.clipboard.writeText(codeToCopy);
                            copied = true;
                        } catch (err) {
                            console.warn("Clipboard API failed, fallback to execCommand", err);
                        }
                    }
                    if (!copied) {
                        const tempTa = document.createElement("textarea");
                        tempTa.value = codeToCopy;
                        tempTa.style.position = "fixed";
                        tempTa.style.left = "-9999px";
                        document.body.appendChild(tempTa);
                        tempTa.select();
                        try {
                            document.execCommand("copy");
                            copied = true;
                        } catch (e2) {}
                        document.body.removeChild(tempTa);
                    }

                    if (copied) {
                        copyBtn.classList.add("copied");
                        copyBtn.innerHTML = `
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            <span>Đã chép!</span>
                        `;
                        setTimeout(() => {
                            copyBtn.classList.remove("copied");
                            copyBtn.innerHTML = `
                                <svg class="copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                <span class="copy-text">Sao chép</span>
                            `;
                        }, 2000);
                    }
                });
            }

            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(header);
            wrapper.appendChild(pre);
        });
    }

    // Bọc bảng Markdown vào div.table-responsive để cuộn ngang độc lập
    function enhanceTables(container) {
        if (!container) return;
        const tables = container.querySelectorAll("table");
        tables.forEach(table => {
            if (table.parentElement && table.parentElement.classList.contains("table-responsive")) {
                return;
            }
            const wrapper = document.createElement("div");
            wrapper.className = "table-responsive";
            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);
        });
    }

    // Hàm render Markdown + LaTeX + Code Block + Tables tập trung
    function renderRichContent(rawText, container) {
        if (!container) return;
        if (!rawText) {
            container.innerHTML = "";
            return;
        }

        const { text: safeText, tokens } = protectMathTokens(rawText);
        let html = "";
        try {
            html = marked.parse(safeText);
        } catch (e) {
            html = escapeHtml(safeText).replace(/\n/g, "<br>");
        }

        html = restoreMathTokens(html, tokens);
        container.innerHTML = html;

        enhanceTables(container);
        enhanceCodeBlocks(container);
        renderKaTeX(container);
    }

    // ---------------------- GIAO DIỆN MẶC ĐỊNH SÁNG & THEME TOGGLE ----------------------
    function initTheme() {
        const savedTheme = localStorage.getItem("HPU2_THEME") || "light";
        if (savedTheme === "dark") {
            document.body.classList.add("dark-theme");
            updateThemeIcon(true);
        } else {
            document.body.classList.remove("dark-theme");
            updateThemeIcon(false);
        }
    }

    function updateThemeIcon(isDark) {
        if (!themeToggleBtn) return;
        themeToggleBtn.innerHTML = isDark
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        themeToggleBtn.title = isDark ? "Chuyển sang giao diện Sáng" : "Chuyển sang giao diện Tối";
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", () => {
            const isDark = document.body.classList.toggle("dark-theme");
            localStorage.setItem("HPU2_THEME", isDark ? "dark" : "light");
            updateThemeIcon(isDark);
        });
    }

    // Chạy khởi tạo theme ngay
    initTheme();
    initChatParameters();

    // ---------------------- TABS NAVIGATION ----------------------
    const navTabsContainer = document.querySelector(".nav-tabs");
    if (navTabsContainer) {
        navTabsContainer.addEventListener("wheel", (e) => {
            if (e.deltaY !== 0 && navTabsContainer.scrollWidth > navTabsContainer.clientWidth) {
                e.preventDefault();
                navTabsContainer.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-tab");
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => {
                c.classList.remove("active");
                c.style.display = "none";
            });
            btn.classList.add("active");

            // Cuộn tab đã chọn vào giữa màn hình nếu thanh tab bị cuộn
            try {
                btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            } catch (_) {}

            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add("active");
                targetSection.style.display = "flex";
            }

            if (targetId === "tab-documents") {
                loadDocumentsList();
            }
            if (targetId === "tab-office") {
                loadOfficeFilesList();
            }
            if (targetId === "tab-roleplay") {
            
    // =========================================================================
    // AI PLAYGROUND: STABLE DIFFUSION 1.5 IMAGE STUDIO LOGIC
    // =========================================================================
    let currentSdStyle = "none";
    let currentSdWidth = 512;
    let currentSdHeight = 512;
    let lastGeneratedSeed = null;

    const SAMPLE_SD_PROMPTS = [
        "Một chú phi hành gia mèo đáng yêu đang lơ lửng ngắm Trái Đất trong không gian vũ trụ, ánh sao lấp lánh, phong cách anime rực rỡ, 8k",
        "A futuristic cyberpunk Vietnamese street food stall at night, glowing neon signs, rain reflections on asphalt, highly detailed, cinematic lighting",
        "Lâu đài cổ tích trên mây bồng bềnh, thác nước đổ xuống không trung, cầu vồng rực rỡ phong cách anime Makoto Shinkai, studio ghibli",
        "Chân dung một cô gái Việt Nam mặc áo dài trắng truyền thống đứng bên hồ sen mùa hạ, ánh nắng dịu dàng, ảnh chụp chân dung dslr 8k",
        "A majestic dragon perched on a mountain peak, storm clouds, lightning, dramatic cinematic lighting, 8k concept art, Artstation trending",
        "Robot cổ điển phong cách steampunk bằng đồng thau đang đọc sách trong thư viện cổ ngập tràn ánh nắng vàng ấm áp",
        "Thành phố dưới đáy đại dương rực rỡ san hô phát sáng, cá voi khổng lồ bơi qua các tháp kính pha lê, phong cách digital 3d Unreal Engine",
        "Một tách cà phê nóng tỏa khói bốc lên hình trái tim trên bàn gỗ bên cửa sổ ngắm mưa rơi, không khí ấm cúng, ảnh chụp macro dslr"
    ];

    function initImageStudio() {
        const sdModelSelect = document.getElementById("sd-model-select");
        const sdPromptInput = document.getElementById("sd-prompt-input");
        const sdEnhanceCheck = document.getElementById("sd-enhance-prompt-check");
        const sdStylePills = document.querySelectorAll(".sd-style-pill");
        const sdRatioBtns = document.querySelectorAll(".sd-ratio-btn");
        const sdToggleAdvancedBtn = document.getElementById("sd-toggle-advanced-btn");
        const sdAdvancedPanel = document.getElementById("sd-advanced-panel");
        const sdNegPromptInput = document.getElementById("sd-neg-prompt");
        const sdStepsSlider = document.getElementById("sd-steps-slider");
        const sdStepsVal = document.getElementById("sd-steps-val");
        const sdCfgSlider = document.getElementById("sd-cfg-slider");
        const sdCfgVal = document.getElementById("sd-cfg-val");
        const sdSeedInput = document.getElementById("sd-seed-input");
        const sdGenerateBtn = document.getElementById("sd-generate-btn");
        const sdSampleBtn = document.getElementById("sd-btn-sample-prompt");
        const sdEmptyState = document.getElementById("sd-empty-state");
        const sdLoadingState = document.getElementById("sd-loading-state");
        const sdResultState = document.getElementById("sd-result-state");
        const sdResultImg = document.getElementById("sd-result-img");
        const sdDownloadBtn = document.getElementById("sd-download-btn");
        const sdReuseSeedBtn = document.getElementById("sd-reuse-seed-btn");
        const sdMetaTime = document.getElementById("sd-meta-time");
        const sdMetaSize = document.getElementById("sd-meta-size");
        const sdMetaSeed = document.getElementById("sd-meta-seed");
        const sdPromptUsedBox = document.getElementById("sd-prompt-used-box");
        const sdPromptUsedText = document.getElementById("sd-prompt-used-text");
        const sdStyleBadge = document.getElementById("sd-style-badge");
        const sdHistoryGrid = document.getElementById("sd-history-grid");
        const sdHistoryCount = document.getElementById("sd-history-count");
        const sdRefreshHistoryBtn = document.getElementById("sd-refresh-history-btn");
        const sdGpuBadge = document.getElementById("sd-gpu-badge");

        // 1. Style Pills Handler
        sdStylePills.forEach(pill => {
            pill.addEventListener("click", () => {
                sdStylePills.forEach(p => p.classList.remove("active"));
                pill.classList.add("active");
                currentSdStyle = pill.getAttribute("data-style") || "none";
            });
        });

        // 2. Aspect Ratio Buttons Handler
        sdRatioBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                sdRatioBtns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                currentSdWidth = parseInt(btn.getAttribute("data-width") || 512);
                currentSdHeight = parseInt(btn.getAttribute("data-height") || 512);
            });
        });

        // 3. Toggle Advanced Panel
        if (sdToggleAdvancedBtn && sdAdvancedPanel) {
            sdToggleAdvancedBtn.addEventListener("click", () => {
                const isHidden = sdAdvancedPanel.style.display === "none";
                sdAdvancedPanel.style.display = isHidden ? "block" : "none";
                const svg = sdToggleAdvancedBtn.querySelector("svg");
                if (svg) svg.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
            });
        }

        // 4. Sliders live update
        if (sdStepsSlider && sdStepsVal) {
            sdStepsSlider.addEventListener("input", () => {
                sdStepsVal.textContent = sdStepsSlider.value;
            });
        }
        if (sdCfgSlider && sdCfgVal) {
            sdCfgSlider.addEventListener("input", () => {
                sdCfgVal.textContent = parseFloat(sdCfgSlider.value).toFixed(1);
            });
        }

        // 5. Random Sample Prompt
        if (sdSampleBtn && sdPromptInput) {
            sdSampleBtn.addEventListener("click", () => {
                const randomPrompt = SAMPLE_SD_PROMPTS[Math.floor(Math.random() * SAMPLE_SD_PROMPTS.length)];
                sdPromptInput.value = randomPrompt;
                sdPromptInput.focus();
            });
        }

        // 6. Reuse Seed
        if (sdReuseSeedBtn && sdSeedInput) {
            sdReuseSeedBtn.addEventListener("click", () => {
                if (lastGeneratedSeed !== null && lastGeneratedSeed !== undefined) {
                    sdSeedInput.value = lastGeneratedSeed;
                    if (sdAdvancedPanel && sdAdvancedPanel.style.display === "none") {
                        sdAdvancedPanel.style.display = "block";
                    }
                    sdSeedInput.focus();
                    alert(`Đã gán Seed: ${lastGeneratedSeed} vào ô cài đặt nâng cao!`);
                }
            });
        }

        // 7. Load GPU & Model Status
        async function loadSdStatus() {
            try {
                const res = await fetchApiWithFallback("/api/image/status");
                const data = await res.json();
                if (data.success && sdGpuBadge) {
                    if (data.device === "cuda") {
                        sdGpuBadge.innerHTML = `<span class="dot green"></span> GPU: ${data.device_name} (${data.vram_total_gb}GB VRAM)`;
                    } else {
                        sdGpuBadge.innerHTML = `<span class="dot yellow"></span> CPU Mode`;
                    }
                }
            } catch (e) {
                console.warn("[SDStudio] Lỗi lấy status GPU:", e);
            }
        }

        // 8. Load Models Dropdown
        async function loadSdModels() {
            try {
                const res = await fetchApiWithFallback("/api/image/models");
                const data = await res.json();
                if (data.success && data.models && sdModelSelect) {
                    sdModelSelect.innerHTML = "";
                    data.models.forEach(m => {
                        const opt = document.createElement("option");
                        opt.value = m.id;
                        opt.textContent = m.name;
                        sdModelSelect.appendChild(opt);
                    });
                }
            } catch (e) {
                console.warn("[SDStudio] Lỗi nạp danh sách model SD:", e);
            }
        }

        // 9. Load History Gallery
        async function loadSdHistory() {
            if (!sdHistoryGrid) return;
            try {
                const res = await fetchApiWithFallback("/api/image/history?limit=30");
                const data = await res.json();
                if (data.success && data.history) {
                    if (sdHistoryCount) sdHistoryCount.textContent = data.history.length;
                    sdHistoryGrid.innerHTML = "";

                    if (data.history.length === 0) {
                        sdHistoryGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 20px; color: var(--text-muted); font-size: 0.85rem;">Chưa có tác phẩm nào trong thư viện. Hãy tạo ảnh đầu tiên!</div>`;
                        return;
                    }

                    const apiBase = CONFIG.getApiBase();
                    data.history.forEach(item => {
                        const card = document.createElement("div");
                        card.className = "sd-history-card";
                        const fullImgUrl = `${apiBase}${item.url}`;

                        card.innerHTML = `
                            <img src="${fullImgUrl}" alt="${escapeHtml(item.prompt)}" loading="lazy">
                            <div class="sd-history-card-hover">
                                <div class="sd-history-prompt-preview">${escapeHtml(item.prompt)}</div>
                                <div class="sd-history-card-actions">
                                    <button type="button" class="btn-use-prompt" title="Dùng lại Prompt này">📋 Dùng</button>
                                    <button type="button" class="btn-view-card" title="Xem trên Canvas">👁️ Xem</button>
                                    <a href="${fullImgUrl}" download="${item.filename}" title="Tải về">⬇️</a>
                                </div>
                            </div>
                        `;

                        // Click to view on canvas
                        const viewBtn = card.querySelector(".btn-view-card");
                        if (viewBtn) {
                            viewBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                displayImageOnCanvas(item);
                            });
                        }

                        // Click to reuse prompt
                        const promptBtn = card.querySelector(".btn-use-prompt");
                        if (promptBtn) {
                            promptBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                if (sdPromptInput) {
                                    sdPromptInput.value = item.prompt;
                                    sdPromptInput.focus();
                                }
                                if (item.style) {
                                    sdStylePills.forEach(p => {
                                        if (p.getAttribute("data-style") === item.style) p.click();
                                    });
                                }
                            });
                        }

                        card.addEventListener("click", () => {
                            displayImageOnCanvas(item);
                        });

                        sdHistoryGrid.appendChild(card);
                    });
                }
            } catch (e) {
                console.warn("[SDStudio] Lỗi tải lịch sử ảnh:", e);
            }
        }

        function displayImageOnCanvas(item) {
            const apiBase = CONFIG.getApiBase();
            const fullImgUrl = `${apiBase}${item.url}`;
            if (sdResultImg) sdResultImg.src = fullImgUrl;
            if (sdDownloadBtn) {
                sdDownloadBtn.href = fullImgUrl;
                sdDownloadBtn.setAttribute("download", item.filename);
            }
            if (sdMetaTime) sdMetaTime.textContent = `⚡ ${item.time_taken || 0}s`;
            if (sdMetaSize) sdMetaSize.textContent = `📐 ${item.width || 512}×${item.height || 512}`;
            if (sdMetaSeed) sdMetaSeed.textContent = `🌱 Seed: ${item.seed || '-'}`;
            lastGeneratedSeed = item.seed;

            if (sdPromptUsedBox && sdPromptUsedText) {
                sdPromptUsedBox.style.display = "block";
                sdPromptUsedText.textContent = item.enhanced_prompt || item.prompt;
                if (sdStyleBadge) sdStyleBadge.textContent = item.style_name || item.style || "Tự do";
            }

            if (sdEmptyState) sdEmptyState.style.display = "none";
            if (sdLoadingState) sdLoadingState.style.display = "none";
            if (sdResultState) sdResultState.style.display = "flex";

            try {
                const canvasCard = document.querySelector(".sd-canvas-card");
                if (canvasCard) canvasCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } catch (_) {}
        }

        // 10. Generate Button Handler
        if (sdGenerateBtn) {
            sdGenerateBtn.addEventListener("click", async () => {
                const prompt = sdPromptInput ? sdPromptInput.value.trim() : "";
                if (!prompt) {
                    alert("Vui lòng nhập mô tả ý tưởng bức ảnh cần tạo!");
                    if (sdPromptInput) sdPromptInput.focus();
                    return;
                }

                const negativePrompt = sdNegPromptInput ? sdNegPromptInput.value.trim() : "";
                const steps = sdStepsSlider ? parseInt(sdStepsSlider.value) : 25;
                const cfgScale = sdCfgSlider ? parseFloat(sdCfgSlider.value) : 7.5;
                const seed = sdSeedInput ? parseInt(sdSeedInput.value) : -1;
                const enhancePrompt = sdEnhanceCheck ? sdEnhanceCheck.checked : true;
                const modelId = sdModelSelect ? sdModelSelect.value : "runwayml/stable-diffusion-v1-5";

                sdGenerateBtn.disabled = true;
                if (sdEmptyState) sdEmptyState.style.display = "none";
                if (sdResultState) sdResultState.style.display = "none";
                if (sdPromptUsedBox) sdPromptUsedBox.style.display = "none";
                if (sdLoadingState) sdLoadingState.style.display = "flex";

                const loadingDesc = document.getElementById("sd-loading-desc");
                if (loadingDesc) {
                    loadingDesc.textContent = enhancePrompt 
                        ? "Đang dùng Ollama dịch & tối ưu prompt, sau đó nạp vào pipeline SD 1.5 trên GPU Quadro P600..." 
                        : "Đang khuếch tán không gian tiềm ẩn (Latent Diffusion 25 steps) trên GPU Quadro P600...";
                }

                try {
                    const res = await fetchApiWithFallback("/api/image/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prompt: prompt,
                            negative_prompt: negativePrompt,
                            style: currentSdStyle,
                            width: currentSdWidth,
                            height: currentSdHeight,
                            steps: steps,
                            cfg_scale: cfgScale,
                            seed: seed,
                            enhance_prompt: enhancePrompt,
                            model_id: modelId
                        })
                    });

                    const data = await res.json();
                    if (!res.ok || !data.success) {
                        throw new Error(data.error || "Không thể tạo ảnh từ mô hình SD 1.5.");
                    }

                    displayImageOnCanvas(data);
                    await loadSdHistory();

                } catch (err) {
                    console.error("[SDStudio] Lỗi tạo ảnh:", err);
                    alert(`Lỗi khi tạo ảnh: ${err.message || 'Lỗi server'}`);
                    if (sdEmptyState) sdEmptyState.style.display = "flex";
                    if (sdLoadingState) sdLoadingState.style.display = "none";
                } finally {
                    sdGenerateBtn.disabled = false;
                }
            });
        }

        if (sdRefreshHistoryBtn) {
            sdRefreshHistoryBtn.addEventListener("click", () => {
                loadSdHistory();
            });
        }

        // Initial loading calls
        loadSdStatus();
        loadSdModels();
        loadSdHistory();
    }

    initImageStudio();
    initRoleplay();
            }
            if (targetId === "tab-admin-models") {
                initAdminModels();
            }
        });
    });

    const headerAdminModelsBtn = document.getElementById("header-admin-models-btn");
    if (headerAdminModelsBtn) {
        headerAdminModelsBtn.addEventListener("click", () => {
            const tabNavAdminModels = document.getElementById("tab-nav-admin-models");
            if (tabNavAdminModels) tabNavAdminModels.click();
        });
    }

    // Subtabs in OCR
    const subtabBtns = document.querySelectorAll(".subtab-btn");
    const subtabContents = document.querySelectorAll(".subtab-content");
    subtabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-subtab");
            subtabBtns.forEach(b => b.classList.remove("active"));
            subtabContents.forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            const targetContent = document.getElementById(target);
            if (targetContent) targetContent.classList.add("active");
        });
    });

    // Slider Reranker Threshold
    if (rerankerThresholdSlider && thresholdValText) {
        rerankerThresholdSlider.addEventListener("input", (e) => {
            thresholdValText.textContent = parseFloat(e.target.value).toFixed(2);
        });
    }

    // Auto-expanding textareas
    function setupAutoExpand(textarea) {
        if (!textarea) return;
        textarea.addEventListener("input", () => {
            textarea.style.height = "auto";
            textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
        });
    }
    setupAutoExpand(directChatInput);
    setupAutoExpand(ragChatInput);

    // ---------------------- USER AUTHENTICATION & UI ----------------------
    function updateUserUI() {
        const tabNavAdminModels = document.getElementById("tab-nav-admin-models");
        const headerAdminModelsBtn = document.getElementById("header-admin-models-btn");

        // Tab Quản lý LLM luôn hiển thị trên thanh điều hướng để người dùng có thể nhấp vào bất kỳ lúc nào
        if (tabNavAdminModels) tabNavAdminModels.style.display = "inline-flex";

        if (currentUser && currentUser.username && currentUser.username !== "guest") {
            loggedInBox.style.display = "flex";
            if (authButtonsGroup) authButtonsGroup.style.display = "none";
            userDisplayName.textContent = currentUser.username;

            const isAdmin = currentUser.role === "admin" || (currentUser.username && currentUser.username.toLowerCase() === "admin");
            if (isAdmin) {
                userRoleBadge.textContent = "👑 Quản trị viên";
                userRoleBadge.className = "user-role-badge admin-badge";
                if (adminUserFilter) adminUserFilter.style.display = "inline-block";
                if (headerAdminModelsBtn) headerAdminModelsBtn.style.display = "inline-block";
            } else {
                userRoleBadge.textContent = "👤 Người dùng";
                userRoleBadge.className = "user-role-badge user-badge";
                if (adminUserFilter) adminUserFilter.style.display = "none";
                if (headerAdminModelsBtn) headerAdminModelsBtn.style.display = "none";
            }
        } else {
            loggedInBox.style.display = "none";
            if (authButtonsGroup) authButtonsGroup.style.display = "flex";
            if (adminUserFilter) adminUserFilter.style.display = "none";
            if (headerAdminModelsBtn) headerAdminModelsBtn.style.display = "none";
        }
    }

    function setCurrentUser(user) {
        currentUser = user;
        if (user && user.username !== "guest") {
            localStorage.setItem("HPU2_USER", JSON.stringify(user));
        } else {
            localStorage.removeItem("HPU2_USER");
        }
        updateUserUI();
        loadConfig();
        loadDocumentsList();
        loadHistorySessions();
        const tabAdminSection = document.getElementById("tab-admin-models");
        if (tabAdminSection && tabAdminSection.classList.contains("active")) {
            initAdminModels();
        }
    }

    // Chuyển đổi giữa Đăng Nhập và Đăng Ký (Không cần email)
    function switchAuthMode(mode) {
        authMode = mode;
        authErrorMsg.style.display = "none";
        authSuccessMsg.style.display = "none";

        if (mode === "login") {
            tabLoginBtn.className = "btn btn-primary btn-sm active";
            tabRegisterBtn.className = "btn btn-secondary btn-sm";
            authModalTitle.textContent = "🔐 Đăng Nhập Hệ Thống";
            authSubmitBtn.textContent = "Đăng Nhập";
            confirmPasswordGroup.style.display = "none";
            authPasswordConfirm.required = false;
            signupNoEmailBanner.style.display = "none";
            quickLoginHintsBox.style.display = "block";
            authSwitchPrompt.textContent = "Chưa có tài khoản?";
            authSwitchAction.textContent = "Đăng ký ngay (Không cần email)";
        } else {
            tabRegisterBtn.className = "btn btn-primary btn-sm active";
            tabLoginBtn.className = "btn btn-secondary btn-sm";
            authModalTitle.textContent = "📝 Đăng Ký Tài Khoản";
            authSubmitBtn.textContent = "🚀 Tạo Tài Khoản & Bắt Đầu Ngay";
            confirmPasswordGroup.style.display = "block";
            authPasswordConfirm.required = true;
            signupNoEmailBanner.style.display = "flex";
            quickLoginHintsBox.style.display = "none";
            authSwitchPrompt.textContent = "Đã có tài khoản?";
            authSwitchAction.textContent = "Đăng nhập ngay";
        }
    }

    if (openLoginBtn) {
        openLoginBtn.addEventListener("click", () => {
            switchAuthMode("login");
            authModal.style.display = "flex";
            authUsernameInput.focus();
        });
    }

    if (openSignupBtn) {
        openSignupBtn.addEventListener("click", () => {
            switchAuthMode("register");
            authModal.style.display = "flex";
            authUsernameInput.focus();
        });
    }

    if (tabLoginBtn) tabLoginBtn.addEventListener("click", () => switchAuthMode("login"));
    if (tabRegisterBtn) tabRegisterBtn.addEventListener("click", () => switchAuthMode("register"));

    if (authSwitchAction) {
        authSwitchAction.addEventListener("click", () => {
            switchAuthMode(authMode === "login" ? "register" : "login");
        });
    }

    if (closeAuthModalBtn) {
        closeAuthModalBtn.addEventListener("click", () => {
            authModal.style.display = "none";
        });
    }

    if (authModal) {
        authModal.addEventListener("click", (e) => {
            if (e.target === authModal) authModal.style.display = "none";
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            if (confirm(`Bạn có muốn đăng xuất khỏi tài khoản '${currentUser.username}'?`)) {
                setCurrentUser({ username: "guest", role: "user", is_admin: false });
            }
        });
    }

    // Ẩn/Hiện mật khẩu qua icon mắt
    togglePasswordBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-target");
            const input = document.getElementById(targetId);
            if (input) {
                const isPassword = input.type === "password";
                input.type = isPassword ? "text" : "password";
                btn.style.color = isPassword ? "var(--primary)" : "var(--text-muted)";
            }
        });
    });

    // Chọn nhanh tài khoản mẫu CSDL Neon
    quickAccountBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            authUsernameInput.value = btn.getAttribute("data-user");
            authPasswordInput.value = btn.getAttribute("data-pass");
            switchAuthMode("login");
        });
    });

    // Submit Auth Form (Đăng nhập / Đăng ký không cần email)
    if (authForm) {
        authForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const username = authUsernameInput.value.trim();
            const password = authPasswordInput.value.trim();
            const passwordConfirm = authPasswordConfirm.value.trim();

            authErrorMsg.style.display = "none";
            authSuccessMsg.style.display = "none";

            if (!username || !password) {
                authErrorMsg.textContent = "Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.";
                authErrorMsg.style.display = "block";
                return;
            }

            if (authMode === "register") {
                if (username.length < 3) {
                    authErrorMsg.textContent = "Tên đăng nhập phải có ít nhất 3 ký tự.";
                    authErrorMsg.style.display = "block";
                    return;
                }
                if (password.length < 4) {
                    authErrorMsg.textContent = "Mật khẩu phải có ít nhất 4 ký tự.";
                    authErrorMsg.style.display = "block";
                    return;
                }
                if (password !== passwordConfirm) {
                    authErrorMsg.textContent = "Mật khẩu xác nhận không trùng khớp!";
                    authErrorMsg.style.display = "block";
                    authPasswordConfirm.focus();
                    return;
                }
            }

            authSubmitBtn.disabled = true;
            authSubmitBtn.textContent = "Đang xử lý...";

            const apiBase = CONFIG.getApiBase();
            const endpoint = authMode === "login" ? `${apiBase}/api/auth/login` : `${apiBase}/api/auth/register`;

            try {
                const res = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    throw new Error(data.error || (authMode === "login" ? "Sai tên đăng nhập hoặc mật khẩu." : "Đăng ký thất bại."));
                }

                if (authMode === "register") {
                    authSuccessMsg.textContent = `🎉 Đăng ký thành công tài khoản '${username}'! Đang đăng nhập...`;
                    authSuccessMsg.style.display = "block";
                    setTimeout(() => {
                        setCurrentUser(data.user);
                        authModal.style.display = "none";
                        authForm.reset();
                    }, 800);
                } else {
                    setCurrentUser(data.user);
                    authModal.style.display = "none";
                    authForm.reset();
                }

            } catch (err) {
                authErrorMsg.textContent = err.message;
                authErrorMsg.style.display = "block";
            } finally {
                authSubmitBtn.disabled = false;
                authSubmitBtn.textContent = authMode === "login" ? "Đăng Nhập" : "🚀 Tạo Tài Khoản & Bắt Đầu Ngay";
            }
        });
    }

    // ---------------------- LOAD CONFIG & MODEL PICKERS ----------------------
    async function loadConfig() {
        const apiBase = CONFIG.getApiBase();
        try {
            const res = await fetch(`${apiBase}/api/config?username=${encodeURIComponent(currentUser.username)}&role=${currentUser.role}`, {
                headers: {
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            currentConfig = await res.json();

            // Cập nhật tất cả các bộ chọn mô hình trên toàn hệ thống
            if (currentConfig.models) {
                updateAllModelSelectors(currentConfig.models, currentConfig.default_model);
            }

            // Populate Collections cho RAG Selector
            allAvailableCollections = currentConfig.collections || [];
            renderCollectionsCheckboxList();

        } catch (e) {
            console.error("Lỗi khi kết nối API Config:", e);
        }
    }

    // ---------------------- MULTI-DOC RAG SELECTOR ----------------------
    function renderCollectionsCheckboxList(filterText = "") {
        if (!collectionsCheckboxList) return;
        collectionsCheckboxList.innerHTML = "";
        const query = filterText.toLowerCase().trim();

        const filtered = allAvailableCollections.filter(c => 
            c.name.toLowerCase().includes(query) || (c.source && c.source.toLowerCase().includes(query))
        );

        if (filtered.length === 0) {
            collectionsCheckboxList.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted); padding:0.6rem; text-align:center;">Không tìm thấy tài liệu phù hợp</div>`;
            updateSelectedChips();
            return;
        }

        filtered.forEach(col => {
            const isChecked = selectedCollections.has(col.name);
            const item = document.createElement("div");
            item.className = "doc-check-item";

            let typeBadge = "";
            if (col.type === "multimodal") {
                typeBadge = `<span class="doc-badge-sm" style="color:#a855f7;">Ảnh</span>`;
            } else if (col.doc_count) {
                typeBadge = `<span class="doc-badge-sm">${col.doc_count} docs</span>`;
            }

            item.innerHTML = `
                <label>
                    <input type="checkbox" value="${col.name}" ${isChecked ? "checked" : ""}>
                    <span class="doc-name" title="${col.name}">${col.name}</span>
                </label>
                <div style="display:flex; align-items:center; gap:0.25rem;">
                    ${typeBadge}
                </div>
            `;

            const chk = item.querySelector("input");
            chk.addEventListener("change", (e) => {
                if (e.target.checked) {
                    selectedCollections.add(col.name);
                } else {
                    selectedCollections.delete(col.name);
                }
                updateSelectedChips();
            });

            collectionsCheckboxList.appendChild(item);
        });

        updateSelectedChips();
    }

    function updateSelectedChips() {
        if (!selectedDocsCountEl || !selectedDocsChipsEl) return;
        selectedDocsCountEl.textContent = selectedCollections.size;
        if (mobileSelectedCount) {
            mobileSelectedCount.textContent = selectedCollections.size;
        }
        selectedDocsChipsEl.innerHTML = "";

        if (selectedCollections.size === 0) {
            selectedDocsChipsEl.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">Chưa chọn tài liệu nào (Hãy tích chọn ít nhất 1 tài liệu để RAG)</span>`;
            return;
        }

        selectedCollections.forEach(colName => {
            const chip = document.createElement("span");
            chip.className = "selected-chip";
            chip.innerHTML = `
                <span>${colName}</span>
                <span class="remove-chip" title="Bỏ chọn">&times;</span>
            `;

            chip.querySelector(".remove-chip").addEventListener("click", () => {
                selectedCollections.delete(colName);
                renderCollectionsCheckboxList(docSearchInput ? docSearchInput.value : "");
            });

            selectedDocsChipsEl.appendChild(chip);
        });
    }

    if (selectAllDocsBtn) {
        selectAllDocsBtn.addEventListener("click", () => {
            allAvailableCollections.forEach(c => selectedCollections.add(c.name));
            renderCollectionsCheckboxList(docSearchInput ? docSearchInput.value : "");
        });
    }

    if (clearAllDocsBtn) {
        clearAllDocsBtn.addEventListener("click", () => {
            selectedCollections.clear();
            renderCollectionsCheckboxList(docSearchInput ? docSearchInput.value : "");
        });
    }

    if (docSearchInput) {
        docSearchInput.addEventListener("input", (e) => {
            renderCollectionsCheckboxList(e.target.value);
        });
    }

    // ---------------------- TIỆN ÍCH HIỂN THỊ TIN NHẮN CHAT ĐẸP & HIỆN ĐẠI ----------------------
    function escapeHtml(str) {
        return (str || "").replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));
    }

    function formatTime(d) {
        const date = d || new Date();
        const hours = String(date.getHours()).padStart(2, '0');
        const mins = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${mins}`;
    }

    /**
     * Tạo bong bóng chat User & Bot với dải màu gradient, avatar tròn, tên người gửi và timestamp
     */
    function appendMessage(sender, text, container, chatType = "direct", attachedImages = [], attachedFiles = []) {
        if (!container) return { contentEl: null, metaEl: null, imagesEl: null };

        // Nếu container đang chứa hero card chào mừng thì xóa đi khi có tin nhắn đầu tiên
        const heroCard = container.querySelector(".chat-hero-card");
        if (heroCard) {
            heroCard.remove();
        }

        const msg = document.createElement("div");
        msg.className = `message ${sender}`;

        const msgContent = document.createElement("div");
        msgContent.className = "message-content";

        const senderTitle = document.createElement("div");
        senderTitle.className = "message-sender-title";

        const timeStr = formatTime(new Date());

        let avatarEl = document.createElement("div");
        let contentEl = document.createElement("div");
        contentEl.className = "content";

        let metaEl = null;
        let imagesEl = null;

        if (sender === "user") {
            // USER AVATAR & HEADER
            avatarEl.className = "avatar user-avatar";
            const initials = (currentUser.username || "U").substring(0, 2).toUpperCase();
            avatarEl.innerHTML = `<span>${initials}</span>`;

            senderTitle.innerHTML = `
                <span class="sender-name">${escapeHtml(currentUser.username || "Bạn")}</span>
                <span class="message-time">${timeStr}</span>
            `;

            renderRichContent(text || "", contentEl);

            msgContent.appendChild(senderTitle);

            // Nếu người dùng có đính kèm tệp văn bản / tài liệu / code
            if (attachedFiles && attachedFiles.length > 0) {
                const userFileWrap = document.createElement("div");
                userFileWrap.className = "user-attached-files-wrap";
                attachedFiles.forEach(f => {
                    const info = getFileIcon(f.file_type || f.ext || "");
                    const fname = f.filename || f.name || "Tệp đính kèm";
                    const fbadge = document.createElement("div");
                    fbadge.className = "user-file-badge";
                    fbadge.title = `${fname} (${info.label})`;
                    fbadge.innerHTML = `
                        <div class="user-file-icon" style="background:${info.color}18; color:${info.color};">
                            ${info.icon}
                        </div>
                        <div class="user-file-details">
                            <span class="user-file-name">${escapeHtml(fname)}</span>
                            <span class="user-file-meta">${info.label} • ${f.size_str || ''}${f.pages && f.pages > 1 ? ` • ${f.pages} trang` : ''}</span>
                        </div>
                    `;
                    userFileWrap.appendChild(fbadge);
                });
                msgContent.appendChild(userFileWrap);
            }

            // Nếu người dùng có đính kèm ảnh (multimodal query)
            if (attachedImages && attachedImages.length > 0) {
                const userImgWrap = document.createElement("div");
                userImgWrap.className = "user-attached-thumbnails";
                attachedImages.forEach(uImg => {
                    const uThumb = document.createElement("img");
                    uThumb.className = "user-thumb";
                    const src = typeof uImg === "string"
                        ? (uImg.startsWith("data:") ? uImg : `data:image/png;base64,${uImg}`)
                        : (uImg.url || (uImg.base64 ? `data:image/png;base64,${uImg.base64}` : ""));
                    uThumb.src = src;
                    uThumb.title = uImg.name || "Hình ảnh bạn gửi";
                    uThumb.addEventListener("click", () => {
                        if (enlargedModalImg && imagePreviewModal) {
                            enlargedModalImg.src = src;
                            imagePreviewModal.style.display = "flex";
                        }
                    });
                    userImgWrap.appendChild(uThumb);
                });
                msgContent.appendChild(userImgWrap);
            }

            msgContent.appendChild(contentEl);

            msg.appendChild(avatarEl);
            msg.appendChild(msgContent);

        } else {
            // BOT AVATAR & HEADER
            avatarEl.className = "avatar bot-avatar";
            avatarEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9Z"></path></svg>`;

            const badgeClass = chatType === "rag" ? "rag" : "direct";
            const badgeText = chatType === "rag" ? "📚 Chế Độ RAG" : "✨ Chat Trực Tiếp";

            senderTitle.innerHTML = `
                <span class="sender-name">AI Playground</span>
                <span class="sender-badge ${badgeClass}">${badgeText}</span>
                <span class="message-time">${timeStr}</span>
            `;

            imagesEl = document.createElement("div");
            imagesEl.className = "multimodal-chat-images";

            if (text) {
                renderRichContent(text, contentEl);
            } else {
                contentEl.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
            }

            metaEl = document.createElement("div");
            metaEl.className = "message-meta";

            msgContent.appendChild(senderTitle);
            msgContent.appendChild(imagesEl);
            msgContent.appendChild(contentEl);
            msgContent.appendChild(metaEl);

            msg.appendChild(avatarEl);
            msg.appendChild(msgContent);
        }

        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;

        return { contentEl, metaEl, imagesEl };
    }

    // ---------------------- HỖ TRỢ ĐỊNH DẠNG ICON VÀ KÍCH THƯỚC FILE ----------------------
    function getFileIcon(ext) {
        const e = (ext || "").toLowerCase().replace(".", "");
        if (["pdf"].includes(e)) {
            return {
                icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
                color: "#ef4444",
                label: "PDF"
            };
        }
        if (["doc", "docx"].includes(e)) {
            return {
                icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`,
                color: "#2563eb",
                label: "DOCX"
            };
        }
        if (["xls", "xlsx", "csv"].includes(e)) {
            return {
                icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><rect x="8" y="12" width="8" height="6"></rect></svg>`,
                color: "#16a34a",
                label: "EXCEL"
            };
        }
        if (["ppt", "pptx"].includes(e)) {
            return {
                icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><circle cx="12" cy="14" r="3"></circle></svg>`,
                color: "#ea580c",
                label: "PPTX"
            };
        }
        if (["py", "js", "ts", "html", "css", "c", "cpp", "h", "java", "sql", "sh", "yml", "yaml", "xml", "json"].includes(e)) {
            return {
                icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
                color: "#8b5cf6",
                label: e.toUpperCase()
            };
        }
        return {
            icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
            color: "#64748b",
            label: (e || "FILE").toUpperCase()
        };
    }

    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    // ---------------------- XỬ LÝ ĐÍNH KÈM TỆP VĂN BẢN & HÌNH ẢNH ----------------------
    function setupImageAttachment(type) {
        const fileInput = type === "direct" ? directImageFileInput : ragImageFileInput;
        const btn = type === "direct" ? directAttachImgBtn : ragAttachImgBtn;
        const textInput = type === "direct" ? directChatInput : ragChatInput;

        if (btn && fileInput) {
            btn.addEventListener("click", () => fileInput.click());
        }

        if (fileInput) {
            fileInput.addEventListener("change", (e) => {
                const files = Array.from(e.target.files || []);
                files.forEach(file => readAndAttachFile(file, type));
                fileInput.value = "";
            });
        }

        // Hỗ trợ dán ảnh hoặc tệp trực tiếp từ Clipboard (Ctrl + V)
        if (textInput) {
            textInput.addEventListener("paste", (e) => {
                const items = (e.clipboardData || window.clipboardData)?.items || [];
                for (const item of items) {
                    if (item.kind === "file") {
                        const file = item.getAsFile();
                        if (file) {
                            readAndAttachFile(file, type);
                        }
                    }
                }
            });

            // Hỗ trợ Kéo & Thả (Drag and Drop) file trực tiếp vào ô chat
            textInput.addEventListener("dragover", (e) => {
                e.preventDefault();
                textInput.classList.add("drag-over");
            });
            textInput.addEventListener("dragleave", (e) => {
                e.preventDefault();
                textInput.classList.remove("drag-over");
            });
            textInput.addEventListener("drop", (e) => {
                e.preventDefault();
                textInput.classList.remove("drag-over");
                const files = Array.from(e.dataTransfer?.files || []);
                files.forEach(file => readAndAttachFile(file, type));
            });
        }
    }

    async function readAndAttachFile(file, type) {
        if (!file) return;
        const list = type === "direct" ? directAttachedImages : ragAttachedImages;

        // 1. Nếu là ảnh: đọc base64 trực tiếp hiển thị ngay tức thì
        if (file.type && file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                const b64 = dataUrl.split(",")[1];
                const imgObj = {
                    name: file.name || `Ảnh dán (${formatTime()})`,
                    filename: file.name || `image_${Date.now()}.png`,
                    file_type: "image",
                    size: file.size,
                    size_str: formatBytes(file.size),
                    base64: b64,
                    url: dataUrl,
                    is_image: true
                };
                list.push(imgObj);
                renderAttachedPreviewStrip(type);
            };
            reader.readAsDataURL(file);
            return;
        }

        // 2. Nếu là tài liệu (PDF, Word, Excel, PPTX, Code, Text...)
        const ext = file.name ? file.name.split(".").pop().toLowerCase() : "";
        const placeholderItem = {
            name: file.name || "Tệp đính kèm",
            filename: file.name || "Tệp đính kèm",
            file_type: ext,
            size: file.size,
            size_str: formatBytes(file.size),
            is_image: false,
            loading: true
        };
        list.push(placeholderItem);
        renderAttachedPreviewStrip(type);

        const apiBase = CONFIG.getApiBase();
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`${apiBase}/api/chat/parse-file`, {
                method: "POST",
                headers: {
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                },
                body: formData
            });
            const data = await res.json();
            if (res.ok && data.success) {
                placeholderItem.loading = false;
                placeholderItem.filename = data.filename;
                placeholderItem.name = data.filename;
                placeholderItem.file_type = data.file_type;
                placeholderItem.size = data.size;
                placeholderItem.size_str = data.size_str;
                placeholderItem.pages = data.pages;
                placeholderItem.text = data.text;
                placeholderItem.char_count = data.char_count;
                placeholderItem.preview = data.preview;
                renderAttachedPreviewStrip(type);
            } else {
                throw new Error(data.error || "Không thể phân tích nội dung tệp.");
            }
        } catch (err) {
            console.error("Lỗi parse file đính kèm:", err);
            alert(`Lỗi đọc tệp "${file.name}": ${err.message}`);
            const idx = list.indexOf(placeholderItem);
            if (idx !== -1) list.splice(idx, 1);
            renderAttachedPreviewStrip(type);
        }
    }

    function renderAttachedPreviewStrip(type) {
        const previewContainer = type === "direct" ? directAttachedPreview : ragAttachedPreview;
        const list = type === "direct" ? directAttachedImages : ragAttachedImages;

        if (!previewContainer) return;

        if (list.length === 0) {
            previewContainer.style.display = "none";
            previewContainer.innerHTML = "";
            return;
        }

        previewContainer.style.display = "flex";
        previewContainer.innerHTML = "";

        list.forEach((item, idx) => {
            if (item.loading) {
                const wrap = document.createElement("div");
                wrap.className = "attached-file-pill loading";
                wrap.innerHTML = `
                    <div class="spinner-sm" style="width:14px; height:14px; border-width:2px; margin:0;"></div>
                    <span class="file-name">Đang đọc ${escapeHtml(item.name)}...</span>
                `;
                previewContainer.appendChild(wrap);
            } else if (item.is_image) {
                const wrap = document.createElement("div");
                wrap.className = "attached-thumb-wrap";
                wrap.innerHTML = `
                    <img src="${item.url}" alt="${escapeHtml(item.name)}" />
                    <span class="attach-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                    <button type="button" class="remove-attach-btn" title="Gỡ ảnh này">&times;</button>
                `;
                wrap.querySelector(".remove-attach-btn").addEventListener("click", () => {
                    list.splice(idx, 1);
                    renderAttachedPreviewStrip(type);
                });
                previewContainer.appendChild(wrap);
            } else {
                const info = getFileIcon(item.file_type || item.ext || "");
                const wrap = document.createElement("div");
                wrap.className = "attached-file-pill";
                wrap.innerHTML = `
                    <div class="file-icon-badge" style="background:${info.color}18; color:${info.color};">
                        ${info.icon}
                    </div>
                    <div class="file-info-col">
                        <span class="file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                        <span class="file-meta">${info.label} • ${item.size_str || ''}${item.pages && item.pages > 1 ? ` • ${item.pages} trang` : ''}</span>
                    </div>
                    <button type="button" class="remove-attach-btn" title="Gỡ tệp này">&times;</button>
                `;
                wrap.querySelector(".remove-attach-btn").addEventListener("click", () => {
                    list.splice(idx, 1);
                    renderAttachedPreviewStrip(type);
                });
                previewContainer.appendChild(wrap);
            }
        });
    }

    setupImageAttachment("direct");
    setupImageAttachment("rag");

    // ---------------------- RESPONSIVE MOBILE RAG SIDEBAR ----------------------
    if (mobileRagSidebarToggle && chatSidebar) {
        mobileRagSidebarToggle.addEventListener("click", () => {
            chatSidebar.classList.add("mobile-open");
            if (sidebarBackdrop) sidebarBackdrop.style.display = "block";
        });
    }

    if (closeMobileSidebarBtn && chatSidebar) {
        closeMobileSidebarBtn.addEventListener("click", () => {
            chatSidebar.classList.remove("mobile-open");
            if (sidebarBackdrop) sidebarBackdrop.style.display = "none";
        });
    }

    if (sidebarBackdrop && chatSidebar) {
        sidebarBackdrop.addEventListener("click", () => {
            chatSidebar.classList.remove("mobile-open");
            sidebarBackdrop.style.display = "none";
        });
    }

    // ---------------------- TAB 1: DIRECT CHAT LOGIC ----------------------
    function bindPromptChips() {
        document.querySelectorAll(".prompt-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                const text = chip.getAttribute("data-text") || chip.innerText.trim();
                if (directChatInput) {
                    directChatInput.value = text;
                    sendDirectMessage();
                }
            });
        });
    }
    bindPromptChips();

    if (newDirectChatBtn) {
        newDirectChatBtn.addEventListener("click", async () => {
            directChatHistory = [];
            directMessagesContainer.innerHTML = `
                <div class="chat-hero-card">
                    <div class="hero-icon">✨</div>
                    <h2>Trò Chuyện Trực Tiếp Với AI</h2>
                    <p>Hỏi đáp tự do, lập trình, giải toán và phân tích chuyên sâu cùng các mô hình trí tuệ nhân tạo thế hệ mới.</p>
                    
                    <div class="hero-prompt-suggestions">
                        <button class="prompt-chip" data-text="Giải thích ngắn gọn nguyên lý hoạt động của thuật toán tìm kiếm RAG và cơ chế Reranker">
                            💡 Nguyên lý hoạt động của RAG & Reranker
                        </button>
                        <button class="prompt-chip" data-text="Viết một đoạn code Python sử dụng thư viện PyMuPDF để bóc tách văn bản từ file PDF">
                            💻 Code Python bóc tách text từ PDF
                        </button>
                        <button class="prompt-chip" data-text="Viết công thức định lý Bayes và giải thích ý nghĩa từng thành phần bằng mã LaTeX">
                            📐 Công thức định lý Bayes bằng LaTeX
                        </button>
                        <button class="prompt-chip" data-text="Hãy gợi ý 5 phương pháp giảng dạy tích cực áp dụng cho môn Tin học phổ thông">
                            📖 5 phương pháp dạy Tin học tích cực
                        </button>
                    </div>
                </div>
            `;
            bindPromptChips();
            const apiBase = CONFIG.getApiBase();
            try {
                await fetch(`${apiBase}/api/history/clear`, { method: "POST" });
            } catch (e) {}
        });
    }

    if (directChatSendBtn) directChatSendBtn.addEventListener("click", sendDirectMessage);
    if (directChatInput) {
        directChatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendDirectMessage();
            }
        });
    }

    async function sendDirectMessage() {
        if (!directChatInput) return;
        const text = directChatInput.value.trim();
        const hasAttachments = directAttachedImages.length > 0;
        if (!text && !hasAttachments) return;

        const filesToSend = [...directAttachedImages];
        directAttachedImages = [];
        renderAttachedPreviewStrip("direct");

        const imagesToSend = filesToSend.filter(f => f.is_image);
        const docsToSend = filesToSend.filter(f => !f.is_image);

        let displayText = text;
        if (!displayText) {
            if (docsToSend.length > 0) {
                displayText = `(Tệp đính kèm: ${docsToSend.map(d => d.name || d.filename).join(", ")})`;
            } else {
                displayText = "(Hình ảnh gửi kèm)";
            }
        }

        const selectedModelId = selectModelDirect ? selectModelDirect.value : "qwen2.5:14b";

        appendMessage("user", displayText, directMessagesContainer, "direct", imagesToSend, docsToSend);
        notifySessionActivity("direct", displayText);
        directChatInput.value = "";
        directChatInput.style.height = "auto";
        if (directChatSendBtn) directChatSendBtn.disabled = true;

        const botMsgObj = appendMessage("bot", "", directMessagesContainer, "direct");
        const botContentEl = botMsgObj.contentEl;

        const apiBase = CONFIG.getApiBase();
        let fullReply = "";

        try {
            const res = await fetch(`${apiBase}/api/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    title: displayText.slice(0, 60),
                    message: text || displayText,
                    model: selectedModelId,
                    mode: "direct",
                    collections: [],
                    collection: "",
                    score_threshold: 0.3,
                    history: directChatHistory,
                    username: currentUser.username,
                    user_images: imagesToSend.map(img => img.base64).filter(Boolean),
                    attached_files: filesToSend,
                    options: getActiveChatOptions(),
                    system_prompt: getActiveSystemPrompt()
                })
            });

            if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop();

                for (const block of lines) {
                    if (block.startsWith("data: ")) {
                        const jsonStr = block.replace("data: ", "").trim();
                        try {
                            const data = JSON.parse(jsonStr);
                            if (data.type === "token") {
                                fullReply += data.content;
                                renderRichContent(fullReply, botContentEl);
                                directMessagesContainer.scrollTop = directMessagesContainer.scrollHeight;
                            } else if (data.type === "done") {
                                renderRichContent(fullReply, botContentEl);
                                if (data.session_id) {
                                    currentSessionId = data.session_id;
                                    localStorage.setItem("hpu2_session_id", currentSessionId);
                                }
                                notifySessionComplete(data.session_id || currentSessionId);
                            }
                        } catch (e) {
                            console.error("Lỗi parse SSE Direct Chat:", e);
                        }
                    }
                }
            }

            directChatHistory.push({ role: "user", content: displayText });
            directChatHistory.push({ role: "assistant", content: fullReply });

        } catch (e) {
            botContentEl.innerHTML = `<span style="color:var(--danger)">Lỗi kết nối API: ${e.message}</span>`;
        } finally {
            if (directChatSendBtn) directChatSendBtn.disabled = false;
        }
    }

    // ---------------------- TAB 2: RAG CHAT LOGIC ----------------------
    if (newRagChatBtn) {
        newRagChatBtn.addEventListener("click", async () => {
            ragChatHistory = [];
            ragMessagesContainer.innerHTML = `
                <div class="message bot">
                    <div class="avatar bot-avatar">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9Z"></path></svg>
                    </div>
                    <div class="message-content">
                        <div class="message-sender-title">
                            <span class="sender-name">AI Playground</span>
                            <span class="sender-badge rag">📚 Chế Độ RAG</span>
                            <span class="message-time">${formatTime(new Date())}</span>
                        </div>
                        <div class="content">
                            <p>Đã làm mới phiên hỏi đáp RAG! Bạn có thể chọn 1 hoặc nhiều tài liệu từ thanh bên trái và bắt đầu đặt câu hỏi tra cứu.</p>
                        </div>
                    </div>
                </div>
            `;
            const apiBase = CONFIG.getApiBase();
            try {
                await fetch(`${apiBase}/api/history/clear`, { method: "POST" });
            } catch (e) {}
        });
    }

    if (ragChatSendBtn) ragChatSendBtn.addEventListener("click", sendRagMessage);
    if (ragChatInput) {
        ragChatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendRagMessage();
            }
        });
    }

    async function sendRagMessage() {
        if (!ragChatInput) return;
        const text = ragChatInput.value.trim();
        const hasAttachments = ragAttachedImages.length > 0;
        if (!text && !hasAttachments) return;

        if (selectedCollections.size === 0) {
            alert("⚠️ Vui lòng tích chọn ít nhất 1 tài liệu ở khung bên trái để hệ thống trích xuất tri thức.");
            return;
        }

        const filesToSend = [...ragAttachedImages];
        ragAttachedImages = [];
        renderAttachedPreviewStrip("rag");

        const imagesToSend = filesToSend.filter(f => f.is_image);
        const docsToSend = filesToSend.filter(f => !f.is_image);

        let displayText = text;
        if (!displayText) {
            if (docsToSend.length > 0) {
                displayText = `(Tệp đính kèm: ${docsToSend.map(d => d.name || d.filename).join(", ")})`;
            } else {
                displayText = "(Hình ảnh gửi kèm câu hỏi RAG)";
            }
        }

        const selectedRagModeRadio = document.querySelector('input[name="rag-mode"]:checked');
        const selectedMode = selectedRagModeRadio ? selectedRagModeRadio.value : "rag_rerank";
        const selectedModelId = selectModelRag ? selectModelRag.value : "qwen2.5:14b";
        const threshold = rerankerThresholdSlider ? parseFloat(rerankerThresholdSlider.value) : 0.3;

        appendMessage("user", displayText, ragMessagesContainer, "rag", imagesToSend, docsToSend);
        notifySessionActivity("rag", displayText);
        ragChatInput.value = "";
        ragChatInput.style.height = "auto";
        if (ragChatSendBtn) ragChatSendBtn.disabled = true;

        const botMsgObj = appendMessage("bot", "", ragMessagesContainer, "rag");
        const botContentEl = botMsgObj.contentEl;
        const botMetaEl = botMsgObj.metaEl;
        const botImagesEl = botMsgObj.imagesEl;

        const apiBase = CONFIG.getApiBase();
        const collectionsArray = Array.from(selectedCollections);
        let fullReply = "";

        try {
            const res = await fetch(`${apiBase}/api/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    title: displayText.slice(0, 60),
                    message: text || displayText,
                    model: selectedModelId,
                    mode: selectedMode,
                    collections: collectionsArray,
                    collection: collectionsArray.join("+"),
                    score_threshold: threshold,
                    history: ragChatHistory,
                    username: currentUser.username,
                    user_images: imagesToSend.map(img => img.base64).filter(Boolean),
                    attached_files: filesToSend,
                    options: getActiveChatOptions(),
                    system_prompt: getActiveSystemPrompt()
                })
            });

            if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop();

                for (const block of lines) {
                    if (block.startsWith("data: ")) {
                        const jsonStr = block.replace("data: ", "").trim();
                        try {
                            const data = JSON.parse(jsonStr);

                            if (data.type === "citations") {
                                renderCitations(data.citations, botMetaEl);
                            } else if (data.type === "images") {
                                renderMultimodalImages(data.images, botImagesEl);
                            } else if (data.type === "token") {
                                fullReply += data.content;
                                renderRichContent(fullReply, botContentEl);
                                ragMessagesContainer.scrollTop = ragMessagesContainer.scrollHeight;
                            } else if (data.type === "done") {
                                renderRichContent(fullReply, botContentEl);
                                if (data.session_id) {
                                    currentSessionId = data.session_id;
                                    localStorage.setItem("hpu2_session_id", currentSessionId);
                                }
                                notifySessionComplete(data.session_id || currentSessionId);
                            }
                        } catch (e) {
                            console.error("Lỗi parse SSE RAG Chat:", e);
                        }
                    }
                }
            }

            ragChatHistory.push({ role: "user", content: displayText });
            ragChatHistory.push({ role: "assistant", content: fullReply });

        } catch (e) {
            botContentEl.innerHTML = `<span style="color:var(--danger)">Lỗi kết nối API: ${e.message}</span>`;
        } finally {
            if (ragChatSendBtn) ragChatSendBtn.disabled = false;
        }
    }

    function renderCitations(citations, container) {
        if (!citations || citations.length === 0 || !container) return;
        container.innerHTML = "";

        const badge = document.createElement("span");
        badge.className = "citation-badge";
        badge.innerHTML = `📚 Nguồn tham chiếu (${citations.length} đoạn trích)`;
        badge.addEventListener("click", () => {
            showCitationModal(citations);
        });

        container.appendChild(badge);
    }

    function showCitationModal(citations) {
        if (!citationModal || !citationModalBody) return;
        citationModalBody.innerHTML = "";
        citationModalTitle.textContent = `Nguồn Trích Dẫn RAG (${citations.length} kết quả)`;

        citations.forEach((c, idx) => {
            const card = document.createElement("div");
            card.className = "citation-card";

            const scoreDisplay = c.score !== undefined ? ` • Điểm Reranker: <strong>${parseFloat(c.score).toFixed(4)}</strong>` : "";
            const sourceDisplay = c.source || "Kho tri thức";

            const headerDiv = document.createElement("div");
            headerDiv.className = "citation-header";
            headerDiv.style.cssText = "font-size:0.82rem; color:var(--text-muted); margin-bottom:0.5rem;";
            headerDiv.innerHTML = `<span>#${idx + 1}. Nguồn: <strong>${escapeHtml(sourceDisplay)}</strong>${scoreDisplay}</span>`;

            const textDiv = document.createElement("div");
            textDiv.className = "citation-text";
            textDiv.style.cssText = "background:var(--bg-secondary); padding:0.75rem; border-radius:6px; font-size:0.88rem; line-height:1.6;";
            renderRichContent(c.text || "", textDiv);

            card.appendChild(headerDiv);
            card.appendChild(textDiv);
            citationModalBody.appendChild(card);
        });

        citationModal.style.display = "flex";
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener("click", () => {
            citationModal.style.display = "none";
        });
    }

    if (citationModal) {
        citationModal.addEventListener("click", (e) => {
            if (e.target === citationModal) citationModal.style.display = "none";
        });
    }

    function renderMultimodalImages(images, container) {
        if (!images || images.length === 0 || !container) return;
        container.innerHTML = "";

        images.forEach((img, idx) => {
            const imgEl = document.createElement("img");
            imgEl.className = "chat-thumb-img";
            let src = "";
            let title = `Hình ảnh tài liệu #${idx + 1}`;

            if (typeof img === "string") {
                src = img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`;
            } else if (img && typeof img === "object") {
                src = img.url || (img.base64 ? `data:image/jpeg;base64,${img.base64}` : "");
                title = img.filename || title;
            }

            if (!src) return;

            imgEl.src = src;
            imgEl.title = title;

            imgEl.addEventListener("click", () => {
                if (enlargedModalImg && imagePreviewModal) {
                    enlargedModalImg.src = src;
                    imagePreviewModal.style.display = "flex";
                }
            });

            container.appendChild(imgEl);
        });
    }

    if (closeImageModalBtn) {
        closeImageModalBtn.addEventListener("click", () => {
            imagePreviewModal.style.display = "none";
        });
    }

    if (imagePreviewModal) {
        imagePreviewModal.addEventListener("click", (e) => {
            if (e.target === imagePreviewModal) imagePreviewModal.style.display = "none";
        });
    }

    // ---------------------- TAB 3: OCR & FORMULA EXTRACTION ----------------------
    if (ocrDropzone && ocrFileInput) {
        ocrDropzone.addEventListener("click", () => ocrFileInput.click());

        ocrFileInput.addEventListener("change", (e) => {
            if (e.target.files.length > 0) {
                handleOcrFileSelect(e.target.files[0]);
            }
        });

        ocrDropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            ocrDropzone.classList.add("drag-over");
        });

        ocrDropzone.addEventListener("dragleave", () => {
            ocrDropzone.classList.remove("drag-over");
        });

        ocrDropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            ocrDropzone.classList.remove("drag-over");
            if (e.dataTransfer.files.length > 0) {
                handleOcrFileSelect(e.dataTransfer.files[0]);
            }
        });
    }

    function handleOcrFileSelect(file) {
        selectedOcrFile = file;
        selectedFileName.textContent = file.name;
        selectedFileSize.textContent = `(${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        fileSelectedCard.style.display = "flex";
        ocrProgress.style.display = "none";
    }

    // OCR Configuration Slider Listener
    const ocrConfSlider = document.getElementById("ocr-conf-slider");
    const ocrConfVal = document.getElementById("ocr-conf-val");
    if (ocrConfSlider && ocrConfVal) {
        ocrConfSlider.addEventListener("input", () => {
            ocrConfVal.textContent = parseFloat(ocrConfSlider.value).toFixed(2);
        });
    }

    if (startOcrBtn) {
        startOcrBtn.addEventListener("click", async () => {
            if (!selectedOcrFile) return;

            ocrProgress.style.display = "block";
            startOcrBtn.disabled = true;

            const formData = new FormData();
            formData.append("file", selectedOcrFile);

            // Bố cục đọc (IEEE 2 cột vs 1 cột)
            const layoutRadio = document.querySelector('input[name="ocr_layout"]:checked');
            formData.append("two_column", layoutRadio ? (layoutRadio.value === "two_column") : "true");

            // Ngôn ngữ
            const ocrLangSelect = document.getElementById("ocr-language-select");
            formData.append("languages", ocrLangSelect ? ocrLangSelect.value : "vi,en");

            // Định dạng xuất
            const ocrFormatSelect = document.getElementById("ocr-format-select");
            formData.append("output_format", ocrFormatSelect ? ocrFormatSelect.value : "markdown");

            // Ngưỡng tin cậy YOLO
            formData.append("conf_threshold", ocrConfSlider ? ocrConfSlider.value : "0.25");

            // Ollama AI Sửa lỗi
            const ocrUseOllama = document.getElementById("ocr-use-ollama-check");
            formData.append("use_ollama", (ocrUseOllama && ocrUseOllama.checked) ? "true" : "false");

            const ocrModelSelect = document.getElementById("ocr-model-select");
            formData.append("ollama_model", ocrModelSelect ? ocrModelSelect.value : "qwen2.5:14b");

            const apiBase = CONFIG.getApiBase();

            try {
                const res = await fetch(`${apiBase}/api/ocr/upload`, {
                    method: "POST",
                    body: formData
                });

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || `HTTP Error ${res.status}`);
                }
                currentOcrResult = await res.json();
                displayOcrResults(currentOcrResult);

            } catch (e) {
                alert(`Lỗi OCR: ${e.message}`);
            } finally {
                ocrProgress.style.display = "none";
                startOcrBtn.disabled = false;
            }
        });
    }

    function displayOcrResults(data) {
        ocrEmptyState.style.display = "none";
        ocrResultsContent.style.display = "flex";
        resultActionsBtns.style.display = "flex";
        ocrActionsCard.style.display = "block";

        const formulas = data.formulas || [];
        const figures = data.figures || [];
        const pages = data.pages || [];

        const totalFormulasEl = document.getElementById("total-formulas-count");
        const totalFiguresEl = document.getElementById("total-figures-count");
        const docStatsEl = document.getElementById("ocr-doc-stats");
        const figuresListEl = document.getElementById("figures-list");

        if (totalFormulasEl) totalFormulasEl.textContent = formulas.length;
        if (totalFiguresEl) totalFiguresEl.textContent = figures.length;
        if (docStatsEl) {
            docStatsEl.textContent = `${data.total_pages || pages.length} trang • ${formulas.length} công thức • ${figures.length} hình vẽ`;
        }

        // 1. Math formulas (Đối chiếu ảnh crop vs KaTeX)
        formulasList.innerHTML = "";
        if (formulas.length === 0) {
            formulasList.innerHTML = `
                <div style="text-align:center; color:var(--text-muted); padding:3rem 1rem;">
                    <i class="fas fa-info-circle" style="font-size:2rem; margin-bottom:0.75rem; color:var(--text-muted); display:block;"></i>
                    Không phát hiện công thức Toán độc lập trong tài liệu này. Thử giảm ngưỡng tin cậy YOLO Conf hoặc kiểm tra định dạng trang.
                </div>
            `;
        } else {
            formulas.forEach(f => {
                const card = document.createElement("div");
                card.className = "formula-split-card";
                const imgHtml = f.crop_image_b64 
                    ? `<img src="data:image/jpeg;base64,${f.crop_image_b64}" alt="Formula crop" loading="lazy">` 
                    : `<div style="padding:1rem; color:var(--text-muted); font-size:0.75rem;">(Không có ảnh crop)</div>`;
                const confPercent = f.confidence ? `${Math.round(f.confidence * 100)}%` : "100%";
                card.innerHTML = `
                    <div class="formula-crop-col">
                        ${imgHtml}
                        <div class="formula-badge-row">
                            <span><strong>Trang ${f.page || 1}</strong> • #${f.box_idx || 1}</span>
                            <span class="badge badge-secondary" style="font-size:0.7rem;">${f.type || 'math'} (${confPercent})</span>
                        </div>
                    </div>
                    <div class="formula-code-col">
                        <div class="formula-latex-raw">
                            <code>${escapeHtml(f.latex || "")}</code>
                        </div>
                        <div class="formula-render">$$${f.latex || ""}$$</div>
                    </div>
                `;
                renderKaTeX(card);
                formulasList.appendChild(card);
            });
        }

        // 2. Layout Pages & Bounding Boxes (YOLO Preview)
        layoutPagesContainer.innerHTML = "";
        if (pages.length === 0) {
            layoutPagesContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:2rem;">Không có thông tin trang.</div>`;
        } else {
            pages.forEach(p => {
                const pageDiv = document.createElement("div");
                pageDiv.className = "page-annotated-card";
                const imgHtml = p.annotated_image_b64 
                    ? `<img src="data:image/jpeg;base64,${p.annotated_image_b64}" alt="Trang ${p.page_number} Annotated" loading="lazy">`
                    : `<div style="padding:1.5rem; color:var(--text-muted);">Không có ảnh bố cục</div>`;
                pageDiv.innerHTML = `
                    <div class="page-annotated-header">
                        <div>
                            <span>📄 Trang ${p.page_number}</span>
                            <small style="color:var(--text-muted); font-weight:normal; margin-left:0.5rem;">
                                (${p.blocks_count || 0} khối nhận diện • ${p.formulas_count || 0} công thức • ${p.figures_count || 0} hình vẽ)
                            </small>
                        </div>
                        <span class="badge badge-primary" style="font-size:0.72rem;">Bố cục YOLO Router</span>
                    </div>
                    <div class="page-annotated-body">
                        ${imgHtml}
                    </div>
                `;
                layoutPagesContainer.appendChild(pageDiv);
            });
        }

        // 3. Figures & Charts Gallery
        if (figuresListEl) {
            figuresListEl.innerHTML = "";
            if (figures.length === 0) {
                figuresListEl.innerHTML = `
                    <div style="grid-column: 1/-1; text-align:center; color:var(--text-muted); padding:3rem 1rem;">
                        <i class="far fa-image" style="font-size:2rem; margin-bottom:0.75rem; color:var(--text-muted); display:block;"></i>
                        Không phát hiện hình vẽ, sơ đồ hoặc biểu đồ độc lập trong tài liệu này.
                    </div>
                `;
            } else {
                figures.forEach(fig => {
                    const card = document.createElement("div");
                    card.className = "figure-card";
                    card.innerHTML = `
                        <div class="figure-img-wrap">
                            <img src="data:image/jpeg;base64,${fig.crop_image_b64}" alt="Figure" loading="lazy">
                        </div>
                        <div class="figure-info-footer">
                            <span>Hình #${fig.box_idx || 1} (Trang ${fig.page || 1})</span>
                            <a href="data:image/jpeg;base64,${fig.crop_image_b64}" download="figure_p${fig.page || 1}_b${fig.box_idx || 1}.jpg" class="btn btn-secondary btn-xs">
                                <i class="fas fa-download"></i> Tải
                            </a>
                        </div>
                    `;
                    figuresListEl.appendChild(card);
                });
            }
        }

        // 4. Extracted Text View with AI Toggle
        const rawText = data.full_text || "";
        const aiText = data.corrected_text || "";
        const toggleBar = document.getElementById("text-version-toggle-bar");
        const btnAi = document.getElementById("btn-show-ai-text");
        const btnRaw = document.getElementById("btn-show-raw-text");

        if (toggleBar) {
            if (aiText) {
                toggleBar.style.display = "flex";
                if (btnAi && btnRaw) {
                    btnAi.onclick = () => {
                        btnAi.className = "btn btn-primary btn-xs active";
                        btnRaw.className = "btn btn-secondary btn-xs";
                        renderRichContent(aiText, extractedTextView);
                    };
                    btnRaw.onclick = () => {
                        btnRaw.className = "btn btn-primary btn-xs active";
                        btnAi.className = "btn btn-secondary btn-xs";
                        renderRichContent(rawText, extractedTextView);
                    };
                }
            } else {
                toggleBar.style.display = "none";
            }
        }

        const activeInitialText = aiText ? aiText : rawText;
        renderRichContent(activeInitialText, extractedTextView);

        // Gợi ý collection name
        const cleanName = (data.original_filename || "ocr_doc").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        targetCollectionInput.value = `col_${cleanName}`;
    }

    if (indexToRagBtn) {
        indexToRagBtn.addEventListener("click", async () => {
            if (!currentOcrResult) return;
            const colName = targetCollectionInput.value.trim();
            if (!colName) {
                alert("Vui lòng nhập tên Collection.");
                return;
            }

            indexToRagBtn.disabled = true;
            indexToRagBtn.textContent = "Đang nạp vào RAG...";

            const finalDocText = currentOcrResult.corrected_text || currentOcrResult.full_text || "";
            const apiBase = CONFIG.getApiBase();
            try {
                const res = await fetch(`${apiBase}/api/documents/index`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        collection_name: colName,
                        chunks: currentOcrResult.chunks || [finalDocText],
                        filename: currentOcrResult.original_filename,
                        saved_path: currentOcrResult.file_saved_path,
                        total_pages: currentOcrResult.total_pages || 1,
                        full_text: finalDocText,
                        formulas_count: (currentOcrResult.formulas || []).length
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Lỗi khi nạp vào RAG");

                alert(`✅ ${data.message}`);
                selectedCollections.add(colName);
                loadConfig();
                loadDocumentsList();

            } catch (e) {
                alert(`Lỗi: ${e.message}`);
            } finally {
                indexToRagBtn.disabled = false;
                indexToRagBtn.textContent = "Nạp Vào Kho RAG";
            }
        });
    }

    if (copyMarkdownBtn) {
        copyMarkdownBtn.addEventListener("click", () => {
            if (!currentOcrResult) return;
            const textToCopy = currentOcrResult.corrected_text || currentOcrResult.full_text || "";
            if (!textToCopy) return;
            navigator.clipboard.writeText(textToCopy).then(() => {
                alert("Đã sao chép toàn bộ văn bản vào Clipboard!");
            });
        });
    }

    if (downloadJsonBtn) {
        downloadJsonBtn.addEventListener("click", () => {
            if (!currentOcrResult) return;
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentOcrResult, null, 2));
            const a = document.createElement("a");
            a.href = dataStr;
            a.download = `ocr_result_${Date.now()}.json`;
            a.click();
        });
    }

    // ---------------------- TAB 4: KHO TÀI LIỆU & PHÂN QUYỀN ----------------------
    if (openUploadModalBtn) {
        openUploadModalBtn.addEventListener("click", () => {
            uploadErrorMsg.style.display = "none";
            uploadProgressBox.style.display = "none";
            uploadDocForm.reset();
            uploadDocModal.style.display = "flex";
        });
    }

    if (closeUploadModalBtn) {
        closeUploadModalBtn.addEventListener("click", () => {
            uploadDocModal.style.display = "none";
        });
    }

    if (cancelUploadBtn) {
        cancelUploadBtn.addEventListener("click", () => {
            uploadDocModal.style.display = "none";
        });
    }

    if (uploadDocModal) {
        uploadDocModal.addEventListener("click", (e) => {
            if (e.target === uploadDocModal) uploadDocModal.style.display = "none";
        });
    }

    if (docFileInput) {
        docFileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                if (!docNameInput.value) {
                    docNameInput.value = baseName;
                }
                if (!docCollectionInput.value) {
                    const cleanSlug = baseName.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 15);
                    docCollectionInput.value = `COL_${cleanSlug}`;
                }
            }
        });
    }

    if (uploadDocForm) {
        uploadDocForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const file = docFileInput.files[0];
            const tenvanban = docNameInput.value.trim();
            const tencollection = docCollectionInput.value.trim();

            if (!file) {
                alert("Vui lòng chọn file cần tải lên!");
                return;
            }

            uploadErrorMsg.style.display = "none";
            uploadProgressBox.style.display = "flex";
            uploadProgressText.textContent = "Đang tải lên, bóc tách text và nạp vào CSDL RAG...";
            submitUploadBtn.disabled = true;

            const formData = new FormData();
            formData.append("file", file);
            formData.append("tenvanban", tenvanban);
            formData.append("tencollection", tencollection);
            formData.append("uploader", currentUser.username);

            const apiBase = CONFIG.getApiBase();

            try {
                const res = await fetch(`${apiBase}/api/documents/upload`, {
                    method: "POST",
                    headers: {
                        "X-User-Name": currentUser.username,
                        "X-User-Role": currentUser.role
                    },
                    body: formData
                });

                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || "Lỗi khi tải lên và nạp tài liệu.");
                }

                uploadProgressText.textContent = "✅ Đã nạp thành công!";
                setTimeout(() => {
                    uploadDocModal.style.display = "none";
                    submitUploadBtn.disabled = false;
                    uploadProgressBox.style.display = "none";
                    uploadDocForm.reset();

                    loadDocumentsList();
                    loadConfig();

                    alert(`Đã nạp thành công tài liệu '${tenvanban}' vào kho RAG!`);
                }, 600);

            } catch (err) {
                uploadProgressBox.style.display = "none";
                uploadErrorMsg.textContent = err.message;
                uploadErrorMsg.style.display = "block";
                submitUploadBtn.disabled = false;
            }
        });
    }

    async function loadDocumentsList() {
        if (!docsTbody) return;
        const apiBase = CONFIG.getApiBase();
        docsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem;">Đang tải danh sách tài liệu...</td></tr>`;

        try {
            const res = await fetch(`${apiBase}/api/documents?username=${encodeURIComponent(currentUser.username)}&role=${currentUser.role}`, {
                headers: {
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                }
            });
            const data = await res.json();
            currentLoadedDocs = data.documents || [];

            if (currentUser.role === "admin" && adminUserFilter) {
                const uploaderSet = new Set(["all"]);
                currentLoadedDocs.forEach(d => {
                    if (d.uploader) uploaderSet.add(d.uploader);
                });

                adminUserFilter.innerHTML = "";
                uploaderSet.forEach(u => {
                    const opt = document.createElement("option");
                    opt.value = u;
                    opt.textContent = u === "all" ? "👥 Tất cả người dùng" : `👤 ${u}`;
                    adminUserFilter.appendChild(opt);
                });
            }

            renderDocumentsTable(currentLoadedDocs);

        } catch (e) {
            console.error("Lỗi khi tải danh sách documents:", e);
            docsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--danger); padding: 1.5rem;">Không thể nạp danh sách tài liệu từ API.</td></tr>`;
        }
    }

    function renderDocumentsTable(docs) {
        if (!docsTbody) return;
        docsTbody.innerHTML = "";
        tableSelectedDocIds.clear();
        updateBatchSelectedCount();

        if (docs.length === 0) {
            docsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 2rem;">Chưa có tài liệu nào trong kho. Bấm "Tải Lên Tài Liệu" để thêm tài liệu mới.</td></tr>`;
            return;
        }

        docs.forEach(doc => {
            const tr = document.createElement("tr");

            let sizeText = "";
            if (doc.file_size) {
                if (doc.file_size > 1000000) sizeText = `${(doc.file_size / 1024 / 1024).toFixed(1)} MB`;
                else if (doc.file_size > 1000) sizeText = `${(doc.file_size / 1024).toFixed(0)} KB`;
                else sizeText = `${doc.file_size} B`;
            } else {
                sizeText = `${doc.chunks_count || 1} chunks`;
            }

            let uploaderBadge = "";
            const up = (doc.uploader || "system").toLowerCase();
            if (up === "admin") {
                uploaderBadge = `<span class="badge-uploader admin">👑 admin</span>`;
            } else if (up === "system") {
                uploaderBadge = `<span class="badge-uploader system">🌐 Hệ thống</span>`;
            } else {
                uploaderBadge = `<span class="badge-uploader user">👤 ${doc.uploader}</span>`;
            }

            const canDelete = currentUser.role === "admin" || doc.can_delete || (doc.uploader && doc.uploader.toLowerCase() === currentUser.username.toLowerCase());
            const deleteBtnHtml = canDelete 
                ? `<button class="btn btn-secondary btn-sm del-doc-btn" style="color: var(--danger); padding: 0.25rem 0.5rem;" title="Xóa tài liệu này">&times;</button>`
                : `<span style="color:var(--text-muted); font-size:0.75rem;">-</span>`;

            tr.innerHTML = `
                <td><input type="checkbox" class="doc-row-chk" data-id="${doc.id}" data-col="${doc.collection}"></td>
                <td><strong>${escapeHtml(doc.filename)}</strong></td>
                <td><span class="badge online">${escapeHtml(doc.collection)}</span></td>
                <td>${uploaderBadge}</td>
                <td>${sizeText}</td>
                <td><small style="color: var(--text-muted);">${doc.created_at || ""}</small></td>
                <td>
                    <div style="display: flex; gap: 0.35rem; align-items: center;">
                        <button class="btn btn-secondary btn-sm view-doc-btn" style="padding: 0.25rem 0.5rem;">Xem</button>
                        ${deleteBtnHtml}
                    </div>
                </td>
            `;

            const rowChk = tr.querySelector(".doc-row-chk");
            rowChk.addEventListener("change", (e) => {
                if (e.target.checked) tableSelectedDocIds.add(doc.id);
                else tableSelectedDocIds.delete(doc.id);
                updateBatchSelectedCount();
            });

            tr.querySelector(".view-doc-btn").addEventListener("click", () => viewDocument(doc));

            if (canDelete) {
                const delBtn = tr.querySelector(".del-doc-btn");
                if (delBtn) {
                    delBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        if (confirm(`Bạn có chắc chắn muốn xóa tài liệu '${doc.filename}' (Collection: ${doc.collection})?`)) {
                            const apiBase = CONFIG.getApiBase();
                            try {
                                const res = await fetch(`${apiBase}/api/documents/${doc.id}`, {
                                    method: "DELETE",
                                    headers: {
                                        "X-User-Name": currentUser.username,
                                        "X-User-Role": currentUser.role
                                    }
                                });
                                const result = await res.json();
                                if (!res.ok || !result.success) throw new Error(result.error || "Lỗi xóa tài liệu");
                                alert(`Đã xóa tài liệu '${doc.filename}'`);
                                loadDocumentsList();
                                loadConfig();
                            } catch (err) {
                                alert(`Lỗi: ${err.message}`);
                            }
                        }
                    });
                }
            }

            docsTbody.appendChild(tr);
        });
    }

    if (refreshDocsBtn) refreshDocsBtn.addEventListener("click", loadDocumentsList);

    if (adminUserFilter) {
        adminUserFilter.addEventListener("change", (e) => {
            const filterUser = e.target.value;
            if (filterUser === "all") {
                renderDocumentsTable(currentLoadedDocs);
            } else {
                const filtered = currentLoadedDocs.filter(d => (d.uploader || "").toLowerCase() === filterUser.toLowerCase());
                renderDocumentsTable(filtered);
            }
        });
    }

    if (checkAllDocsTable) {
        checkAllDocsTable.addEventListener("change", (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll(".doc-row-chk").forEach(chk => {
                chk.checked = isChecked;
                const docId = chk.getAttribute("data-id");
                if (isChecked) tableSelectedDocIds.add(docId);
                else tableSelectedDocIds.delete(docId);
            });
            updateBatchSelectedCount();
        });
    }

    function updateBatchSelectedCount() {
        if (!batchSelectedCount || !chatWithSelectedDocsBtn) return;
        batchSelectedCount.textContent = tableSelectedDocIds.size;
        chatWithSelectedDocsBtn.disabled = tableSelectedDocIds.size === 0;
    }

    // Nút "Hỏi đáp với các tài liệu đã chọn" chuyển thẳng sang Tab 2 RAG
    if (chatWithSelectedDocsBtn) {
        chatWithSelectedDocsBtn.addEventListener("click", () => {
            if (tableSelectedDocIds.size === 0) return;

            const targetCollections = new Set();
            currentLoadedDocs.forEach(d => {
                if (tableSelectedDocIds.has(d.id)) {
                    targetCollections.add(d.collection);
                }
            });

            selectedCollections = targetCollections;
            renderCollectionsCheckboxList();

            // Chuyển sang Tab RAG
            const ragTabNavBtn = document.querySelector('[data-tab="tab-rag-chat"]');
            if (ragTabNavBtn) ragTabNavBtn.click();

            if (ragChatInput) {
                ragChatInput.value = `Hãy phân tích và tóm tắt các điểm quan trọng từ ${selectedCollections.size} tài liệu được chọn: ${Array.from(selectedCollections).join(", ")}`;
                ragChatInput.focus();
            }
        });
    }

    // DOM Elements for Document Reader
    const docViewerLoading = document.getElementById("doc-viewer-loading");
    const docTextReader = document.getElementById("doc-text-reader");
    const readerColName = document.getElementById("reader-col-name");
    const readerUploaderTag = document.getElementById("reader-uploader-tag");
    const readerStatsTag = document.getElementById("reader-stats-tag");
    const readerDateTag = document.getElementById("reader-date-tag");
    const viewerModeToggle = document.getElementById("viewer-mode-toggle");
    const toggleViewTextBtn = document.getElementById("toggle-view-text-btn");
    const toggleViewPdfBtn = document.getElementById("toggle-view-pdf-btn");
    const copyDocTextBtn = document.getElementById("copy-doc-text-btn");
    const downloadDocTextBtn = document.getElementById("download-doc-text-btn");
    const readerSearchInput = document.getElementById("reader-search-input");
    const readerSearchCount = document.getElementById("reader-search-count");
    const readerBodyText = document.getElementById("reader-body-text");

    let currentDocumentContent = "";

    async function viewDocument(doc) {
        currentSelectedDoc = doc;
        viewerTitle.textContent = `Tài liệu: ${doc.filename}`;
        if (chatWithThisDocBtn) chatWithThisDocBtn.style.display = "inline-flex";
        if (viewerPlaceholder) viewerPlaceholder.style.display = "none";
        if (pdfViewerFrame) pdfViewerFrame.style.display = "none";
        if (imageViewerFrame) imageViewerFrame.style.display = "none";
        if (docTextReader) docTextReader.style.display = "none";
        if (docViewerLoading) docViewerLoading.style.display = "flex";

        const apiBase = CONFIG.getApiBase();
        const docId = doc.id || doc.collection;
        const colName = doc.collection || "";
        const fileName = doc.filename || "";

        let docData = null;

        // 1. Thử endpoint query params (/api/documents/content?id=...&collection=...&filename=...)
        try {
            const queryUrl = `${apiBase}/api/documents/content?id=${encodeURIComponent(docId)}&collection=${encodeURIComponent(colName)}&filename=${encodeURIComponent(fileName)}`;
            const res = await fetch(queryUrl);
            const contentType = res.headers.get("content-type") || "";
            if (res.ok && contentType.includes("application/json")) {
                const data = await res.json();
                if (data && data.success && data.document) {
                    docData = data.document;
                }
            }
        } catch (e1) {
            console.warn("Query param fetch warning:", e1);
        }

        // 2. Thử endpoint path param (/api/documents/:id/content) nếu chưa lấy được
        if (!docData) {
            try {
                const pathUrl = `${apiBase}/api/documents/${encodeURIComponent(docId)}/content`;
                const res = await fetch(pathUrl);
                const contentType = res.headers.get("content-type") || "";
                if (res.ok && contentType.includes("application/json")) {
                    const data = await res.json();
                    if (data && data.success && data.document) {
                        docData = data.document;
                    }
                }
            } catch (e2) {
                console.warn("Path param fetch warning:", e2);
            }
        }

        // 3. Fallback an toàn: Sử dụng text_preview hoặc thông tin có sẵn nếu server trả về HTML (<!doctype)
        if (!docData) {
            docData = {
                id: docId,
                filename: fileName || docId,
                collection: colName || docId,
                uploader: doc.uploader || "system",
                created_at: doc.created_at || "",
                char_count: doc.file_size || (doc.text_preview ? doc.text_preview.length : 0),
                content: doc.text_preview || "(Tài liệu này hiện chưa có nội dung văn bản lưu trong Neon DB. Bạn có thể sử dụng nút 'Tải lên tài liệu' để cập nhật lại file này.)",
                has_physical_file: Boolean(doc.has_physical_file),
                file_url: doc.relative_url || null
            };
        }

        try {
            currentDocumentContent = docData.content || "";

            // Cập nhật Metadata Tags
            if (readerColName) readerColName.textContent = docData.collection || colName;
            if (readerUploaderTag) readerUploaderTag.textContent = `👤 ${docData.uploader || doc.uploader || 'system'}`;
            if (readerStatsTag) {
                const chars = (docData.char_count || currentDocumentContent.length).toLocaleString();
                const words = (docData.word_count || currentDocumentContent.split(/\s+/).filter(Boolean).length).toLocaleString();
                readerStatsTag.textContent = `📊 ${chars} ký tự (~${words} từ)`;
            }
            if (readerDateTag) readerDateTag.textContent = `🕒 ${docData.created_at || doc.created_at || ''}`;

            // Reset ô tìm kiếm nội bộ
            if (readerSearchInput) readerSearchInput.value = "";
            if (readerSearchCount) readerSearchCount.textContent = "";

            // Render văn bản đầy đủ từ Neon DB
            renderDocumentText(currentDocumentContent);

            // Xử lý toggle nếu có file PDF gốc trên đĩa
            if (docData.has_physical_file && docData.file_url) {
                if (viewerModeToggle) viewerModeToggle.style.display = "flex";
                if (toggleViewTextBtn) toggleViewTextBtn.className = "toggle-mode-btn active";
                if (toggleViewPdfBtn) toggleViewPdfBtn.className = "toggle-mode-btn";
                if (pdfViewerFrame) pdfViewerFrame.src = `${apiBase}${docData.file_url}`;
            } else {
                if (viewerModeToggle) viewerModeToggle.style.display = "none";
            }

            if (docViewerLoading) docViewerLoading.style.display = "none";
            if (docTextReader) docTextReader.style.display = "flex";

        } catch (renderErr) {
            console.error("Lỗi render tài liệu:", renderErr);
            if (docViewerLoading) docViewerLoading.style.display = "none";
            if (docTextReader) docTextReader.style.display = "flex";
            if (readerBodyText) {
                readerBodyText.innerHTML = `<div style="color:var(--text-muted); padding:2rem; text-align:center;">
                    <p>${escapeHtml(currentDocumentContent || "(Không có nội dung)")}</p>
                </div>`;
            }
        }
    }

    function renderDocumentText(text, keyword = "") {
        if (!readerBodyText) return;
        if (!text) {
            readerBodyText.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:2rem;">(Tài liệu không có nội dung văn bản trong CSDL Neon DB)</div>`;
            return;
        }

        if (!keyword) {
            readerBodyText.textContent = text;
            renderKaTeX(readerBodyText);
            return;
        }

        try {
            const escapedKey = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedKey})`, 'gi');
            const matches = text.match(regex);
            const count = matches ? matches.length : 0;

            if (readerSearchCount) {
                readerSearchCount.textContent = count > 0 ? `${count} kết quả` : "Không tìm thấy";
            }

            const parts = text.split(regex);
            readerBodyText.innerHTML = "";
            parts.forEach(part => {
                if (part.toLowerCase() === keyword.toLowerCase()) {
                    const mark = document.createElement("mark");
                    mark.textContent = part;
                    readerBodyText.appendChild(mark);
                } else {
                    readerBodyText.appendChild(document.createTextNode(part));
                }
            });
            renderKaTeX(readerBodyText);
        } catch (e) {
            readerBodyText.textContent = text;
        }
    }

    // Tìm kiếm từ khóa bên trong văn bản tài liệu
    if (readerSearchInput) {
        readerSearchInput.addEventListener("input", (e) => {
            const kw = e.target.value.trim();
            renderDocumentText(currentDocumentContent, kw);
        });
    }

    // Sao chép nội dung tài liệu
    if (copyDocTextBtn) {
        copyDocTextBtn.addEventListener("click", () => {
            if (!currentDocumentContent) return;
            navigator.clipboard.writeText(currentDocumentContent).then(() => {
                const originalText = copyDocTextBtn.textContent;
                copyDocTextBtn.textContent = "✅ Đã sao chép";
                setTimeout(() => { copyDocTextBtn.textContent = originalText; }, 1500);
            }).catch(() => {
                alert("Đã xảy ra lỗi khi sao chép.");
            });
        });
    }

    // Tải nội dung văn bản về máy (.txt)
    if (downloadDocTextBtn) {
        downloadDocTextBtn.addEventListener("click", () => {
            if (!currentDocumentContent || !currentSelectedDoc) return;
            const blob = new Blob([currentDocumentContent], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const safeName = (currentSelectedDoc.filename || "document").replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
            a.download = `${safeName}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Toggle giữa xem văn bản Neon DB và xem PDF gốc
    if (toggleViewTextBtn && toggleViewPdfBtn) {
        toggleViewTextBtn.addEventListener("click", () => {
            toggleViewTextBtn.className = "toggle-mode-btn active";
            toggleViewPdfBtn.className = "toggle-mode-btn";
            if (docTextReader) docTextReader.style.display = "flex";
            if (pdfViewerFrame) pdfViewerFrame.style.display = "none";
        });

        toggleViewPdfBtn.addEventListener("click", () => {
            toggleViewPdfBtn.className = "toggle-mode-btn active";
            toggleViewTextBtn.className = "toggle-mode-btn";
            if (docTextReader) docTextReader.style.display = "none";
            if (pdfViewerFrame) pdfViewerFrame.style.display = "block";
        });
    }

    // Nút "Hỏi đáp tài liệu này" ở viewer chuyển sang Tab RAG
    if (chatWithThisDocBtn) {
        chatWithThisDocBtn.addEventListener("click", () => {
            if (!currentSelectedDoc) return;
            selectedCollections = new Set([currentSelectedDoc.collection]);
            renderCollectionsCheckboxList();

            const ragTabNavBtn = document.querySelector('[data-tab="tab-rag-chat"]');
            if (ragTabNavBtn) ragTabNavBtn.click();

            if (ragChatInput) {
                ragChatInput.value = `Hãy tóm tắt nội dung và các ý chính trong tài liệu '${currentSelectedDoc.filename}'`;
                ragChatInput.focus();
            }
        });
    }

    // ========================================================
    // CHAT HISTORY & SESSIONS MANAGEMENT (REAL-TIME & NEON DB)
    // ========================================================
    let currentSessionId = localStorage.getItem("hpu2_session_id") || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    localStorage.setItem("hpu2_session_id", currentSessionId);

    // Sidebar Elements
    const chatHistorySidebar = document.getElementById("chat-history-sidebar");
    const toggleSidebarBtn = document.getElementById("toggle-sidebar-btn");
    const collapseSidebarBtn = document.getElementById("collapse-sidebar-btn");
    const sidebarNewChatBtn = document.getElementById("sidebar-new-chat-btn");
    const sidebarHistorySearch = document.getElementById("sidebar-history-search");
    const sidebarSearchClear = document.getElementById("sidebar-search-clear");
    const sidebarSessionsList = document.getElementById("sidebar-sessions-list");
    const sidebarSessionCount = document.getElementById("sidebar-session-count");
    const sidebarHeaderBadge = document.getElementById("sidebar-header-badge");
    const sidebarRefreshBtn = document.getElementById("sidebar-refresh-btn");

    // Modal Elements (for optional modal view)
    const openHistoryBtn = document.getElementById("open-history-btn");
    const historyModal = document.getElementById("history-modal");
    const closeHistoryModalBtn = document.getElementById("close-history-modal-btn");
    const newSessionModalBtn = document.getElementById("new-session-modal-btn");
    const refreshHistoryBtn = document.getElementById("refresh-history-btn");
    const historySearchInput = document.getElementById("history-search-input");
    const historySessionsContainer = document.getElementById("history-sessions-container");

    let loadedHistorySessions = [];

    // Helper fetch có cơ chế tự động thử lại fallback URL nếu gặp lỗi kết nối
    async function fetchApiWithFallback(endpoint, options = {}) {
        const primary = CONFIG.getApiBase();
        const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

        const candidates = [primary];
        if (primary.includes("localhost:5000")) {
            candidates.push("http://127.0.0.1:5000");
        } else if (primary.includes("127.0.0.1:5000")) {
            candidates.push("http://localhost:5000");
        }
        if (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin.startsWith("http")) {
            if (!candidates.includes(window.location.origin)) {
                candidates.push(window.location.origin);
            }
        }

        let lastError = null;
        for (const base of candidates) {
            try {
                const fullUrl = `${base.replace(/\/+$/, "")}${cleanEndpoint}`;
                const res = await fetch(fullUrl, {
                    ...options,
                    headers: {
                        "X-User-Name": currentUser.username,
                        "X-User-Role": currentUser.role,
                        ...(options.headers || {})
                    }
                });
                if (res.ok) {
                    CONFIG.API_BASE = base;
                    return res;
                }
                const cType = res.headers.get("content-type") || "";
                if (cType.includes("application/json")) {
                    CONFIG.API_BASE = base;
                    return res;
                }
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError || new Error("Không thể kết nối đến máy chủ.");
    }

    // Helper: Định dạng thời gian tương đối
    function formatRelativeTime(dateStr) {
        if (!dateStr) return "";
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return String(dateStr).slice(0, 16);
            const now = new Date();
            const diffMs = now - d;
            const diffSec = Math.floor(diffMs / 1000);
            if (diffSec < 45) return "Vừa xong";
            const diffMin = Math.floor(diffSec / 60);
            if (diffMin < 60) return `${diffMin} phút trước`;
            const diffHour = Math.floor(diffMin / 60);
            if (diffHour < 24) return `${diffHour} giờ trước`;
            const diffDay = Math.floor(diffHour / 24);
            if (diffDay < 7) return `${diffDay} ngày trước`;
            return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
        } catch {
            return (dateStr || "").slice(0, 16);
        }
    }

    // Sidebar collapse state handling (Right Sidebar)
    function toggleSidebar() {
        if (!chatHistorySidebar) return;
        const isCollapsed = chatHistorySidebar.classList.toggle("collapsed");
        localStorage.setItem("hpu2_sidebar_collapsed", isCollapsed ? "true" : "false");
    }

    if (toggleSidebarBtn) toggleSidebarBtn.addEventListener("click", toggleSidebar);
    if (collapseSidebarBtn) {
        collapseSidebarBtn.addEventListener("click", () => {
            if (!chatHistorySidebar) return;
            chatHistorySidebar.classList.add("collapsed");
            localStorage.setItem("hpu2_sidebar_collapsed", "true");
        });
    }
    if (sidebarRefreshBtn) {
        sidebarRefreshBtn.addEventListener("click", () => {
            loadHistorySessions();
        });
    }

    // Khôi phục trạng thái thu gọn thanh bên (Mặc định ẩn trên màn hình nhỏ)
    const savedSidebarCollapsed = localStorage.getItem("hpu2_sidebar_collapsed");
    if (chatHistorySidebar) {
        if (window.innerWidth <= 768) {
            chatHistorySidebar.classList.add("collapsed");
        } else if (savedSidebarCollapsed === "true") {
            chatHistorySidebar.classList.add("collapsed");
        }
    }

    // Đóng sidebar khi click ngoài trên mobile
    document.querySelector(".main-container")?.addEventListener("click", () => {
        if (window.innerWidth <= 768 && chatHistorySidebar && !chatHistorySidebar.classList.contains("collapsed")) {
            chatHistorySidebar.classList.add("collapsed");
        }
    });

    if (sidebarNewChatBtn) {
        sidebarNewChatBtn.addEventListener("click", () => {
            startNewChatSession();
            if (window.innerWidth <= 768 && chatHistorySidebar) {
                chatHistorySidebar.classList.add("collapsed");
            }
        });
    }

    if (sidebarSearchClear) {
        sidebarSearchClear.addEventListener("click", () => {
            if (sidebarHistorySearch) {
                sidebarHistorySearch.value = "";
                sidebarSearchClear.style.display = "none";
                renderSidebarSessions("");
            }
        });
    }

    if (sidebarHistorySearch) {
        sidebarHistorySearch.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (sidebarSearchClear) {
                sidebarSearchClear.style.display = e.target.value ? "inline-block" : "none";
            }
            renderSidebarSessions(query);
        });
    }

    // Modal Events
    function openHistoryModal() {
        if (!historyModal) return;
        historyModal.style.display = "flex";
        loadHistorySessions();
    }

    function closeHistoryModal() {
        if (!historyModal) return;
        historyModal.style.display = "none";
    }

    if (openHistoryBtn) openHistoryBtn.addEventListener("click", openHistoryModal);
    if (closeHistoryModalBtn) closeHistoryModalBtn.addEventListener("click", closeHistoryModal);
    if (newSessionModalBtn) newSessionModalBtn.addEventListener("click", () => {
        startNewChatSession();
        closeHistoryModal();
    });
    if (refreshHistoryBtn) refreshHistoryBtn.addEventListener("click", () => loadHistorySessions());

    if (historySearchInput) {
        historySearchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            renderHistorySessionsList(query);
        });
    }

    // Cập nhật Optimistic tức thì khi gửi tin nhắn
    function notifySessionActivity(mode, displayText) {
        const existing = loadedHistorySessions.find(s => s.session_id === currentSessionId);
        if (existing) {
            existing.message_count = (existing.message_count || 0) + 1;
            existing.updated_at = new Date().toISOString();
            if ((!existing.title || existing.title === "Đoạn hội thoại mới") && displayText) {
                existing.title = displayText.slice(0, 45);
            }
            // Đưa lên đầu danh sách
            loadedHistorySessions = [existing, ...loadedHistorySessions.filter(s => s.session_id !== currentSessionId)];
        } else {
            const newSess = {
                session_id: currentSessionId,
                title: displayText ? displayText.slice(0, 45) : "Đoạn hội thoại mới",
                chat_type: mode,
                model: mode === "direct" ? (selectModelDirect?.value || "qwen2.5:14b") : (selectModelRag?.value || "qwen2.5:14b"),
                collections: (mode === "rag" && selectedCollections) ? Array.from(selectedCollections).join("+") : "",
                message_count: 1,
                updated_at: new Date().toISOString(),
                username: currentUser.username || "guest"
            };
            loadedHistorySessions.unshift(newSess);
        }
        renderSidebarSessions(sidebarHistorySearch?.value?.toLowerCase()?.trim() || "");
        renderHistorySessionsList(historySearchInput?.value?.toLowerCase()?.trim() || "");
    }

    // Cập nhật khi bot trả lời xong
    function notifySessionComplete(sessionId) {
        if (sessionId) {
            currentSessionId = sessionId;
            localStorage.setItem("hpu2_session_id", currentSessionId);
        }
        const existing = loadedHistorySessions.find(s => s.session_id === currentSessionId);
        if (existing) {
            existing.message_count = (existing.message_count || 1) + 1;
            existing.updated_at = new Date().toISOString();
        }
        renderSidebarSessions(sidebarHistorySearch?.value?.toLowerCase()?.trim() || "");
        renderHistorySessionsList(historySearchInput?.value?.toLowerCase()?.trim() || "");
    }

    // Tải danh sách phiên chat từ Neon DB với cơ chế fallback tự hồi phục
    async function loadHistorySessions(silent = false) {
        if (!silent) {
            if (sidebarSessionsList) {
                sidebarSessionsList.innerHTML = `
                    <div class="sidebar-loading">
                        <div class="spinner-sm"></div>
                        <span>Đang đồng bộ từ Neon DB...</span>
                    </div>
                `;
            }
            if (historySessionsContainer) {
                historySessionsContainer.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); padding: 2rem 1rem;">
                        <div class="spinner-sm" style="margin: 0 auto 0.5rem auto;"></div>
                        <span>Đang tải danh sách phiên chat từ Neon DB...</span>
                    </div>
                `;
            }
        }

        try {
            const endpoint = `/api/chat/sessions?username=${encodeURIComponent(currentUser.username)}&role=${encodeURIComponent(currentUser.role)}`;
            const res = await fetchApiWithFallback(endpoint);
            const contentType = res.headers.get("content-type") || "";
            if (!res.ok || !contentType.includes("application/json")) {
                throw new Error("Không thể tải danh sách phiên trò chuyện.");
            }
            const data = await res.json();
            loadedHistorySessions = data.sessions || [];
            renderSidebarSessions(sidebarHistorySearch?.value?.toLowerCase()?.trim() || "");
            renderHistorySessionsList(historySearchInput?.value?.toLowerCase()?.trim() || "");
        } catch (err) {
            console.warn("Lỗi tải lịch sử chat:", err);
            if (!silent) {
                if (sidebarSessionsList) {
                    sidebarSessionsList.innerHTML = `
                        <div class="sidebar-error-card">
                            <span class="error-icon">⚠️</span>
                            <div class="error-title">Chưa kết nối được máy chủ</div>
                            <p class="error-desc">${escapeHtml(err.message || 'Lỗi mạng hoặc API đang khởi động')}</p>
                            <button id="sidebar-retry-btn" class="btn btn-outline btn-xs" style="margin-top: 0.35rem; cursor: pointer;">
                                🔄 Thử Lại
                            </button>
                        </div>
                    `;
                    document.getElementById("sidebar-retry-btn")?.addEventListener("click", () => loadHistorySessions());
                }
                if (historySessionsContainer) {
                    historySessionsContainer.innerHTML = `
                        <div style="text-align: center; color: var(--danger); padding: 1.5rem 1rem;">
                            <span>⚠️ Không thể tải danh sách: ${escapeHtml(err.message)}</span>
                        </div>
                    `;
                }
            }
        }
    }

    // Hiển thị danh sách hội thoại trên thanh bên Real-time (Được tối ưu giao diện)
    function renderSidebarSessions(filterQuery = "") {
        if (!sidebarSessionsList) return;
        let sessions = loadedHistorySessions;
        if (filterQuery) {
            sessions = sessions.filter(s =>
                (s.title && s.title.toLowerCase().includes(filterQuery)) ||
                (s.model && s.model.toLowerCase().includes(filterQuery)) ||
                (s.collections && s.collections.toLowerCase().includes(filterQuery))
            );
        }

        if (sidebarSessionCount) {
            sidebarSessionCount.textContent = `${sessions.length} phiên`;
        }
        if (sidebarHeaderBadge) {
            sidebarHeaderBadge.textContent = sessions.length;
        }

        if (sessions.length === 0) {
            sidebarSessionsList.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding: 2.4rem 0.75rem; font-size: 0.82rem;">
                    <div style="font-size: 1.8rem; margin-bottom: 0.4rem;">💬</div>
                    <p style="margin: 0; font-weight: 500;">${filterQuery ? "Không có hội thoại phù hợp" : "Chưa có cuộc trò chuyện nào"}</p>
                    <p style="margin: 0.35rem 0 0 0; font-size: 0.72rem; color: var(--text-muted);">${filterQuery ? "Hãy thử từ khóa khác" : "Bắt đầu nhắn tin để lưu lịch sử"}</p>
                </div>
            `;
            return;
        }

        sidebarSessionsList.innerHTML = "";
        sessions.forEach(sess => {
            const item = document.createElement("div");
            item.className = `sidebar-session-item ${sess.session_id === currentSessionId ? "active" : ""}`;
            item.setAttribute("data-session-id", sess.session_id);

            const isDirect = sess.chat_type === "direct";
            const typeLabel = isDirect ? "Trực tiếp" : "RAG";
            const typeIcon = isDirect ? "🤖" : "📚";
            const typeClass = isDirect ? "direct" : "rag";
            const msgCountText = sess.message_count ? `${sess.message_count} tin` : "";
            const timeText = formatRelativeTime(sess.updated_at);

            item.innerHTML = `
                <div class="session-main-row">
                    <div class="session-title-wrap">
                        <span class="session-icon-box ${typeClass}">${typeIcon}</span>
                        <span class="session-title-text" title="${escapeHtml(sess.title || 'Đoạn hội thoại mới')}">${escapeHtml(sess.title || 'Đoạn hội thoại mới')}</span>
                    </div>
                    <div class="session-action-btns">
                        <button class="session-btn-action rename-btn" title="Đổi tên hội thoại">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        </button>
                        <button class="session-btn-action delete-btn" title="Xóa hội thoại">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
                <div class="session-meta-row">
                    <span class="session-badge session-badge-model">${escapeHtml(sess.model || 'qwen2.5:14b')}</span>
                    <span class="session-badge">${typeLabel}</span>
                    ${msgCountText ? `<span class="session-badge">${msgCountText}</span>` : ""}
                    ${timeText ? `<span class="session-time">${escapeHtml(timeText)}</span>` : ""}
                </div>
            `;

            // Click vào session để khôi phục
            item.addEventListener("click", (e) => {
                if (e.target.closest(".session-action-btns") || e.target.closest(".session-rename-form")) {
                    return;
                }
                restoreSessionMessages(sess);
                if (window.innerWidth <= 768 && chatHistorySidebar) {
                    chatHistorySidebar.classList.add("collapsed");
                }
            });

            // Nút đổi tên inline
            const renameBtn = item.querySelector(".rename-btn");
            if (renameBtn) {
                renameBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    startSidebarInlineRename(sess, item);
                });
            }

            // Nút xóa hội thoại
            const deleteBtn = item.querySelector(".delete-btn");
            if (deleteBtn) {
                deleteBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Bạn có chắc muốn xóa cuộc trò chuyện "${sess.title || 'này'}" khỏi Neon DB?`)) return;
                    await deleteChatSession(sess.session_id);
                });
            }

            sidebarSessionsList.appendChild(item);
        });
    }

    // Kích hoạt chỉnh sửa tên trực tiếp trên thẻ session (Inline Rename)
    function startSidebarInlineRename(sess, itemEl) {
        const mainRow = itemEl.querySelector(".session-main-row");
        if (!mainRow) return;

        const previousHtml = mainRow.innerHTML;

        mainRow.innerHTML = `
            <form class="session-rename-form" style="width: 100%;">
                <input type="text" class="session-rename-input" maxlength="100" value="${escapeHtml(sess.title || '')}" />
                <button type="submit" class="session-rename-save-btn" title="Lưu (Enter)">✓</button>
                <button type="button" class="session-rename-cancel-btn" title="Hủy (Esc)">✕</button>
            </form>
        `;

        const form = mainRow.querySelector(".session-rename-form");
        const input = mainRow.querySelector(".session-rename-input");
        const cancelBtn = mainRow.querySelector(".session-rename-cancel-btn");

        if (input) {
            input.focus();
            input.select();
        }

        const cancelEdit = () => {
            mainRow.innerHTML = previousHtml;
            const newRenameBtn = mainRow.querySelector(".rename-btn");
            if (newRenameBtn) {
                newRenameBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    startSidebarInlineRename(sess, itemEl);
                });
            }
            const newDeleteBtn = mainRow.querySelector(".delete-btn");
            if (newDeleteBtn) {
                newDeleteBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Bạn có chắc muốn xóa cuộc trò chuyện "${sess.title || 'này'}" khỏi Neon DB?`)) return;
                    await deleteChatSession(sess.session_id);
                });
            }
        };

        if (cancelBtn) {
            cancelBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                cancelEdit();
            });
        }

        if (input) {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelEdit();
                }
            });
            input.addEventListener("click", (e) => e.stopPropagation());
        }

        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const newTitle = input.value.trim();
                if (!newTitle) {
                    alert("Tiêu đề hội thoại không được để trống!");
                    input.focus();
                    return;
                }
                if (newTitle === sess.title) {
                    cancelEdit();
                    return;
                }

                input.disabled = true;
                const ok = await renameChatSessionApi(sess.session_id, newTitle);
                if (ok) {
                    sess.title = newTitle;
                    renderSidebarSessions(sidebarHistorySearch?.value?.toLowerCase()?.trim() || "");
                    renderHistorySessionsList(historySearchInput?.value?.toLowerCase()?.trim() || "");
                } else {
                    input.disabled = false;
                    input.focus();
                }
            });
        }
    }

    // Gọi API đổi tên session trên Neon DB
    async function renameChatSessionApi(sessionId, newTitle) {
        try {
            const res = await fetchApiWithFallback(`/api/chat/sessions/${encodeURIComponent(sessionId)}/rename`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    title: newTitle,
                    username: currentUser.username,
                    role: currentUser.role
                })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                return true;
            } else {
                alert(data.error || "Không thể đổi tên hội thoại.");
                return false;
            }
        } catch (e) {
            alert("Lỗi khi kết nối đổi tên hội thoại: " + e.message);
            return false;
        }
    }

    // Hiển thị danh sách trong Modal Lịch Sử Chat
    function renderHistorySessionsList(filterQuery = "") {
        if (!historySessionsContainer) return;
        let sessions = loadedHistorySessions;
        if (filterQuery) {
            sessions = sessions.filter(s =>
                (s.title && s.title.toLowerCase().includes(filterQuery)) ||
                (s.model && s.model.toLowerCase().includes(filterQuery)) ||
                (s.collections && s.collections.toLowerCase().includes(filterQuery))
            );
        }

        if (sessions.length === 0) {
            historySessionsContainer.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding: 2.5rem 1rem;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">💬</div>
                    <p style="margin: 0; font-size: 0.9rem;">${filterQuery ? "Không tìm thấy phiên chat phù hợp." : "Chưa có phiên trò chuyện nào được lưu trên Neon DB."}</p>
                </div>
            `;
            return;
        }

        historySessionsContainer.innerHTML = "";
        sessions.forEach(sess => {
            const card = document.createElement("div");
            card.className = `history-session-card ${sess.session_id === currentSessionId ? 'active' : ''}`;
            card.setAttribute("data-session-id", sess.session_id);

            const isDirect = sess.chat_type === "direct";
            const typeLabel = isDirect ? "🤖 Trực tiếp" : "📚 RAG";
            const colLabel = sess.collections ? `📁 ${sess.collections}` : "";
            const msgCount = sess.message_count ? `${sess.message_count} tin` : "";

            card.innerHTML = `
                <div class="history-session-info">
                    <div class="history-session-title" title="${escapeHtml(sess.title)}">
                        ${escapeHtml(sess.title || "Đoạn hội thoại mới")}
                    </div>
                    <div class="history-session-meta">
                        <span class="history-tag history-tag-model">${escapeHtml(sess.model || 'qwen2.5:14b')}</span>
                        <span class="history-tag">${typeLabel}</span>
                        ${colLabel ? `<span class="history-tag">${escapeHtml(colLabel)}</span>` : ""}
                        ${msgCount ? `<span class="history-tag">${msgCount}</span>` : ""}
                        <span>🕒 ${formatRelativeTime(sess.updated_at)}</span>
                        ${sess.username && sess.username !== currentUser.username ? `<span class="history-tag">👤 ${escapeHtml(sess.username)}</span>` : ""}
                    </div>
                </div>
                <div style="display: flex; gap: 0.35rem; align-items: center;">
                    <button class="history-rename-btn icon-btn" title="Đổi tên phiên này" style="padding: 4px; border-radius: 4px; color: var(--text-muted);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="history-delete-btn" title="Xóa phiên này">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;

            // Click vào session để khôi phục
            card.addEventListener("click", (e) => {
                if (e.target.closest(".history-rename-btn") || e.target.closest(".history-delete-btn")) return;
                restoreSessionMessages(sess);
                closeHistoryModal();
            });

            // Click nút đổi tên trên modal
            const renameBtn = card.querySelector(".history-rename-btn");
            if (renameBtn) {
                renameBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const newTitle = prompt("Nhập tên mới cho cuộc trò chuyện:", sess.title || "");
                    if (newTitle !== null && newTitle.trim() && newTitle.trim() !== sess.title) {
                        const ok = await renameChatSessionApi(sess.session_id, newTitle.trim());
                        if (ok) {
                            sess.title = newTitle.trim();
                            renderSidebarSessions(sidebarHistorySearch?.value?.toLowerCase()?.trim() || "");
                            renderHistorySessionsList(historySearchInput?.value?.toLowerCase()?.trim() || "");
                        }
                    }
                });
            }

            // Click nút xóa
            const delBtn = card.querySelector(".history-delete-btn");
            if (delBtn) {
                delBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Bạn có chắc muốn xóa phiên trò chuyện "${sess.title}" khỏi Neon DB?`)) return;
                    await deleteChatSession(sess.session_id);
                });
            }

            historySessionsContainer.appendChild(card);
        });
    }

    async function deleteChatSession(sessionId) {
        try {
            const endpoint = `/api/chat/sessions/${encodeURIComponent(sessionId)}?username=${encodeURIComponent(currentUser.username)}&role=${encodeURIComponent(currentUser.role)}`;
            const res = await fetchApiWithFallback(endpoint, {
                method: "DELETE"
            });
            const data = await res.json();
            if (res.ok && data.success) {
                loadedHistorySessions = loadedHistorySessions.filter(s => s.session_id !== sessionId);
                renderSidebarSessions(sidebarHistorySearch?.value?.toLowerCase()?.trim() || "");
                renderHistorySessionsList(historySearchInput?.value?.toLowerCase()?.trim() || "");
                if (sessionId === currentSessionId) {
                    startNewChatSession();
                }
            } else {
                alert(data.error || "Không thể xóa phiên hội thoại.");
            }
        } catch (e) {
            alert("Lỗi kết nối khi xóa phiên hội thoại: " + e.message);
        }
    }

    function startNewChatSession() {
        currentSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        localStorage.setItem("hpu2_session_id", currentSessionId);

        // Bỏ active ở tất cả thẻ session
        if (sidebarSessionsList) {
            sidebarSessionsList.querySelectorAll(".sidebar-session-item.active").forEach(el => el.classList.remove("active"));
        }
        if (historySessionsContainer) {
            historySessionsContainer.querySelectorAll(".history-session-card.active").forEach(el => el.classList.remove("active"));
        }

        // Reset Direct Chat
        directChatHistory = [];
        if (directMessagesContainer) {
            directMessagesContainer.innerHTML = `
                <div class="chat-hero-card">
                    <div class="hero-icon">✨</div>
                    <h2>Trò Chuyện Trực Tiếp Với AI</h2>
                    <p>Phiên trò chuyện mới đã sẵn sàng. Hãy đặt câu hỏi hoặc chọn các gợi ý bên dưới.</p>
                </div>
            `;
        }

        // Reset RAG Chat
        ragChatHistory = [];
        if (ragMessagesContainer) {
            ragMessagesContainer.innerHTML = `
                <div class="message bot">
                    <div class="avatar bot-avatar">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9Z"></path></svg>
                    </div>
                    <div class="message-content">
                        <div class="message-sender-title">
                            <span class="sender-name">AI Playground</span>
                            <span class="sender-badge rag">📚 Chế Độ RAG</span>
                            <span class="message-time">${formatTime(new Date())}</span>
                        </div>
                        <div class="content">
                            <p>Đã bắt đầu phiên hỏi đáp RAG mới! Bạn có thể chọn tài liệu và đặt câu hỏi.</p>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    async function restoreSessionMessages(sessionInfo) {
        currentSessionId = sessionInfo.session_id;
        localStorage.setItem("hpu2_session_id", currentSessionId);

        // Cập nhật trạng thái active trên sidebar & modal
        if (sidebarSessionsList) {
            sidebarSessionsList.querySelectorAll(".sidebar-session-item").forEach(el => {
                el.classList.toggle("active", el.getAttribute("data-session-id") === sessionInfo.session_id);
            });
        }
        if (historySessionsContainer) {
            historySessionsContainer.querySelectorAll(".history-session-card").forEach(el => {
                el.classList.toggle("active", el.getAttribute("data-session-id") === sessionInfo.session_id);
            });
        }

        const isDirect = sessionInfo.chat_type === "direct";
        const targetTab = isDirect ? "tab-direct-chat" : "tab-rag-chat";

        // Kích hoạt tab tương ứng
        tabBtns.forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === targetTab));
        tabContents.forEach(c => c.classList.toggle("active", c.id === targetTab));

        // Khôi phục model và mode nếu có
        if (isDirect && selectModelDirect && sessionInfo.model) {
            selectModelDirect.value = sessionInfo.model;
        } else if (!isDirect) {
            if (selectModelRag && sessionInfo.model) selectModelRag.value = sessionInfo.model;
            if (sessionInfo.collections) {
                const cols = sessionInfo.collections.split("+").filter(Boolean);
                if (cols.length > 0) {
                    selectedCollections = new Set(cols);
                    renderCollectionsCheckboxList();
                }
            }
        }

        const container = isDirect ? directMessagesContainer : ragMessagesContainer;
        if (!container) return;

        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 3rem 1rem;">
                <div class="spinner-sm" style="margin: 0 auto 0.5rem auto;"></div>
                <span>Đang tải tin nhắn phiên "${escapeHtml(sessionInfo.title)}"...</span>
            </div>
        `;

        try {
            const endpoint = `/api/chat/sessions/${encodeURIComponent(sessionInfo.session_id)}/messages?username=${encodeURIComponent(currentUser.username)}&role=${encodeURIComponent(currentUser.role)}`;
            const res = await fetchApiWithFallback(endpoint);
            const data = await res.json();
            const msgs = data.messages || [];

            container.innerHTML = "";
            if (isDirect) directChatHistory = [];
            else ragChatHistory = [];

            if (msgs.length === 0) {
                container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted);">(Phiên này chưa có tin nhắn nào)</div>`;
                return;
            }

            msgs.forEach(m => {
                const isUser = m.role === "user";
                const imagesList = m.images ? (Array.isArray(m.images) ? m.images : [m.images]) : [];
                const formattedImages = imagesList.map(img => typeof img === "string" ? { base64: img } : img);

                if (isUser) {
                    const attachedFilesList = m.attached_files ? (Array.isArray(m.attached_files) ? m.attached_files : [m.attached_files]) : [];
                    appendMessage("user", m.content, container, isDirect ? "direct" : "rag", formattedImages, attachedFilesList);
                    if (isDirect) directChatHistory.push({ role: "user", content: m.content });
                    else ragChatHistory.push({ role: "user", content: m.content });
                } else {
                    const botMsg = appendMessage("bot", "", container, isDirect ? "direct" : "rag");
                    renderRichContent(m.content || "", botMsg.contentEl);

                    if (m.citations && botMsg.metaEl) {
                        renderCitations(m.citations, botMsg.metaEl);
                    }
                    if (m.images && botMsg.imagesEl && Array.isArray(m.images)) {
                        renderMultimodalImages(m.images, botMsg.imagesEl);
                    }
                    if (isDirect) directChatHistory.push({ role: "assistant", content: m.content });
                    else ragChatHistory.push({ role: "assistant", content: m.content });
                }
            });

            container.scrollTop = container.scrollHeight;
        } catch (e) {
            console.error("Lỗi khôi phục messages:", e);
            container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--danger);">⚠️ Lỗi tải tin nhắn: ${escapeHtml(e.message)}</div>`;
        }
    }

    // Tự động đồng bộ lịch sử ngầm định kỳ 12s
    setInterval(() => {
        if (currentUser && currentUser.username) {
            loadHistorySessions(true);
        }
    }, 12000);

    // =========================================================================
    // PHÂN HỆ OFFICE STUDIO AI (TẠO, SỬA & ĐÁNH GIÁ TÀI LIỆU LOCAL OLLAMA)
    // =========================================================================
    function formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function initOfficeStudio() {
        // 1. Chuyển đổi giữa các phân vùng (Pills)
        const officePills = document.querySelectorAll(".office-pill-btn");
        const officePanels = {
            generate: document.getElementById("office-panel-generate"),
            edit: document.getElementById("office-panel-edit"),
            evaluate: document.getElementById("office-panel-evaluate"),
            files: document.getElementById("office-panel-files")
        };

        officePills.forEach(pill => {
            pill.addEventListener("click", () => {
                const mode = pill.getAttribute("data-office-mode");
                officePills.forEach(p => p.classList.remove("active"));
                pill.classList.add("active");

                Object.keys(officePanels).forEach(k => {
                    if (officePanels[k]) {
                        officePanels[k].style.display = (k === mode) ? "block" : "none";
                    }
                });

                if (mode === "files") {
                    loadOfficeFilesList();
                }
            });
        });

        // 2. Chọn định dạng tài liệu (docx, xlsx, pptx)
        const typeCards = document.querySelectorAll(".office-type-card");
        let selectedDocType = "docx";
        typeCards.forEach(card => {
            card.addEventListener("click", () => {
                typeCards.forEach(c => c.classList.remove("active"));
                card.classList.add("active");
                const radio = card.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    selectedDocType = radio.value;
                }
            });
        });

        // Gợi ý prompt nhanh
        const officeChips = document.querySelectorAll(".office-chip");
        const genPromptInput = document.getElementById("office-gen-prompt");
        officeChips.forEach(chip => {
            chip.addEventListener("click", () => {
                if (genPromptInput) {
                    genPromptInput.value = chip.getAttribute("data-text") || "";
                    const targetType = chip.getAttribute("data-target");
                    if (targetType) {
                        typeCards.forEach(c => {
                            if (c.getAttribute("data-type") === targetType) {
                                c.click();
                            }
                        });
                    }
                    genPromptInput.focus();
                }
            });
        });

        // 2.2 Xử lý chọn Mô hình bằng Thẻ Pill Hiện Đại (Model Pill Grid)
        const modelPillGrids = document.querySelectorAll(".office-model-pill-grid, .office-model-cards-grid");
        modelPillGrids.forEach(grid => {
            const targetInputId = grid.getAttribute("data-target");
            const targetInput = targetInputId ? document.getElementById(targetInputId) : null;
            const pills = grid.querySelectorAll(".office-model-pill, .office-model-card");

            pills.forEach(pill => {
                pill.addEventListener("click", () => {
                    pills.forEach(p => p.classList.remove("active"));
                    pill.classList.add("active");
                    const modelVal = pill.getAttribute("data-model");
                    if (targetInput && modelVal) {
                        targetInput.value = modelVal;
                    }
                });
            });
        });

        // 2.3 Xử lý chọn Phong Cách & Thể Thức Văn Bản (Style Pill Grid)
        const stylePillGrids = document.querySelectorAll(".office-style-pill-grid");
        stylePillGrids.forEach(grid => {
            const targetInputId = grid.getAttribute("data-target");
            const targetInput = targetInputId ? document.getElementById(targetInputId) : null;
            const pills = grid.querySelectorAll(".office-style-pill");

            pills.forEach(pill => {
                pill.addEventListener("click", () => {
                    pills.forEach(p => p.classList.remove("active"));
                    pill.classList.add("active");
                    const styleVal = pill.getAttribute("data-style");
                    if (targetInput && styleVal) {
                        targetInput.value = styleVal;
                    }
                });
            });
        });

        // 3. Xử lý Tạo Tài Liệu (Generate)
        let lastGeneratedDoc = null;
        const genSubmitBtn = document.getElementById("office-gen-submit-btn");
        const genPlaceholder = document.getElementById("office-gen-result-placeholder");
        const genLoading = document.getElementById("office-gen-loading");
        const genSuccessBox = document.getElementById("office-gen-success-box");
        const genModelSelect = document.getElementById("office-gen-model");
        const genStyleSelect = document.getElementById("office-gen-style");
        const genLoadingStatus = document.getElementById("office-gen-loading-status");

        const genBadgeIcon = document.getElementById("office-gen-badge-icon");
        const genFileTitle = document.getElementById("office-gen-file-title");
        const genFileSize = document.getElementById("office-gen-file-size");
        const genFileType = document.getElementById("office-gen-file-type");
        const genDownloadBtn = document.getElementById("office-gen-download-btn");
        const genPreviewBtn = document.getElementById("office-gen-preview-btn");
        const genPreviewContent = document.getElementById("office-gen-preview-content");

        if (genPreviewBtn) {
            genPreviewBtn.addEventListener("click", () => {
                if (lastGeneratedDoc) {
                    openOfficePreview(
                        lastGeneratedDoc.download_url,
                        lastGeneratedDoc.filename,
                        lastGeneratedDoc.file_type,
                        lastGeneratedDoc.parsed_structure
                    );
                }
            });
        }

        if (genSubmitBtn) {
            genSubmitBtn.addEventListener("click", async () => {
                const prompt = genPromptInput ? genPromptInput.value.trim() : "";
                if (!prompt) {
                    alert("Vui lòng nhập nội dung hoặc mô tả yêu cầu soạn thảo tài liệu!");
                    if (genPromptInput) genPromptInput.focus();
                    return;
                }

                const model = genModelSelect ? genModelSelect.value : "qwen2.5:14b";
                const style = genStyleSelect ? genStyleSelect.value : "standard";

                genSubmitBtn.disabled = true;
                if (genPlaceholder) genPlaceholder.style.display = "none";
                if (genSuccessBox) genSuccessBox.style.display = "none";
                if (genLoading) genLoading.style.display = "flex";
                if (genLoadingStatus) genLoadingStatus.textContent = `Mô hình Ollama (${model}) đang phân tích cấu trúc và soạn thảo...`;

                try {
                    const apiBase = CONFIG.getApiBase();
                    const res = await fetchApiWithFallback("/api/office/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            doc_type: selectedDocType,
                            prompt: prompt,
                            model: model,
                            style: style
                        })
                    });

                    const data = await res.json();
                    if (!res.ok || !data.success) {
                        throw new Error(data.error || "Lỗi khi tạo tài liệu Office.");
                    }

                    lastGeneratedDoc = data;
                    if (genLoading) genLoading.style.display = "none";
                    if (genSuccessBox) genSuccessBox.style.display = "block";

                    const extIcons = { docx: "📘", xlsx: "📗", pptx: "📙" };
                    if (genBadgeIcon) genBadgeIcon.textContent = extIcons[data.file_type] || "📄";
                    if (genFileTitle) genFileTitle.textContent = data.filename;
                    if (genFileSize) genFileSize.textContent = formatBytes(data.file_size || 0);
                    if (genFileType) genFileType.textContent = (data.file_type || "docx").toUpperCase();
                    if (genDownloadBtn) {
                        genDownloadBtn.href = `${apiBase}${data.download_url}`;
                        genDownloadBtn.setAttribute("download", data.filename);
                    }

                    if (genPreviewContent) {
                        let previewText = "";
                        if (data.parsed_structure && data.parsed_structure.title) {
                            previewText = `### ${data.parsed_structure.title}\n\n`;
                            if (data.parsed_structure.sections) {
                                data.parsed_structure.sections.forEach(s => {
                                    if (s.heading) previewText += `**${s.heading}**\n\n`;
                                    if (s.content) previewText += s.content.join("\n\n") + "\n\n";
                                    if (s.items) previewText += s.items.map(it => `- ${it}`).join("\n") + "\n\n";
                                });
                            }
                        } else {
                            previewText = data.raw_text || "Tài liệu đã được tạo thành công.";
                        }
                        renderRichContent(previewText, genPreviewContent);
                    }

                } catch (err) {
                    console.error("Lỗi tạo tài liệu Office:", err);
                    alert(`Không thể tạo tài liệu: ${err.message}`);
                    if (genLoading) genLoading.style.display = "none";
                    if (genPlaceholder) genPlaceholder.style.display = "flex";
                } finally {
                    genSubmitBtn.disabled = false;
                }
            });
        }

        // 4. Xử lý Chỉnh Sửa Tài Liệu (Edit)
        let lastEditedDoc = null;
        const editDropzone = document.getElementById("office-edit-dropzone");
        const editFileInput = document.getElementById("office-edit-file-input");
        const editSelectedFile = document.getElementById("office-edit-selected-file");
        const editFilename = document.getElementById("office-edit-filename");
        const editFileClear = document.getElementById("office-edit-file-clear");
        const editPromptInput = document.getElementById("office-edit-prompt");
        const editModelSelect = document.getElementById("office-edit-model");
        const editSubmitBtn = document.getElementById("office-edit-submit-btn");

        const editPlaceholder = document.getElementById("office-edit-result-placeholder");
        const editLoading = document.getElementById("office-edit-loading");
        const editSuccessBox = document.getElementById("office-edit-success-box");
        const editResTitle = document.getElementById("office-edit-res-title");
        const editDownloadBtn = document.getElementById("office-edit-download-btn");
        const editPreviewBtn = document.getElementById("office-edit-preview-btn");
        const editChangelogList = document.getElementById("office-edit-changelog-list");

        if (editPreviewBtn) {
            editPreviewBtn.addEventListener("click", () => {
                if (lastEditedDoc) {
                    openOfficePreview(
                        lastEditedDoc.download_url,
                        lastEditedDoc.filename,
                        lastEditedDoc.file_type || "docx"
                    );
                }
            });
        }

        let currentEditFile = null;

        if (editDropzone && editFileInput) {
            editDropzone.addEventListener("click", (e) => {
                if (e.target !== editFileClear) editFileInput.click();
            });

            editDropzone.addEventListener("dragover", (e) => {
                e.preventDefault();
                editDropzone.style.borderColor = "var(--primary)";
            });

            editDropzone.addEventListener("dragleave", () => {
                editDropzone.style.borderColor = "";
            });

            editDropzone.addEventListener("drop", (e) => {
                e.preventDefault();
                editDropzone.style.borderColor = "";
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    setEditFile(e.dataTransfer.files[0]);
                }
            });

            editFileInput.addEventListener("change", (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    setEditFile(e.target.files[0]);
                }
            });
        }

        function setEditFile(file) {
            currentEditFile = file;
            if (editFilename) editFilename.textContent = file.name;
            if (editSelectedFile) editSelectedFile.style.display = "inline-flex";
            const inner = editDropzone ? editDropzone.querySelector(".dropzone-inner") : null;
            if (inner) inner.style.display = "none";
        }

        if (editFileClear) {
            editFileClear.addEventListener("click", (e) => {
                e.stopPropagation();
                currentEditFile = null;
                if (editFileInput) editFileInput.value = "";
                if (editSelectedFile) editSelectedFile.style.display = "none";
                const inner = editDropzone ? editDropzone.querySelector(".dropzone-inner") : null;
                if (inner) inner.style.display = "block";
            });
        }

        if (editSubmitBtn) {
            editSubmitBtn.addEventListener("click", async () => {
                if (!currentEditFile) {
                    alert("Vui lòng tải lên file tài liệu cần chỉnh sửa!");
                    return;
                }
                const prompt = editPromptInput ? editPromptInput.value.trim() : "";
                if (!prompt) {
                    alert("Vui lòng nhập yêu cầu hoặc hướng dẫn chỉnh sửa!");
                    if (editPromptInput) editPromptInput.focus();
                    return;
                }

                const model = editModelSelect ? editModelSelect.value : "qwen2.5:14b";
                editSubmitBtn.disabled = true;
                if (editPlaceholder) editPlaceholder.style.display = "none";
                if (editSuccessBox) editSuccessBox.style.display = "none";
                if (editLoading) editLoading.style.display = "flex";

                const formData = new FormData();
                formData.append("file", currentEditFile);
                formData.append("prompt", prompt);
                formData.append("model", model);

                try {
                    const apiBase = CONFIG.getApiBase();
                    const res = await fetchApiWithFallback("/api/office/edit", {
                        method: "POST",
                        body: formData
                    });

                    const data = await res.json();
                    if (!res.ok || !data.success) {
                        throw new Error(data.error || "Lỗi khi chỉnh sửa tài liệu Office.");
                    }

                    lastEditedDoc = data;
                    if (editLoading) editLoading.style.display = "none";
                    if (editSuccessBox) editSuccessBox.style.display = "block";

                    if (editResTitle) editResTitle.textContent = data.filename;
                    if (editDownloadBtn) {
                        editDownloadBtn.href = `${apiBase}${data.download_url}`;
                        editDownloadBtn.setAttribute("download", data.filename);
                    }

                    if (editChangelogList) {
                        editChangelogList.innerHTML = "";
                        const changes = data.changelog || ["Đã chỉnh sửa và tối ưu hóa toàn bộ nội dung tài liệu."];
                        changes.forEach(ch => {
                            const li = document.createElement("li");
                            li.textContent = ch;
                            editChangelogList.appendChild(li);
                        });
                    }

                } catch (err) {
                    console.error("Lỗi sửa tài liệu:", err);
                    alert(`Không thể sửa tài liệu: ${err.message}`);
                    if (editLoading) editLoading.style.display = "none";
                    if (editPlaceholder) editPlaceholder.style.display = "flex";
                } finally {
                    editSubmitBtn.disabled = false;
                }
            });
        }

        // 5. Xử lý Chấm Điểm & Đánh Giá Đáp Án Mẫu (Evaluate)
        const evalSubDropzone = document.getElementById("office-eval-sub-dropzone");
        const evalSubInput = document.getElementById("office-eval-sub-input");
        const evalSubBadge = document.getElementById("office-eval-sub-badge");
        const evalSubName = document.getElementById("office-eval-sub-name");
        const evalSubClear = document.getElementById("office-eval-sub-clear");

        const evalAnsDropzone = document.getElementById("office-eval-ans-dropzone");
        const evalAnsInput = document.getElementById("office-eval-ans-input");
        const evalAnsBadge = document.getElementById("office-eval-ans-badge");
        const evalAnsName = document.getElementById("office-eval-ans-name");
        const evalAnsClear = document.getElementById("office-eval-ans-clear");

        const evalNotesInput = document.getElementById("office-eval-notes");
        const evalModelSelect = document.getElementById("office-eval-model");
        const evalSubmitBtn = document.getElementById("office-eval-submit-btn");

        const evalPlaceholder = document.getElementById("office-eval-placeholder");
        const evalLoading = document.getElementById("office-eval-loading");
        const evalResultsBox = document.getElementById("office-eval-results-box");

        const evalScoreNum = document.getElementById("eval-score-num");
        const evalScoreMaxNum = document.getElementById("eval-score-max-num");
        const evalGradeBadge = document.getElementById("eval-grade-badge");
        const evalPercentBadge = document.getElementById("eval-percent-badge");
        const evalTitleDisplay = document.getElementById("eval-title-display");
        const evalSummaryDisplay = document.getElementById("eval-summary-display");
        const evalReportDownloadBtn = document.getElementById("eval-report-download-btn");
        const evalReportPreviewBtn = document.getElementById("eval-report-preview-btn");

        let lastEvalDoc = null;
        if (evalReportPreviewBtn) {
            evalReportPreviewBtn.addEventListener("click", () => {
                if (lastEvalDoc && lastEvalDoc.report_download_url) {
                    openOfficePreview(
                        lastEvalDoc.report_download_url,
                        lastEvalDoc.report_filename || "Bao_Cao_Danh_Gia.docx",
                        "docx"
                    );
                }
            });
        }

        const evalCriteriaTbody = document.getElementById("eval-criteria-tbody");
        const evalErrorsCard = document.getElementById("eval-errors-card");
        const evalErrorsTbody = document.getElementById("eval-errors-tbody");
        const evalStrengthsList = document.getElementById("eval-strengths-list");
        const evalRecommendationsList = document.getElementById("eval-recommendations-list");

        let currentSubFile = null;
        let currentAnsFile = null;

        if (evalSubDropzone && evalSubInput) {
            evalSubDropzone.addEventListener("click", (e) => {
                if (e.target !== evalSubClear) evalSubInput.click();
            });
            evalSubInput.addEventListener("change", (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    currentSubFile = e.target.files[0];
                    if (evalSubName) evalSubName.textContent = currentSubFile.name;
                    if (evalSubBadge) evalSubBadge.style.display = "inline-flex";
                    const inner = evalSubDropzone.querySelector(".dropzone-inner-sm");
                    if (inner) inner.style.display = "none";
                }
            });
        }
        if (evalSubClear) {
            evalSubClear.addEventListener("click", (e) => {
                e.stopPropagation();
                currentSubFile = null;
                if (evalSubInput) evalSubInput.value = "";
                if (evalSubBadge) evalSubBadge.style.display = "none";
                const inner = evalSubDropzone.querySelector(".dropzone-inner-sm");
                if (inner) inner.style.display = "flex";
            });
        }

        if (evalAnsDropzone && evalAnsInput) {
            evalAnsDropzone.addEventListener("click", (e) => {
                if (e.target !== evalAnsClear) evalAnsInput.click();
            });
            evalAnsInput.addEventListener("change", (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    currentAnsFile = e.target.files[0];
                    if (evalAnsName) evalAnsName.textContent = currentAnsFile.name;
                    if (evalAnsBadge) evalAnsBadge.style.display = "inline-flex";
                    const inner = evalAnsDropzone.querySelector(".dropzone-inner-sm");
                    if (inner) inner.style.display = "none";
                }
            });
        }
        if (evalAnsClear) {
            evalAnsClear.addEventListener("click", (e) => {
                e.stopPropagation();
                currentAnsFile = null;
                if (evalAnsInput) evalAnsInput.value = "";
                if (evalAnsBadge) evalAnsBadge.style.display = "none";
                const inner = evalAnsDropzone.querySelector(".dropzone-inner-sm");
                if (inner) inner.style.display = "flex";
            });
        }

        if (evalSubmitBtn) {
            evalSubmitBtn.addEventListener("click", async () => {
                if (!currentSubFile) {
                    alert("Vui lòng tải lên [1. File bài làm / Bài nộp] cần chấm điểm!");
                    return;
                }
                if (!currentAnsFile) {
                    alert("Vui lòng tải lên [2. File đáp án mẫu / Barem tiêu chí] để đối chiếu!");
                    return;
                }

                const criteriaNotes = evalNotesInput ? evalNotesInput.value.trim() : "";
                const model = evalModelSelect ? evalModelSelect.value : "qwen2.5:14b";

                evalSubmitBtn.disabled = true;
                if (evalPlaceholder) evalPlaceholder.style.display = "none";
                if (evalResultsBox) evalResultsBox.style.display = "none";
                if (evalLoading) evalLoading.style.display = "flex";

                const formData = new FormData();
                formData.append("submission_file", currentSubFile);
                formData.append("answer_key_file", currentAnsFile);
                formData.append("criteria_notes", criteriaNotes);
                formData.append("model", model);

                try {
                    const apiBase = CONFIG.getApiBase();
                    const res = await fetchApiWithFallback("/api/office/evaluate", {
                        method: "POST",
                        body: formData
                    });

                    const data = await res.json();
                    if (!res.ok || !data.success) {
                        throw new Error(data.error || "Lỗi khi chấm điểm tài liệu.");
                    }

                    lastEvalDoc = data;
                    if (evalLoading) evalLoading.style.display = "none";
                    if (evalResultsBox) evalResultsBox.style.display = "block";

                    const ev = data.evaluation || {};

                    if (evalScoreNum) evalScoreNum.textContent = ev.total_score !== undefined ? ev.total_score : "-";
                    if (evalScoreMaxNum) evalScoreMaxNum.textContent = ev.max_score !== undefined ? ev.max_score : "10";
                    if (evalGradeBadge) evalGradeBadge.textContent = ev.grade || "Hoàn thành";
                    if (evalPercentBadge) evalPercentBadge.textContent = `${ev.score_percentage || 0}% Đạt chuẩn`;
                    if (evalTitleDisplay) evalTitleDisplay.textContent = ev.evaluation_title || "Báo Cáo Đánh Giá & Chấm Điểm";
                    if (evalSummaryDisplay) evalSummaryDisplay.textContent = ev.executive_summary || "";

                    if (evalReportDownloadBtn && data.report_download_url) {
                        evalReportDownloadBtn.href = `${apiBase}${data.report_download_url}`;
                        evalReportDownloadBtn.setAttribute("download", data.report_filename || "Bao_Cao_Danh_Gia.docx");
                        evalReportDownloadBtn.style.display = "inline-flex";
                    }

                    if (evalCriteriaTbody) {
                        evalCriteriaTbody.innerHTML = "";
                        const criteria = ev.criteria_breakdown || [];
                        if (criteria.length === 0) {
                            evalCriteriaTbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:15px; color:var(--text-muted);">Không có phân rã tiêu chí chi tiết.</td></tr>`;
                        } else {
                            criteria.forEach((c, idx) => {
                                const statusClass = (c.status === "pass") ? "status-badge-pass" : ((c.status === "fail") ? "status-badge-fail" : "status-badge-partial");
                                const statusLabel = (c.status === "pass") ? "Đạt" : ((c.status === "fail") ? "Sai / Thiếu" : "Một phần");
                                const tr = document.createElement("tr");
                                tr.innerHTML = `
                                    <td style="font-weight:600;">${idx + 1}</td>
                                    <td><strong>${escapeHtml(c.criterion || "")}</strong></td>
                                    <td><span class="${statusClass}">${c.score} / ${c.max_score} (${statusLabel})</span></td>
                                    <td>${escapeHtml(c.assessment || "")}</td>
                                `;
                                evalCriteriaTbody.appendChild(tr);
                            });
                        }
                    }

                    if (evalErrorsTbody) {
                        evalErrorsTbody.innerHTML = "";
                        const errors = ev.errors_identified || [];
                        if (errors.length === 0) {
                            if (evalErrorsCard) evalErrorsCard.style.display = "none";
                        } else {
                            if (evalErrorsCard) evalErrorsCard.style.display = "block";
                            errors.forEach((err, idx) => {
                                const tr = document.createElement("tr");
                                tr.innerHTML = `
                                    <td>${idx + 1}</td>
                                    <td><code>${escapeHtml(err.location || "Toàn bài")}</code></td>
                                    <td><span class="status-badge-fail">${escapeHtml(err.type || "Lỗi sai")}</span></td>
                                    <td>
                                        <div style="font-size:0.8rem;">
                                            <div style="color:var(--danger);">❌ Bài nộp: "${escapeHtml(err.submission_quote || "")}"</div>
                                            <div style="color:var(--success); margin-top:3px;">✔️ Chuẩn: "${escapeHtml(err.expected_quote || "")}"</div>
                                        </div>
                                    </td>
                                    <td>${escapeHtml(err.explanation || "")}</td>
                                `;
                                evalErrorsTbody.appendChild(tr);
                            });
                        }
                    }

                    if (evalStrengthsList) {
                        evalStrengthsList.innerHTML = "";
                        const strList = ev.strengths || ["Bài làm bám sát cấu trúc yêu cầu."];
                        strList.forEach(s => {
                            const li = document.createElement("li");
                            li.textContent = s;
                            evalStrengthsList.appendChild(li);
                        });
                    }

                    if (evalRecommendationsList) {
                        evalRecommendationsList.innerHTML = "";
                        const recList = ev.recommendations || ["Rà soát kỹ các tiêu chí trong barem trước khi hoàn thiện."];
                        recList.forEach(r => {
                            const li = document.createElement("li");
                            li.textContent = r;
                            evalRecommendationsList.appendChild(li);
                        });
                    }

                } catch (err) {
                    console.error("Lỗi đánh giá tài liệu:", err);
                    alert(`Không thể chấm điểm: ${err.message}`);
                    if (evalLoading) evalLoading.style.display = "none";
                    if (evalPlaceholder) evalPlaceholder.style.display = "flex";
                } finally {
                    evalSubmitBtn.disabled = false;
                }
            });
        }

        // 6. Tải danh sách file Office đã tạo
        const refreshFilesBtn = document.getElementById("office-files-refresh-btn");
        if (refreshFilesBtn) {
            refreshFilesBtn.addEventListener("click", () => loadOfficeFilesList());
        }
    }

    async function loadOfficeFilesList() {
        const tbody = document.getElementById("office-files-tbody");
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:25px; color:var(--text-muted);"><div class="spinner-sm" style="margin:0 auto 8px;"></div>Đang tải danh sách tài liệu...</td></tr>`;

        try {
            const apiBase = CONFIG.getApiBase();
            const res = await fetchApiWithFallback("/api/office/list");
            const data = await res.json();

            if (!res.ok || !data.success || !data.files || data.files.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:30px; color:var(--text-muted);">Chưa có tệp Office nào được tạo trong hệ thống.</td></tr>`;
                return;
            }

            tbody.innerHTML = "";
            const extIcons = { docx: "📘 Word", xlsx: "📗 Excel", pptx: "📙 PPT", pdf: "📕 PDF" };

            data.files.forEach(f => {
                const tr = document.createElement("tr");
                const badge = extIcons[f.file_type] || f.file_type.toUpperCase();
                tr.innerHTML = `
                    <td><strong>${escapeHtml(f.filename)}</strong></td>
                    <td><span class="session-badge">${badge}</span></td>
                    <td>${formatBytes(f.size_bytes || 0)}</td>
                    <td style="font-size:0.8rem; color:var(--text-muted);">${f.created_at || "-"}</td>
                    <td style="text-align: center;">
                        <div style="display:flex; gap:0.4rem; justify-content:center; align-items:center;">
                            <button type="button" class="btn btn-primary btn-xs btn-file-preview" data-url="${f.download_url}" data-name="${escapeHtml(f.filename)}" data-type="${f.file_type}" title="Xem trước tài liệu trực tiếp">
                                👁️ Xem
                            </button>
                            <a href="${apiBase}${f.download_url}" class="btn btn-outline btn-xs" download="${f.filename}" title="Tải tệp này về máy">
                                📥 Tải
                            </a>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            tbody.querySelectorAll(".btn-file-preview").forEach(btn => {
                btn.addEventListener("click", () => {
                    const u = btn.getAttribute("data-url");
                    const n = btn.getAttribute("data-name");
                    const t = btn.getAttribute("data-type");
                    openOfficePreview(u, n, t);
                });
            });
        } catch (err) {
            console.error("Lỗi tải danh sách file Office:", err);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:20px; color:var(--danger);">⚠️ Lỗi khi tải danh sách: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    // ==========================================================================
    // OFFICE ONLINE PREVIEW STUDIO (DOCX, XLSX, PPTX, PDF)
    // ==========================================================================
    let currentPreviewZoom = 1.0;

    function resetPreviewZoom() {
        currentPreviewZoom = 1.0;
        applyPreviewZoom();
    }

    function applyPreviewZoom() {
        const zoomText = document.getElementById("office-zoom-level");
        if (zoomText) {
            zoomText.textContent = `${Math.round(currentPreviewZoom * 100)}%`;
        }
        const docxContainer = document.getElementById("office-docx-container");
        const xlsxWrapper = document.getElementById("office-xlsx-wrapper");
        const pptxContainer = document.getElementById("office-pptx-container");

        [docxContainer, xlsxWrapper, pptxContainer].forEach(el => {
            if (el && el.style.display !== "none") {
                el.style.transform = `scale(${currentPreviewZoom})`;
                el.style.transformOrigin = "top center";
                el.style.transition = "transform 0.15s ease-out";
            }
        });
    }

    async function openOfficePreview(fileUrl, filename, fileType, fallbackParsedData = null) {
        const modal = document.getElementById("office-preview-modal");
        const titleEl = document.getElementById("preview-filename");
        const iconEl = document.getElementById("preview-doc-icon");
        const statusEl = document.getElementById("preview-status-pill");
        const downloadBtn = document.getElementById("office-preview-download-btn");
        const loadingBox = document.getElementById("office-preview-loading");
        const loadingTxt = document.getElementById("office-preview-loading-txt");

        const docxContainer = document.getElementById("office-docx-container");
        const xlsxWrapper = document.getElementById("office-xlsx-wrapper");
        const xlsxContainer = document.getElementById("office-xlsx-container");
        const xlsxTabs = document.getElementById("office-xlsx-sheet-tabs");
        const pptxContainer = document.getElementById("office-pptx-container");
        const pptxSlideView = document.getElementById("office-pptx-slide-view");
        const pdfIframe = document.getElementById("office-pdf-iframe");

        if (!modal) return;

        // Đặt lại zoom & thông tin tiêu đề
        resetPreviewZoom();
        if (titleEl) titleEl.textContent = filename || "Tài liệu";
        
        const apiBase = CONFIG.getApiBase();
        const fullFileUrl = fileUrl.startsWith("http") ? fileUrl : `${apiBase}${fileUrl}`;
        if (downloadBtn) {
            downloadBtn.href = fullFileUrl;
            downloadBtn.setAttribute("download", filename || "document");
        }

        const ext = (fileType || (filename ? filename.split('.').pop() : "docx")).toLowerCase().replace('.', '');
        const icons = { docx: "📘", xlsx: "📗", xls: "📗", pptx: "📙", ppt: "📙", pdf: "📕" };
        if (iconEl) iconEl.textContent = icons[ext] || "📄";
        if (statusEl) statusEl.textContent = "Đang kết xuất tài liệu...";

        // Ẩn tất cả viewer trước khi render
        [docxContainer, xlsxWrapper, pptxContainer, pdfIframe].forEach(el => {
            if (el) el.style.display = "none";
        });
        if (loadingBox) loadingBox.style.display = "flex";
        if (loadingTxt) loadingTxt.textContent = "Đang tải dữ liệu tệp...";

        modal.style.display = "flex";

        try {
            if (ext === "docx") {
                if (loadingTxt) loadingTxt.textContent = "Đang dựng trang Word A4 (docx-preview)...";
                const res = await fetch(`${fullFileUrl}?preview=1`);
                if (!res.ok) throw new Error("Không thể tải tệp DOCX từ máy chủ.");
                const arrayBuf = await res.arrayBuffer();

                if (docxContainer) {
                    docxContainer.innerHTML = "";
                    docxContainer.style.display = "flex";
                    let renderSucceeded = false;
                    if (window.docx && typeof window.docx.renderAsync === "function") {
                        try {
                            await window.docx.renderAsync(arrayBuf, docxContainer, null, {
                                inWrapper: true,
                                ignoreWidth: false,
                                ignoreHeight: false,
                                ignoreFonts: false,
                                breakPages: true,
                                experimental: true,
                                useBase64URL: true,
                                renderHeaders: true,
                                renderFooters: true
                            });
                            renderSucceeded = true;
                        } catch (docxErr) {
                            console.warn("docx-preview renderAsync gặp sự cố, chuyển sang bộ dựng fallback:", docxErr);
                        }
                    }
                    if (!renderSucceeded) {
                        renderFallbackDocx(docxContainer, fallbackParsedData, filename);
                    }
                }
                if (statusEl) statusEl.textContent = "Đã kết xuất hoàn chỉnh";

            } else if (ext === "xlsx" || ext === "xls") {
                if (loadingTxt) loadingTxt.textContent = "Đang phân tích bảng tính Excel (SheetJS)...";
                const res = await fetch(`${fullFileUrl}?preview=1`);
                if (!res.ok) throw new Error("Không thể tải tệp Excel từ máy chủ.");
                const arrayBuf = await res.arrayBuffer();

                if (window.XLSX && typeof window.XLSX.read === "function") {
                    const wb = window.XLSX.read(arrayBuf, { type: "array" });
                    if (xlsxWrapper && xlsxContainer && xlsxTabs) {
                        xlsxTabs.innerHTML = "";
                        xlsxWrapper.style.display = "flex";

                        const renderSheet = (sheetName) => {
                            const ws = wb.Sheets[sheetName];
                            const html = window.XLSX.utils.sheet_to_html(ws, { id: "xlsx-table", editable: false });
                            xlsxContainer.innerHTML = html;
                        };

                        wb.SheetNames.forEach((sName, idx) => {
                            const btn = document.createElement("button");
                            btn.className = `xlsx-sheet-tab-btn ${idx === 0 ? "active" : ""}`;
                            btn.textContent = sName;
                            btn.addEventListener("click", () => {
                                xlsxTabs.querySelectorAll(".xlsx-sheet-tab-btn").forEach(b => b.classList.remove("active"));
                                btn.classList.add("active");
                                renderSheet(sName);
                            });
                            xlsxTabs.appendChild(btn);
                        });

                        if (wb.SheetNames.length > 0) {
                            renderSheet(wb.SheetNames[0]);
                        }
                    }
                } else {
                    if (xlsxContainer) xlsxContainer.innerHTML = `<div style="padding:2rem; background:#fff; border-radius:8px;">Thư viện SheetJS chưa sẵn sàng.</div>`;
                    if (xlsxWrapper) xlsxWrapper.style.display = "flex";
                }
                if (statusEl) statusEl.textContent = "Đã kết xuất bảng tính Excel";

            } else if (ext === "pptx" || ext === "ppt") {
                if (loadingTxt) loadingTxt.textContent = "Đang tải các slide bài thuyết trình...";
                let slides = [];
                let presTitle = filename;

                // Thử lấy cấu trúc slide từ endpoint backend
                try {
                    const slideRes = await fetch(`${apiBase}/api/office/pptx-data/${encodeURIComponent(filename)}`);
                    const slideData = await slideRes.json();
                    if (slideData.success && slideData.slides && slideData.slides.length > 0) {
                        slides = slideData.slides;
                        if (slideData.title) presTitle = slideData.title;
                    }
                } catch (e) {
                    console.warn("Không thể lấy pptx-data, chuyển sang parsed fallback:", e);
                }

                // Nếu không có, dùng dữ liệu vừa tạo
                if ((!slides || slides.length === 0) && fallbackParsedData && fallbackParsedData.slides) {
                    slides = fallbackParsedData.slides.map((s, idx) => ({
                        slide_number: idx + 1,
                        title: s.title || `Slide ${idx + 1}`,
                        bullets: s.bullets || [],
                        tables: s.table ? [
                            [s.table.headers || []].concat(s.table.rows || [])
                        ] : []
                    }));
                    if (fallbackParsedData.title) presTitle = fallbackParsedData.title;
                }

                const pptxThumbRail = document.getElementById("pptx-thumb-rail");
                if (pptxContainer && pptxSlideView) {
                    pptxContainer.style.display = "flex";
                    let currentSlideIdx = 0;

                    const counterEl = document.getElementById("pptx-slide-counter");
                    const prevBtn = document.getElementById("pptx-prev-slide-btn");
                    const nextBtn = document.getElementById("pptx-next-slide-btn");

                    const updateThumbActive = (idx) => {
                        if (!pptxThumbRail) return;
                        const thumbs = pptxThumbRail.querySelectorAll(".pptx-thumb-item");
                        thumbs.forEach((th, tIdx) => {
                            if (tIdx === idx) {
                                th.classList.add("active");
                                th.scrollIntoView({ behavior: "smooth", block: "nearest" });
                            } else {
                                th.classList.remove("active");
                            }
                        });
                    };

                    const renderSlide = (idx) => {
                        if (slides.length === 0) {
                            pptxSlideView.innerHTML = `
                                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#1e293b; text-align:center;">
                                    <div style="font-size:3rem; margin-bottom:1rem;">📙</div>
                                    <h3 style="margin:0 0 0.5rem 0;">${escapeHtml(presTitle)}</h3>
                                    <p style="color:#64748b;">Tệp trình chiếu PowerPoint chuẩn 16:9 đã sẵn sàng. Bạn có thể nhấn <strong>Tải Về Máy</strong> để trình chiếu với Microsoft PowerPoint.</p>
                                </div>
                            `;
                            if (counterEl) counterEl.textContent = "Slide 1 / 1";
                            return;
                        }

                        const s = slides[idx];
                        let bulletsHtml = "";
                        if (s.bullets && s.bullets.length > 0) {
                            bulletsHtml = `<ul style="font-size:1.15rem; line-height:1.75; color:#1e293b; margin:1.5rem 0 0 1.25rem;">${s.bullets.map(b => `<li style="margin-bottom:0.6rem;">${escapeHtml(b)}</li>`).join("")}</ul>`;
                        }

                        let tableHtml = "";
                        if (s.tables && s.tables.length > 0) {
                            const tbl = s.tables[0];
                            if (Array.isArray(tbl) && tbl.length > 0) {
                                tableHtml = `<div class="table-responsive" style="margin-top:1.25rem;"><table style="width:100%; border-collapse:collapse; font-size:0.95rem;">`;
                                tbl.forEach((row, rIdx) => {
                                    tableHtml += `<tr>${row.map(cell => `<td style="border:1px solid #cbd5e1; padding:8px 12px; background:${rIdx===0?'#1e3a8a':'#fff'}; color:${rIdx===0?'#fff':'#1f2937'}; font-weight:${rIdx===0?'700':'400'};">${escapeHtml(cell)}</td>`).join("")}</tr>`;
                                });
                                tableHtml += `</table></div>`;
                            }
                        }

                        pptxSlideView.innerHTML = `
                            <div style="display:flex; flex-direction:column; justify-content:center; height:100%; max-width:850px; margin:0 auto;">
                                <div style="display:flex; align-items:center; gap:0.75rem; border-bottom:2px solid #2563eb; padding-bottom:0.75rem;">
                                    <span style="background:#2563eb; color:#fff; font-size:0.8rem; font-weight:700; padding:2px 8px; border-radius:6px;">SLIDE ${idx + 1}</span>
                                    <h2 style="margin:0; font-size:1.45rem; color:#1e3a8a; font-weight:700;">${escapeHtml(s.title || `Slide ${idx + 1}`)}</h2>
                                </div>
                                <div style="flex:1; overflow-y:auto; padding-top:0.75rem;">
                                    ${bulletsHtml}
                                    ${tableHtml}
                                </div>
                            </div>
                        `;

                        if (counterEl) counterEl.textContent = `Slide ${idx + 1} / ${slides.length}`;
                        if (prevBtn) prevBtn.disabled = (idx === 0);
                        if (nextBtn) nextBtn.disabled = (idx === slides.length - 1);
                        updateThumbActive(idx);
                    };

                    if (pptxThumbRail) {
                        pptxThumbRail.innerHTML = "";
                        slides.forEach((sl, sIdx) => {
                            const thumb = document.createElement("div");
                            thumb.className = `pptx-thumb-item ${sIdx === 0 ? "active" : ""}`;
                            thumb.innerHTML = `
                                <span class="thumb-num">SLIDE ${sIdx + 1}</span>
                                <span class="thumb-title" title="${escapeHtml(sl.title || `Slide ${sIdx + 1}`)}">${escapeHtml(sl.title || `Slide ${sIdx + 1}`)}</span>
                            `;
                            thumb.addEventListener("click", () => {
                                currentSlideIdx = sIdx;
                                renderSlide(currentSlideIdx);
                            });
                            pptxThumbRail.appendChild(thumb);
                        });
                    }

                    if (prevBtn) {
                        prevBtn.onclick = () => {
                            if (currentSlideIdx > 0) {
                                currentSlideIdx--;
                                renderSlide(currentSlideIdx);
                            }
                        };
                    }
                    if (nextBtn) {
                        nextBtn.onclick = () => {
                            if (currentSlideIdx < slides.length - 1) {
                                currentSlideIdx++;
                                renderSlide(currentSlideIdx);
                            }
                        };
                    }

                    renderSlide(0);
                }
                if (statusEl) statusEl.textContent = "Đã kết xuất bài thuyết trình";

            } else if (ext === "pdf") {
                if (pdfIframe) {
                    pdfIframe.src = `${fullFileUrl}?preview=1`;
                    pdfIframe.style.display = "block";
                }
                if (statusEl) statusEl.textContent = "Đã tải tệp PDF";
            }

        } catch (err) {
            console.error("Lỗi xem trước Office:", err);
            if (statusEl) statusEl.textContent = "Không thể xem trước toàn bộ";
            alert(`Lỗi khi xem trước tài liệu: ${err.message}`);
        } finally {
            if (loadingBox) loadingBox.style.display = "none";
        }
    }

    // Trình dựng fallback đẹp mắt cho DOCX mô phỏng trang A4
    function renderFallbackDocx(container, data, filename) {
        if (!container) return;
        const title = (data && data.title) ? data.title : (filename || "Tài Liệu Văn Bản");
        let sectionsHtml = "";

        if (data && data.sections && Array.isArray(data.sections) && data.sections.length > 0) {
            data.sections.forEach(sec => {
                let secHeading = sec.heading ? `<h3>${escapeHtml(sec.heading)}</h3>` : "";
                let secContent = "";
                if (sec.content && Array.isArray(sec.content)) {
                    secContent = sec.content.map(p => `<p style="text-indent: 1.5rem; margin-bottom: 0.65rem; text-align: justify;">${escapeHtml(p)}</p>`).join("");
                } else if (typeof sec.content === "string") {
                    secContent = `<p style="text-indent: 1.5rem; margin-bottom: 0.65rem; text-align: justify;">${escapeHtml(sec.content)}</p>`;
                }
                let secItems = "";
                if (sec.items && Array.isArray(sec.items)) {
                    secItems = `<ul style="margin: 0.5rem 0 1rem 2rem;">${sec.items.map(it => `<li style="margin-bottom: 0.35rem;">${escapeHtml(it)}</li>`).join("")}</ul>`;
                }
                sectionsHtml += `
                    <div class="fallback-doc-section">
                        ${secHeading}
                        ${secContent}
                        ${secItems}
                    </div>
                `;
            });
        } else if (data && data.raw_text) {
            sectionsHtml = `<div class="fallback-doc-section"><p style="white-space: pre-wrap; line-height: 1.7;">${escapeHtml(data.raw_text)}</p></div>`;
        } else {
            sectionsHtml = `
                <div class="fallback-doc-section" style="text-align: center; padding: 2rem 0; color: #64748b;">
                    <p style="font-size: 1.05rem; margin-bottom: 1rem;">Tài liệu đã được tạo thành công với cấu trúc chuẩn Microsoft Word.</p>
                    <p style="font-size: 0.9rem;">Bạn có thể nhấn nút <strong>"Tải Về Máy"</strong> ở thanh công cụ để mở và chỉnh sửa trực tiếp trên Microsoft Word hoặc LibreOffice.</p>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="office-preview-fallback-doc">
                <div class="fallback-doc-header">
                    <p style="font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; color: #1e3a8a; margin-bottom: 4px;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
                    <p style="font-size: 0.82rem; font-weight: 700; color: #334155; margin-bottom: 1.25rem;">Độc lập - Tự do - Hạnh phúc</p>
                    <div style="width: 140px; height: 1.5px; background: #64748b; margin: 0 auto 1.5rem auto;"></div>
                    <h2>${escapeHtml(title)}</h2>
                </div>
                ${sectionsHtml}
            </div>
        `;
    }

    // Đăng ký các nút điều khiển xem trước (Zoom, In, Toàn Màn Hình, Đóng)
    const zoomInBtn = document.getElementById("office-zoom-in-btn");
    const zoomOutBtn = document.getElementById("office-zoom-out-btn");
    const zoomResetBtn = document.getElementById("office-zoom-reset-btn");
    const printBtn = document.getElementById("office-print-btn");
    const fullscreenBtn = document.getElementById("office-fullscreen-btn");
    const previewModalCard = document.querySelector(".office-preview-modal-card");
    const closePreviewBtn = document.getElementById("close-office-preview-btn");
    const previewModal = document.getElementById("office-preview-modal");

    if (zoomInBtn) {
        zoomInBtn.addEventListener("click", () => {
            if (currentPreviewZoom < 2.0) {
                currentPreviewZoom = Math.min(2.0, currentPreviewZoom + 0.15);
                applyPreviewZoom();
            }
        });
    }
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener("click", () => {
            if (currentPreviewZoom > 0.5) {
                currentPreviewZoom = Math.max(0.5, currentPreviewZoom - 0.15);
                applyPreviewZoom();
            }
        });
    }
    if (zoomResetBtn) {
        zoomResetBtn.addEventListener("click", () => {
            resetPreviewZoom();
        });
    }

    if (printBtn) {
        printBtn.addEventListener("click", () => {
            window.print();
        });
    }

    if (fullscreenBtn && previewModalCard) {
        fullscreenBtn.addEventListener("click", () => {
            const isFull = previewModalCard.classList.toggle("is-fullscreen");
            fullscreenBtn.innerHTML = isFull ? `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                <span>Thu Nhỏ</span>
            ` : `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                <span>Toàn Màn Hình</span>
            `;
        });
    }

    if (closePreviewBtn && previewModal) {
        closePreviewBtn.addEventListener("click", () => {
            previewModal.style.display = "none";
            if (previewModalCard) previewModalCard.classList.remove("is-fullscreen");
            const pdfIframe = document.getElementById("office-pdf-iframe");
            if (pdfIframe) pdfIframe.src = "";
        });
        previewModal.addEventListener("click", (e) => {
            if (e.target === previewModal) {
                previewModal.style.display = "none";
                if (previewModalCard) previewModalCard.classList.remove("is-fullscreen");
                const pdfIframe = document.getElementById("office-pdf-iframe");
                if (pdfIframe) pdfIframe.src = "";
            }
        });
    }

    // ==========================================================================
    // MODULE: AI ROLEPLAY - ELEGANT WHITE CHARACTER HUB & CHAT ARENA
    // Đọc & ghi Neon DB, hình minh họa 1:1, thẻ bài tinh tế, SSE Ollama streaming
    // ==========================================================================
    let roleplayCharacters = [];
    let activeRoleplayCharacter = null;
    let isRoleplayGenerating = false;
    let activeRoleplaySessionId = null;
    let currentRoleplayCategory = "all"; // 'all' | 'education' | 'anime' | 'trending'

    function getRoleplayApiBase() {
        if (typeof CONFIG !== "undefined" && typeof CONFIG.getApiBase === "function") {
            return CONFIG.getApiBase().replace(/\/+$/, "");
        }
        return "http://127.0.0.1:5000";
    }

    // Ảnh minh họa chất lượng cao đã lưu trữ trong img/characters/
    const LOCAL_CHARACTER_IMAGES = {
        "Futaba Igarashi": "img/characters/futaba.jpg",
        "Frieren": "img/characters/frieren.jpg",
        "English Teacher": "img/characters/english_teacher.jpg",
        "Edubot": "img/characters/edubot.jpg",
        "Aki Sorrel": "img/characters/aki_sorrel.jpg",
        "Teacher": "img/characters/teacher.jpg"
    };

    function getFallbackAvatar(name) {
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'AI')}&background=4f46e5&color=fff&size=256`;
    }

    function getCharacterImage(char) {
        if (!char) return getFallbackAvatar("AI");
        if (LOCAL_CHARACTER_IMAGES[char.character_name]) {
            return LOCAL_CHARACTER_IMAGES[char.character_name];
        }
        if (char.linkanh && (char.linkanh.startsWith("http://") || char.linkanh.startsWith("https://") || char.linkanh.startsWith("img/"))) {
            return char.linkanh;
        }
        return getFallbackAvatar(char.character_name);
    }

    function getCharacterCategory(char) {
        if (!char) return "general";
        const name = (char.character_name || "").toLowerCase();
        const content = (char.content || "").toLowerCase();
        const persona = (char.persona || "").toLowerCase();

        if (name.includes("teacher") || name.includes("edubot") || content.includes("giáo") || persona.includes("học sinh") || persona.includes("giáo viên") || persona.includes("toán") || persona.includes("tiếng anh") || persona.includes("english")) {
            return "education";
        }
        if (name.includes("futaba") || name.includes("frieren") || name.includes("aki") || persona.includes("anime") || persona.includes("manga") || persona.includes("ma pháp") || persona.includes("senpai")) {
            return "anime";
        }
        return "general";
    }

    // View Panes
    const roleplayViewHub = document.getElementById("roleplay-view-hub");
    const roleplayViewChat = document.getElementById("roleplay-view-chat");

    // Hub Controls
    const roleplayHeroCount = document.getElementById("roleplay-hero-count");
    const roleplayBtnCreateChar = document.getElementById("roleplay-btn-create-char");
    const roleplayBtnRefreshChars = document.getElementById("roleplay-btn-refresh-chars");
    const roleplayCatPills = document.querySelectorAll(".roleplay-cat-pill");
    const countCatAll = document.getElementById("count-cat-all");
    const roleplayHubSearchInput = document.getElementById("roleplay-hub-search-input");
    const roleplayHubSortSelect = document.getElementById("roleplay-hub-sort-select");
    const roleplayCardsGrid = document.getElementById("roleplay-cards-grid");

    // Chat Arena Controls
    const roleplayChatBackBtn = document.getElementById("roleplay-chat-back-btn");
    const activeCharAvatar = document.getElementById("active-char-avatar");
    const activeCharName = document.getElementById("active-char-name");
    const activeCharBadge = document.getElementById("active-char-badge");
    const activeCharDesc = document.getElementById("active-char-desc");
    const roleplayModelSelect = document.getElementById("roleplay-model-select");

    const roleplayToggleParamsBtn = document.getElementById("roleplay-toggle-params-btn");
    const roleplayParamsDrawer = document.getElementById("roleplay-params-drawer");
    const roleplayParamTemp = document.getElementById("roleplay-param-temp");
    const roleplayParamRep = document.getElementById("roleplay-param-rep");
    const roleplayParamMinp = document.getElementById("roleplay-param-minp");
    const roleplayParamReplast = document.getElementById("roleplay-param-replast");
    const valTempDisplay = document.getElementById("val-temp-display");
    const valRepDisplay = document.getElementById("val-rep-display");
    const valMinpDisplay = document.getElementById("val-minp-display");
    const valReplastDisplay = document.getElementById("val-replast-display");

    const roleplayToggleBioBtn = document.getElementById("roleplay-toggle-bio-btn");
    const roleplayBioDrawer = document.getElementById("roleplay-bio-drawer");
    const bioPersonaText = document.getElementById("bio-persona-text");
    const bioScenerioText = document.getElementById("bio-scenerio-text");
    const bioInstructionText = document.getElementById("bio-instruction-text");

    const roleplayResetChatBtn = document.getElementById("roleplay-reset-chat-btn");
    const roleplayMessagesContainer = document.getElementById("roleplay-messages-container");
    const roleplayUserInput = document.getElementById("roleplay-user-input");
    const roleplaySendBtn = document.getElementById("roleplay-send-btn");

    // Create Modal Elements
    const roleplayCreateModal = document.getElementById("roleplay-create-modal");
    const roleplayCloseCreateBtn = document.getElementById("roleplay-close-create-btn");
    const roleplayCancelCreateBtn = document.getElementById("roleplay-cancel-create-btn");
    const roleplayCreateForm = document.getElementById("roleplay-create-form");
    const createCharTemp = document.getElementById("create-char-temp");
    const createTempVal = document.getElementById("create-temp-val");
    const createCharRep = document.getElementById("create-char-rep");
    const createRepVal = document.getElementById("create-rep-val");

    // Lời thoại mở đầu đặc trưng chuẩn kịch bản
    const CHARACTER_GREETINGS = {
        "Futaba Igarashi": "*nhìn thấy bạn bước vào văn phòng, hơi giật mình rồi vội chỉnh lại xấp tài liệu trên bàn* Senpai... Anh lại tới muộn một chút đấy nhé! Đừng bảo là tối qua lại thức khuya chơi game nữa đấy? Hôm nay chúng ta có lịch đi gặp khách hàng, chuẩn bị nhanh lên nào!",
        "Frieren": "*ngồi thong thả bên bìa rừng, khẽ lật giở một trang sách cổ ma pháp ma thuật, đôi tai nhọn khẽ rung rinh* Lại gặp nhau rồi, người học việc của ta. Hôm nay cậu muốn ta chỉ dẫn ma pháp tấn công Zoltraak, hay chúng ta cùng đi tìm những ma pháp độc lạ bị lãng quên?",
        "English Teacher": "*smiles warmly and writes today's topic on the whiteboard* Hello there! Welcome to our English session. I'm Oscar, your English speaking partner. How was your day so far? Tell me one interesting thing that happened today!",
        "Edubot": "*mỉm cười thân thiện với ánh mắt sáng ngời* Chào bạn! Tôi là Edubot - gia sư AI đồng hành cùng bạn. Bất kể là toán học, khoa học, lập trình hay các khái niệm phức tạp, hãy chia sẻ chủ đề bạn muốn khám phá hôm nay nhé!",
        "Aki Sorrel": "*bối rối ôm chặt hộp cơm bento nhỏ trong tay, mái tóc pastel khẽ lay động khi ngẩng đầu lên nhìn bạn đầy ngập ngừng* Chào... chào bạn... Chỗ này còn trống không? Mình... mình có thể ngồi cùng bạn một chút được không?...",
        "Teacher": "*gõ nhẹ viên phấn lên bảng, mỉm cười đôn hậu và ấm áp* Chào em! Hôm nay phần lập trình, cấu trúc dữ liệu hay thuật toán có điểm nào em đang gặp khó khăn không? Cứ thoải mái trao đổi, thầy sẽ cùng em bóc tách từng bước!"
    };

    function switchToHubView() {
        if (roleplayViewChat) roleplayViewChat.style.display = "none";
        if (roleplayViewHub) roleplayViewHub.style.display = "flex";
    }

    function switchToChatView(char) {
        if (!char) return;
        if (roleplayViewHub) roleplayViewHub.style.display = "none";
        if (roleplayViewChat) roleplayViewChat.style.display = "flex";
        selectRoleplayCharacter(char);
    }

    async function loadRoleplayCharacters(forceRefresh = false) {
        if (!roleplayCardsGrid) return;
        if (forceRefresh) {
            roleplayCardsGrid.innerHTML = `
                <div class="roleplay-grid-loading">
                    <div class="spinner-sm"></div>
                    <span>Đang nạp các nhân vật từ Neon DB...</span>
                </div>
            `;
        }

        try {
            const endpoint = `/api/roleplay/characters${forceRefresh ? '?refresh=true' : ''}`;
            const res = await fetchApiWithFallback(endpoint);
            const data = await res.json();

            if (data.success && Array.isArray(data.characters)) {
                roleplayCharacters = data.characters;
                applyRoleplayFiltersAndSort();
                
                // Khôi phục nhân vật active nếu đang mở chat
                if (activeRoleplayCharacter) {
                    const refreshed = roleplayCharacters.find(c => c.character_name === activeRoleplayCharacter.character_name);
                    if (refreshed) activeRoleplayCharacter = refreshed;
                }
            } else {
                roleplayCardsGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; color: var(--danger); text-align: center;">Không thể tải nhân vật: ${escapeHtml(data.error || 'Lỗi không xác định')}</div>`;
            }
        } catch (e) {
            console.warn("[Roleplay] Lỗi kết nối tải nhân vật:", e);
            roleplayCardsGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; color: var(--text-muted); text-align: center;">Chưa thể kết nối tới Neon DB. Vui lòng kiểm tra lại server (${escapeHtml(e.message || 'Lỗi kết nối')}).</div>`;
        }
    }

    function applyRoleplayFiltersAndSort() {
        if (!roleplayCardsGrid) return;
        let list = [...roleplayCharacters];

        // Cập nhật số lượng tổng
        if (countCatAll) countCatAll.textContent = roleplayCharacters.length;
        if (roleplayHeroCount) roleplayHeroCount.textContent = roleplayCharacters.length;

        // 1. Lọc theo Search Query
        const query = (roleplayHubSearchInput ? roleplayHubSearchInput.value : "").toLowerCase().trim();
        if (query) {
            list = list.filter(c => 
                (c.character_name && c.character_name.toLowerCase().includes(query)) ||
                (c.content && c.content.toLowerCase().includes(query)) ||
                (c.persona && c.persona.toLowerCase().includes(query)) ||
                (c.scenerio && c.scenerio.toLowerCase().includes(query))
            );
        }

        // 2. Lọc theo Danh mục (Category Pill)
        if (currentRoleplayCategory === "education") {
            list = list.filter(c => getCharacterCategory(c) === "education");
        } else if (currentRoleplayCategory === "anime") {
            list = list.filter(c => getCharacterCategory(c) === "anime");
        } else if (currentRoleplayCategory === "trending") {
            list.sort((a, b) => (parseFloat(b.temperature || 1.0) - parseFloat(a.temperature || 1.0)));
        }

        // 3. Sắp xếp
        const sortBy = roleplayHubSortSelect ? roleplayHubSortSelect.value : "created";
        if (sortBy === "name") {
            list.sort((a, b) => (a.character_name || "").localeCompare(b.character_name || ""));
        } else if (sortBy === "temp") {
            list.sort((a, b) => (parseFloat(b.temperature || 1.0) - parseFloat(a.temperature || 1.0)));
        }

        renderRoleplayCards(list);
    }

    function renderRoleplayCards(characters) {
        if (!roleplayCardsGrid) return;
        if (!characters || characters.length === 0) {
            roleplayCardsGrid.innerHTML = `
                <div style="grid-column: 1/-1; padding: 60px 20px; text-align: center; color: var(--text-muted, #64748b);">
                    <div style="font-size: 2.6rem; margin-bottom: 12px;">🔍</div>
                    <h3 style="color: var(--text-primary, #0f172a); margin-bottom: 6px; font-weight: 700;">Không tìm thấy nhân vật phù hợp</h3>
                    <p style="font-size: 0.88rem; max-width: 460px; margin: 0 auto;">Hãy thử tìm kiếm với từ khóa khác, chọn danh mục "Tất Cả" hoặc nhấn "Tạo Nhân Vật Mới" để thêm vào hệ thống.</p>
                </div>
            `;
            return;
        }

        roleplayCardsGrid.innerHTML = "";
        characters.forEach(c => {
            const card = document.createElement("div");
            card.className = "roleplay-char-card";
            card.setAttribute("data-name", c.character_name);

            const imgSrc = getCharacterImage(c);
            const tagline = (c.content && c.content !== "1") ? c.content : (c.scenerio ? c.scenerio.substring(0, 95) + "..." : "Nhân vật AI đồng hành cùng bạn.");
            const tempVal = c.temperature || 1.0;
            const author = c.creator || "system";
            const cat = getCharacterCategory(c);
            const catBadgeText = cat === "education" ? "🎓 Giáo Dục" : (cat === "anime" ? "🌸 Anime" : "🎭 Nhập Vai");

            card.innerHTML = `
                <div class="roleplay-card-cover">
                    <img class="roleplay-card-img" src="${imgSrc}" alt="${escapeHtml(c.character_name)}" referrerpolicy="no-referrer" onerror="this.src='${getFallbackAvatar(c.character_name)}'">
                    <div class="roleplay-card-overlay-badge" title="Danh mục nhân vật">
                        <span class="badge-dot-live"></span>
                        <span>${catBadgeText}</span>
                    </div>
                    <div class="roleplay-card-temp-badge" title="Nhiệt độ sáng tạo (Temperature)">
                        <span>⚡ T: ${tempVal}</span>
                    </div>
                </div>
                <div class="roleplay-card-body">
                    <div class="roleplay-card-title-row">
                        <h4 class="roleplay-card-title" title="${escapeHtml(c.character_name)}">${escapeHtml(c.character_name)}</h4>
                    </div>
                    <div class="roleplay-card-author">
                        <span>by</span>
                        <span class="author-name">@${escapeHtml(author)}</span>
                    </div>
                    <p class="roleplay-card-tagline" title="${escapeHtml(tagline)}">${escapeHtml(tagline)}</p>
                </div>
                <div class="roleplay-card-footer">
                    <div class="roleplay-card-chat-hint" title="Sẵn sàng đàm thoại trực tiếp">
                        <span>💬 Sẵn sàng</span>
                    </div>
                    <div class="roleplay-card-actions">
                        <button type="button" class="roleplay-card-btn-action" title="Bắt đầu trò chuyện với ${escapeHtml(c.character_name)}">
                            <span>Trò chuyện</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                        <button type="button" class="roleplay-card-btn-del" title="Xóa nhân vật khỏi Neon DB">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            `;

            // Bấm vào thẻ để mở Chat Arena
            card.addEventListener("click", (e) => {
                // Nếu bấm nút xóa
                if (e.target.closest(".roleplay-card-btn-del")) {
                    e.stopPropagation();
                    if (confirm(`Bạn có chắc chắn muốn xóa nhân vật "${c.character_name}" khỏi Neon DB?`)) {
                        deleteRoleplayCharacter(c.character_name);
                    }
                    return;
                }
                switchToChatView(c);
            });

            roleplayCardsGrid.appendChild(card);
        });
    }

    async function deleteRoleplayCharacter(charName) {
        try {
            const endpoint = `/api/roleplay/characters/${encodeURIComponent(charName)}`;
            const res = await fetchApiWithFallback(endpoint, {
                method: "DELETE"
            });
            const data = await res.json();
            if (data.success) {
                alert(`Đã xóa thành công nhân vật "${charName}".`);
                localStorage.removeItem(getRoleplayHistoryKey(charName));
                loadRoleplayCharacters(true);
            } else {
                alert(`Không thể xóa nhân vật: ${data.error || 'Lỗi server'}`);
            }
        } catch (e) {
            console.error("[Roleplay] Lỗi khi xóa nhân vật:", e);
            alert(`Lỗi kết nối khi xóa nhân vật: ${e.message || 'Lỗi kết nối'}`);
        }
    }

    function selectRoleplayCharacter(char) {
        if (!char) return;
        activeRoleplayCharacter = char;
        localStorage.setItem("HPU2_LAST_ROLEPLAY_CHAR", char.character_name);

        // Cập nhật Header Arena
        if (activeCharAvatar) {
            activeCharAvatar.src = getCharacterImage(char);
            activeCharAvatar.onerror = () => { activeCharAvatar.src = getFallbackAvatar(char.character_name); };
        }
        if (activeCharName) activeCharName.textContent = char.character_name;
        if (activeCharBadge) {
            const cat = getCharacterCategory(char);
            activeCharBadge.textContent = cat === "education" ? "🎓 Giáo Dục" : (cat === "anime" ? "🌸 Anime" : "🎭 Nhập Vai");
        }
        if (activeCharDesc) activeCharDesc.textContent = char.scenerio ? char.scenerio.substring(0, 95) + "..." : "Sẵn sàng tương tác đàm thoại";

        // Cập nhật giá trị thông số trong Parameters Drawer
        const temp = char.temperature || 1.0;
        const rep = char.repeat_penalty || 1.1;
        const minp = char.min_p || 0.1;
        const replast = char.repeat_last_n || 128;

        if (roleplayParamTemp) roleplayParamTemp.value = temp;
        if (valTempDisplay) valTempDisplay.textContent = temp;

        if (roleplayParamRep) roleplayParamRep.value = rep;
        if (valRepDisplay) valRepDisplay.textContent = rep;

        if (roleplayParamMinp) roleplayParamMinp.value = minp;
        if (valMinpDisplay) valMinpDisplay.textContent = minp;

        if (roleplayParamReplast) roleplayParamReplast.value = replast;
        if (valReplastDisplay) valReplastDisplay.textContent = replast;

        // Cập nhật thông tin trong Bio Drawer
        if (bioPersonaText) bioPersonaText.textContent = char.persona || "Chưa có thông tin tính cách chi tiết.";
        if (bioScenerioText) bioScenerioText.textContent = char.scenerio || "Chưa có kịch bản cụ thể.";
        if (bioInstructionText) bioInstructionText.textContent = char.character_instruction || "Nhập vai tự nhiên.";

        // Khởi tạo phiên session ID
        activeRoleplaySessionId = `roleplay_${char.character_name.replace(/\s+/g, '_')}_${Date.now()}`;

        // Nạp lịch sử tin nhắn
        renderRoleplayHistory(char);
    }

    function getRoleplayHistoryKey(charName) {
        return `HPU2_ROLEPLAY_HISTORY_${charName}`;
    }

    function getStoredRoleplayMessages(charName) {
        try {
            const raw = localStorage.getItem(getRoleplayHistoryKey(charName));
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return null;
    }

    function saveStoredRoleplayMessages(charName, messages) {
        try {
            localStorage.setItem(getRoleplayHistoryKey(charName), JSON.stringify(messages));
        } catch (e) {}
    }

    function renderRoleplayHistory(char) {
        if (!roleplayMessagesContainer) return;
        roleplayMessagesContainer.innerHTML = "";

        let messages = getStoredRoleplayMessages(char.character_name);
        if (!messages || messages.length === 0) {
            // Khởi tạo lời chào mở đầu chuẩn kịch bản nhân vật
            const initialGreeting = CHARACTER_GREETINGS[char.character_name] || 
                `*mỉm cười nhìn bạn và gật đầu nhẹ* Chào bạn! Mình là ${char.character_name}. Rất vui được gặp bạn hôm nay, chúng ta cùng trò chuyện nhé!`;
            
            messages = [
                {
                    role: "assistant",
                    content: initialGreeting,
                    timestamp: Date.now()
                }
            ];
            saveStoredRoleplayMessages(char.character_name, messages);
        }

        messages.forEach(msg => {
            appendRoleplayMessageDOM(msg.role, msg.content, char);
        });

        scrollRoleplayFeedToBottom();
    }

    function appendRoleplayMessageDOM(role, content, char) {
        if (!roleplayMessagesContainer) return;
        const row = document.createElement("div");
        row.className = `roleplay-msg-row ${role}`;

        if (role === "assistant") {
            const avatarSrc = getCharacterImage(char);
            const avatarEl = document.createElement("img");
            avatarEl.className = "roleplay-msg-avatar";
            avatarEl.src = avatarSrc;
            avatarEl.onerror = () => { avatarEl.src = getFallbackAvatar(char ? char.character_name : "AI"); };
            row.appendChild(avatarEl);

            const bubble = document.createElement("div");
            bubble.className = "roleplay-char-bubble";
            renderRichContent(content, bubble);
            row.appendChild(bubble);
        } else {
            const bubble = document.createElement("div");
            bubble.className = "roleplay-user-bubble";
            bubble.innerHTML = `<p>${escapeHtml(content)}</p>`;
            row.appendChild(bubble);
        }

        roleplayMessagesContainer.appendChild(row);
    }

    function scrollRoleplayFeedToBottom() {
        if (roleplayMessagesContainer) {
            roleplayMessagesContainer.scrollTop = roleplayMessagesContainer.scrollHeight;
        }
    }

    async function sendRoleplayMessage() {
        if (!activeRoleplayCharacter || isRoleplayGenerating) return;
        const text = (roleplayUserInput.value || "").trim();
        if (!text) return;

        roleplayUserInput.value = "";
        roleplayUserInput.style.height = "auto";

        // 1. Thêm tin nhắn của User
        appendRoleplayMessageDOM("user", text, activeRoleplayCharacter);
        scrollRoleplayFeedToBottom();

        // Cập nhật lịch sử cục bộ
        let history = getStoredRoleplayMessages(activeRoleplayCharacter.character_name) || [];
        history.push({ role: "user", content: text, timestamp: Date.now() });
        saveStoredRoleplayMessages(activeRoleplayCharacter.character_name, history);

        // 2. Tạo placeholder bong bóng của Assistant kèm typing indicator
        const char = activeRoleplayCharacter;
        const row = document.createElement("div");
        row.className = "roleplay-msg-row assistant";
        row.id = "active-roleplay-row";

        const avatarSrc = getCharacterImage(char);
        const avatarEl = document.createElement("img");
        avatarEl.className = "roleplay-msg-avatar";
        avatarEl.src = avatarSrc;
        avatarEl.onerror = () => { avatarEl.src = getFallbackAvatar(char.character_name); };
        row.appendChild(avatarEl);

        const bubble = document.createElement("div");
        bubble.className = "roleplay-char-bubble";
        bubble.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 0.88rem;">
                <div class="spinner-sm"></div>
                <span>*${escapeHtml(char.character_name)} đang suy nghĩ và chuẩn bị lời thoại...*</span>
            </div>
        `;
        row.appendChild(bubble);
        roleplayMessagesContainer.appendChild(row);
        scrollRoleplayFeedToBottom();

        // 3. Khóa trạng thái input
        isRoleplayGenerating = true;
        if (roleplaySendBtn) roleplaySendBtn.disabled = true;

        // Chuẩn bị payload
        const historySlice = history.slice(-10).map(m => ({ role: m.role, content: m.content }));
        if (historySlice.length > 0 && historySlice[historySlice.length - 1].role === "user") {
            historySlice.pop();
        }

        const modelId = roleplayModelSelect ? roleplayModelSelect.value : "qwen2.5:14b";
        const customOptions = {
            temperature: parseFloat(roleplayParamTemp ? roleplayParamTemp.value : 1.0),
            repeat_penalty: parseFloat(roleplayParamRep ? roleplayParamRep.value : 1.1),
            min_p: parseFloat(roleplayParamMinp ? roleplayParamMinp.value : 0.1),
            repeat_last_n: parseInt(roleplayParamReplast ? roleplayParamReplast.value : 128)
        };

        const username = (currentUser && currentUser.username) ? currentUser.username : "user";

        const payload = {
            character_name: char.character_name,
            message: text,
            history: historySlice,
            model: modelId,
            custom_options: customOptions,
            session_id: activeRoleplaySessionId,
            username: username
        };

        let aiReplyText = "";
        let hasStartedStreaming = false;

        try {
            const base = getRoleplayApiBase();
            const response = await fetch(`${base}/api/roleplay/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-User-Name": username,
                    "X-User-Role": currentUser?.role || "user"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({}));
                throw new Error(errJson.error || `Lỗi HTTP ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const rawData = line.substring(6).trim();
                        if (!rawData) continue;
                        try {
                            const parsed = JSON.parse(rawData);
                            if (parsed.type === "token") {
                                if (!hasStartedStreaming) {
                                    hasStartedStreaming = true;
                                    bubble.innerHTML = "";
                                }
                                aiReplyText += parsed.content;
                                renderRichContent(aiReplyText, bubble);
                                scrollRoleplayFeedToBottom();
                            } else if (parsed.type === "done") {
                                // Hoàn thành sinh token
                            }
                        } catch (parseErr) {
                            console.warn("[Roleplay SSE Parse Error]", parseErr, rawData);
                        }
                    }
                }
            }

            if (!aiReplyText) {
                aiReplyText = "*mỉm cười im lặng nhìn bạn*";
                renderRichContent(aiReplyText, bubble);
            }

            // Lưu phản hồi Assistant vào LocalStorage
            history.push({ role: "assistant", content: aiReplyText, timestamp: Date.now() });
            saveStoredRoleplayMessages(char.character_name, history);

        } catch (fetchErr) {
            console.error("[Roleplay Chat Error]", fetchErr);
            bubble.innerHTML = `<span style="color: var(--danger);">[Lỗi đàm thoại: ${escapeHtml(fetchErr.message || 'Không thể kết nối máy chủ')}]</span>`;
        } finally {
            isRoleplayGenerating = false;
            row.removeAttribute("id");
            if (roleplaySendBtn) roleplaySendBtn.disabled = false;
            if (roleplayUserInput) roleplayUserInput.focus();
        }
    }

    function initRoleplay() {
        // Tải danh sách nhân vật
        loadRoleplayCharacters();

        // Category pills click handler
        if (roleplayCatPills) {
            roleplayCatPills.forEach(pill => {
                pill.addEventListener("click", () => {
                    roleplayCatPills.forEach(p => p.classList.remove("active"));
                    pill.classList.add("active");
                    currentRoleplayCategory = pill.getAttribute("data-category") || "all";
                    applyRoleplayFiltersAndSort();
                });
            });
        }

        // Hub Search Input
        if (roleplayHubSearchInput) {
            roleplayHubSearchInput.addEventListener("input", () => {
                applyRoleplayFiltersAndSort();
            });
        }

        // Hub Sort Select
        if (roleplayHubSortSelect) {
            roleplayHubSortSelect.addEventListener("change", () => {
                applyRoleplayFiltersAndSort();
            });
        }

        // Refresh Button
        if (roleplayBtnRefreshChars) {
            roleplayBtnRefreshChars.addEventListener("click", () => {
                loadRoleplayCharacters(true);
            });
        }

        // Create Button
        if (roleplayBtnCreateChar) {
            roleplayBtnCreateChar.addEventListener("click", () => {
                if (roleplayCreateModal) roleplayCreateModal.style.display = "flex";
            });
        }

        // Arena Back Button
        if (roleplayChatBackBtn) {
            roleplayChatBackBtn.addEventListener("click", () => {
                switchToHubView();
            });
        }

        // Create Modal Events
        if (roleplayCloseCreateBtn) {
            roleplayCloseCreateBtn.addEventListener("click", () => {
                if (roleplayCreateModal) roleplayCreateModal.style.display = "none";
            });
        }
        if (roleplayCancelCreateBtn) {
            roleplayCancelCreateBtn.addEventListener("click", () => {
                if (roleplayCreateModal) roleplayCreateModal.style.display = "none";
            });
        }
        if (roleplayCreateModal) {
            roleplayCreateModal.addEventListener("click", (e) => {
                if (e.target === roleplayCreateModal) {
                    roleplayCreateModal.style.display = "none";
                }
            });
        }

        if (createCharTemp && createTempVal) {
            createCharTemp.addEventListener("input", (e) => {
                createTempVal.textContent = e.target.value;
            });
        }
        if (createCharRep && createRepVal) {
            createCharRep.addEventListener("input", (e) => {
                createRepVal.textContent = e.target.value;
            });
        }

        if (roleplayCreateForm) {
            roleplayCreateForm.addEventListener("submit", async (e) => {
                e.preventDefault();
                const nameInput = document.getElementById("create-char-name");
                const contentInput = document.getElementById("create-char-content");
                const imageInput = document.getElementById("create-char-image");
                const personaInput = document.getElementById("create-char-persona");
                const scenarioInput = document.getElementById("create-char-scenario");
                const instructionInput = document.getElementById("create-char-instruction");

                const name = nameInput ? nameInput.value.trim() : "";
                const content = contentInput ? contentInput.value.trim() : "";
                const image = imageInput ? imageInput.value.trim() : "";
                const persona = personaInput ? personaInput.value.trim() : "";
                const scenario = scenarioInput ? scenarioInput.value.trim() : "";
                const instruction = instructionInput ? instructionInput.value.trim() : "";
                const temp = parseFloat(createCharTemp ? createCharTemp.value : 1.0);
                const rep = parseFloat(createCharRep ? createCharRep.value : 1.1);

                if (!name || !content || !persona) {
                    alert("Vui lòng điền đầy đủ các mục bắt buộc (*)");
                    return;
                }

                const payload = {
                    character_name: name,
                    content: content,
                    linkanh: image || getFallbackAvatar(name),
                    persona: persona,
                    scenerio: scenario || "Cuộc trò chuyện giữa người dùng và nhân vật.",
                    character_instruction: instruction || "Text transcript of a conversation. Gestures written between asterisks.",
                    temperature: temp || 1.0,
                    repeat_penalty: rep || 1.1,
                    min_p: 0.1,
                    repeat_last_n: 128
                };

                const submitBtn = document.getElementById("roleplay-submit-create-btn");
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = "Đang lưu Neon DB...";
                }

                try {
                    const res = await fetchApiWithFallback("/api/roleplay/characters", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();
                    if (data.success) {
                        alert(`Nhân vật "${name}" đã được lưu thành công vào Neon DB!`);
                        roleplayCreateForm.reset();
                        if (roleplayCreateModal) roleplayCreateModal.style.display = "none";
                        await loadRoleplayCharacters(true);
                        switchToChatView(payload);
                    } else {
                        alert(`Lỗi khi tạo nhân vật: ${data.error || 'Lỗi server'}`);
                    }
                } catch (err) {
                    console.error("[Roleplay] Lỗi tạo nhân vật:", err);
                    alert(`Không thể kết nối đến server để tạo nhân vật: ${err.message || 'Lỗi kết nối'}`);
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Lưu Vào Neon DB";
                    }
                }
            });
        }

        // Drawers toggle
        if (roleplayToggleParamsBtn && roleplayParamsDrawer) {
            roleplayToggleParamsBtn.addEventListener("click", () => {
                const isHidden = roleplayParamsDrawer.style.display === "none";
                roleplayParamsDrawer.style.display = isHidden ? "block" : "none";
                roleplayToggleParamsBtn.classList.toggle("active", isHidden);
            });
        }

        if (roleplayToggleBioBtn && roleplayBioDrawer) {
            roleplayToggleBioBtn.addEventListener("click", () => {
                const isHidden = roleplayBioDrawer.style.display === "none";
                roleplayBioDrawer.style.display = isHidden ? "block" : "none";
                roleplayToggleBioBtn.classList.toggle("active", isHidden);
            });
        }

        // Sliders live values update
        if (roleplayParamTemp && valTempDisplay) {
            roleplayParamTemp.addEventListener("input", (e) => {
                valTempDisplay.textContent = e.target.value;
            });
        }
        if (roleplayParamRep && valRepDisplay) {
            roleplayParamRep.addEventListener("input", (e) => {
                valRepDisplay.textContent = e.target.value;
            });
        }
        if (roleplayParamMinp && valMinpDisplay) {
            roleplayParamMinp.addEventListener("input", (e) => {
                valMinpDisplay.textContent = e.target.value;
            });
        }
        if (roleplayParamReplast && valReplastDisplay) {
            roleplayParamReplast.addEventListener("input", (e) => {
                valReplastDisplay.textContent = e.target.value;
            });
        }

        // Reset chat
        if (roleplayResetChatBtn) {
            roleplayResetChatBtn.addEventListener("click", () => {
                if (!activeRoleplayCharacter) return;
                if (confirm(`Bạn có chắc chắn muốn làm mới cuộc trò chuyện với ${activeRoleplayCharacter.character_name}?`)) {
                    localStorage.removeItem(getRoleplayHistoryKey(activeRoleplayCharacter.character_name));
                    renderRoleplayHistory(activeRoleplayCharacter);
                }
            });
        }

        // Input send handlers
        if (roleplaySendBtn) {
            roleplaySendBtn.addEventListener("click", () => {
                sendRoleplayMessage();
            });
        }

        if (roleplayUserInput) {
            roleplayUserInput.addEventListener("input", () => {
                roleplayUserInput.style.height = "auto";
                roleplayUserInput.style.height = Math.min(roleplayUserInput.scrollHeight, 140) + "px";
            });
            roleplayUserInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendRoleplayMessage();
                }
            });
        }
    }

    // ---------------------- MODEL SELECTORS GLOBAL SYNC ----------------------
    function updateAllModelSelectors(models, defaultModel = "qwen2.5:14b") {
        if (!models || !Array.isArray(models)) return;

        // 1. Direct Chat & RAG Chat dock dropdowns
        [selectModelDirect, selectModelRag].forEach(sel => {
            if (!sel) return;
            const currentVal = sel.value;
            sel.innerHTML = "";
            models.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id;
                opt.textContent = m.name;
                if (m.default || m.id === defaultModel) opt.selected = true;
                sel.appendChild(opt);
            });
            if (models.some(m => m.id === currentVal)) {
                sel.value = currentVal;
            }
        });

        // 2. OCR model select
        const ocrModelSelect = document.getElementById("ocr-model-select");
        if (ocrModelSelect) {
            const currentVal = ocrModelSelect.value;
            ocrModelSelect.innerHTML = "";
            models.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id;
                opt.textContent = m.name;
                if (m.default || m.id === defaultModel) opt.selected = true;
                ocrModelSelect.appendChild(opt);
            });
            if (models.some(m => m.id === currentVal)) {
                ocrModelSelect.value = currentVal;
            }
        }

        // 3. Roleplay model select
        const roleplayModelSelect = document.getElementById("roleplay-model-select");
        if (roleplayModelSelect) {
            const currentVal = roleplayModelSelect.value;
            roleplayModelSelect.innerHTML = "";
            models.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id;
                opt.textContent = m.name;
                if (m.default || m.id === defaultModel) opt.selected = true;
                roleplayModelSelect.appendChild(opt);
            });
            if (models.some(m => m.id === currentVal)) {
                roleplayModelSelect.value = currentVal;
            }
        }
    }

    // ---------------------- ADMIN MODEL MANAGEMENT (NEON DB) ----------------------
    let adminModelsInitialized = false;
    let allAdminModels = [];
    let detectedOllamaModels = [];

    function checkIsAdminUser() {
        return Boolean(currentUser && (currentUser.role === "admin" || (currentUser.username && currentUser.username.toLowerCase() === "admin")));
    }

    async function initAdminModels() {
        const isAdmin = checkIsAdminUser();
        const authNotice = document.getElementById("admin-auth-notice");
        if (authNotice) {
            authNotice.style.display = isAdmin ? "none" : "flex";
        }

        const quickLoginBtn = document.getElementById("admin-quick-login-btn");
        if (quickLoginBtn && !quickLoginBtn.dataset.bound) {
            quickLoginBtn.dataset.bound = "1";
            quickLoginBtn.addEventListener("click", async () => {
                try {
                    quickLoginBtn.disabled = true;
                    quickLoginBtn.innerHTML = "<span>⏳ Đang đăng nhập Admin...</span>";
                    const apiBase = CONFIG.getApiBase();
                    const res = await fetch(`${apiBase}/api/auth/login`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username: "admin", password: "1234567" })
                    });
                    const data = await res.json();
                    if (data.success && data.user) {
                        setCurrentUser(data.user);
                        if (authNotice) authNotice.style.display = "none";
                        await loadAdminModelsData();
                        await scanOllamaHost();
                        alert("Đã đăng nhập tài khoản Quản trị viên (Admin) thành công!");
                    } else {
                        alert("Đăng nhập Admin thất bại: " + (data.error || "Không rõ nguyên nhân"));
                    }
                } catch (err) {
                    console.error("[AdminLogin] Lỗi:", err);
                    alert("Lỗi kết nối khi đăng nhập: " + err.message);
                } finally {
                    quickLoginBtn.disabled = false;
                    quickLoginBtn.innerHTML = "<span>🔑 Đăng Nhập Nhanh Admin</span>";
                }
            });
        }

        const btnOpenAdd = document.getElementById("admin-btn-open-add-model");
        const btnScanOllama = document.getElementById("admin-btn-scan-ollama");
        const btnRefresh = document.getElementById("admin-btn-refresh-models");
        const btnQuickSync = document.getElementById("admin-btn-quick-sync");
        const searchInput = document.getElementById("admin-search-models");

        const addModal = document.getElementById("admin-add-model-modal");
        const closeModalBtn = document.getElementById("admin-close-model-modal-btn");
        const cancelModalBtn = document.getElementById("admin-cancel-model-modal-btn");
        const addForm = document.getElementById("admin-add-model-form");

        if (!adminModelsInitialized) {
            adminModelsInitialized = true;

            if (btnOpenAdd) {
                btnOpenAdd.addEventListener("click", () => {
                    if (!checkIsAdminUser()) {
                        alert("Vui lòng đăng nhập tài khoản Quản trị viên (Admin) để thêm mô hình mới vào hệ thống.");
                        return;
                    }
                    openAddModelModal();
                });
            }

            if (closeModalBtn) {
                closeModalBtn.addEventListener("click", () => {
                    if (addModal) addModal.style.display = "none";
                });
            }

            if (cancelModalBtn) {
                cancelModalBtn.addEventListener("click", () => {
                    if (addModal) addModal.style.display = "none";
                });
            }

            if (addModal) {
                addModal.addEventListener("click", (e) => {
                    if (e.target === addModal) addModal.style.display = "none";
                });
            }

            if (btnScanOllama) {
                btnScanOllama.addEventListener("click", () => {
                    scanOllamaHost();
                });
            }

            if (btnQuickSync) {
                btnQuickSync.addEventListener("click", () => {
                    scanOllamaHost();
                });
            }

            if (btnRefresh) {
                btnRefresh.addEventListener("click", () => {
                    loadAdminModelsData();
                });
            }

            if (searchInput) {
                searchInput.addEventListener("input", (e) => {
                    renderAdminModelsList(e.target.value);
                });
            }

            if (addForm) {
                addForm.addEventListener("submit", async (e) => {
                    e.preventDefault();
                    if (!checkIsAdminUser()) {
                        alert("Vui lòng đăng nhập tài khoản Quản trị viên (Admin) để lưu mô hình.");
                        return;
                    }
                    await handleSaveModelSubmit();
                });
            }
        }

        // Tải danh sách mô hình từ Neon DB & Quét máy chủ Ollama
        await loadAdminModelsData();
        await scanOllamaHost();
    }

    function openAddModelModal(prefillId = "", prefillName = "", isMultimodal = false) {
        const addModal = document.getElementById("admin-add-model-modal");
        const idInput = document.getElementById("admin-input-model-id");
        const nameInput = document.getElementById("admin-input-model-name");
        const mmChk = document.getElementById("admin-chk-multimodal");
        const defChk = document.getElementById("admin-chk-default");
        const descInput = document.getElementById("admin-input-model-desc");
        const modalTitle = document.getElementById("admin-model-modal-title");

        if (modalTitle) modalTitle.textContent = prefillId ? "Thêm Mô Hình Từ Ollama Vào Hệ Thống" : "Thêm Mô Hình LLM Mới Vào Hệ Thống";
        if (idInput) idInput.value = prefillId;
        if (nameInput) nameInput.value = prefillName || (prefillId ? `${prefillId.toUpperCase()} (Ollama)` : "");
        if (mmChk) mmChk.checked = isMultimodal;
        if (defChk) defChk.checked = false;
        if (descInput) descInput.value = "";

        if (addModal) addModal.style.display = "flex";
        if (nameInput && prefillId) nameInput.focus();
        else if (idInput) idInput.focus();
    }

    async function loadAdminModelsData() {
        const listContainer = document.getElementById("admin-models-list-container");
        if (listContainer) {
            listContainer.innerHTML = `<div class="admin-loading-placeholder">Đang tải danh sách mô hình từ Neon DB...</div>`;
        }

        try {
            const apiBase = CONFIG.getApiBase();
            const isAdmin = checkIsAdminUser();
            const url = isAdmin
                ? `${apiBase}/api/admin/models?username=${encodeURIComponent((currentUser && currentUser.username) || '')}&role=${encodeURIComponent((currentUser && currentUser.role) || '')}`
                : `${apiBase}/api/models`;
            const headers = isAdmin
                ? {
                    "X-User-Name": (currentUser && currentUser.username) || "",
                    "X-User-Role": (currentUser && currentUser.role) || ""
                  }
                : {};

            const res = await fetch(url, { headers });
            const data = await res.json();
            const modelsList = data.models || [];
            if (Array.isArray(modelsList)) {
                allAdminModels = modelsList;

                // Cập nhật thống kê
                const statTotal = document.getElementById("admin-stat-total-models");
                const statDefault = document.getElementById("admin-stat-default-model");
                const statMm = document.getElementById("admin-stat-multimodal-count");
                const countBadge = document.getElementById("admin-active-count-badge");

                if (statTotal) statTotal.textContent = allAdminModels.length;
                if (statDefault) {
                    const defModel = allAdminModels.find(m => m.default) || allAdminModels[0];
                    statDefault.textContent = defModel ? defModel.id : "Chưa chọn";
                    statDefault.title = defModel ? defModel.name : "";
                }
                if (statMm) statMm.textContent = allAdminModels.filter(m => m.multimodal).length;
                if (countBadge) countBadge.textContent = `${allAdminModels.length} mô hình`;

                renderAdminModelsList();
                if (typeof updateAllModelSelectors === "function") {
                    updateAllModelSelectors(allAdminModels, data.default_model);
                }
            } else {
                if (listContainer) {
                    listContainer.innerHTML = `<div class="admin-loading-placeholder" style="color:#ef4444;">Lỗi tải dữ liệu: ${data.error || 'Không xác định'}</div>`;
                }
            }
        } catch (err) {
            console.error("[AdminModels] Lỗi khi tải models:", err);
            if (listContainer) {
                listContainer.innerHTML = `<div class="admin-loading-placeholder" style="color:#ef4444;">Không thể kết nối đến server: ${err.message}</div>`;
            }
        }
    }

    function renderAdminModelsList(filterQuery = "") {
        const listContainer = document.getElementById("admin-models-list-container");
        if (!listContainer) return;

        const q = filterQuery.toLowerCase().trim();
        const filtered = allAdminModels.filter(m => 
            (m.name && m.name.toLowerCase().includes(q)) ||
            (m.id && m.id.toLowerCase().includes(q)) ||
            (m.description && m.description.toLowerCase().includes(q))
        );

        if (filtered.length === 0) {
            listContainer.innerHTML = `
                <div class="admin-loading-placeholder">
                    <p style="margin-bottom: 8px;">Không tìm thấy mô hình nào phù hợp.</p>
                    <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('admin-btn-open-add-model').click()">+ Thêm Mô Hình Mới</button>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = "";
        filtered.forEach(m => {
            const card = document.createElement("div");
            card.className = `admin-model-item-card ${m.default ? "is-default" : ""}`;

            const isMultimodal = m.multimodal;
            const isDefault = m.default;

            card.innerHTML = `
                <div class="model-item-left">
                    <div class="model-chip-icon">
                        ${isMultimodal ? "👁️" : "🤖"}
                    </div>
                    <div class="model-info-wrap">
                        <div class="model-name-row">
                            <span class="model-item-title">${escapeHtml(m.name)}</span>
                            <span class="model-tag-id">${escapeHtml(m.id)}</span>
                            ${isDefault ? '<span class="badge-default">⭐ MẶC ĐỊNH</span>' : ''}
                            ${isMultimodal ? '<span class="badge-vision">👁️ VISION</span>' : ''}
                        </div>
                        <p class="model-desc-text" title="${escapeHtml(m.description || 'Không có mô tả')}">
                            ${escapeHtml(m.description || 'Mô hình chuẩn hệ thống')}
                        </p>
                    </div>
                </div>
                <div class="model-item-actions">
                    ${!isDefault ? `
                        <button type="button" class="btn btn-outline btn-xs btn-set-default" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}" title="Đặt làm mô hình mặc định trên toàn hệ thống">
                            ⭐ Mặc định
                        </button>
                    ` : ''}
                    <button type="button" class="btn btn-outline btn-xs btn-del-model" style="color: #ef4444; border-color: #fca5a5;" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}" title="Xóa mô hình khỏi hệ thống">
                        🗑️ Xóa
                    </button>
                </div>
            `;

            // Bind action buttons
            const setDefBtn = card.querySelector(".btn-set-default");
            if (setDefBtn) {
                setDefBtn.addEventListener("click", () => {
                    if (!checkIsAdminUser()) {
                        alert("Vui lòng đăng nhập tài khoản Quản trị viên (Admin) để đổi mô hình mặc định.");
                        return;
                    }
                    handleSetDefaultModel(m.id, m.name);
                });
            }

            const delBtn = card.querySelector(".btn-del-model");
            if (delBtn) {
                delBtn.addEventListener("click", () => {
                    if (!checkIsAdminUser()) {
                        alert("Vui lòng đăng nhập tài khoản Quản trị viên (Admin) để xóa mô hình.");
                        return;
                    }
                    handleDeleteModel(m.id, m.name);
                });
            }

            listContainer.appendChild(card);
        });
    }

    async function scanOllamaHost() {
        const ollamaContainer = document.getElementById("admin-ollama-list-container");
        const statStatus = document.getElementById("admin-stat-ollama-status");
        const statUrl = document.getElementById("admin-stat-ollama-url");
        const countBadge = document.getElementById("admin-ollama-count-badge");

        if (!checkIsAdminUser()) {
            if (ollamaContainer) {
                ollamaContainer.innerHTML = `
                    <div class="admin-loading-placeholder" style="padding: 24px 16px;">
                        <p style="margin-bottom: 10px; font-weight: 500;">🔒 Quét máy chủ Ollama trực tiếp yêu cầu quyền Quản trị viên.</p>
                        <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('admin-quick-login-btn') && document.getElementById('admin-quick-login-btn').click()">
                            🔑 Đăng Nhập Nhanh Admin
                        </button>
                    </div>`;
            }
            if (statStatus) statStatus.innerHTML = `<span style="color:#f59e0b;">🔒 Cần Quyền Admin</span>`;
            if (statUrl) statUrl.textContent = "Yêu cầu quyền Admin";
            if (countBadge) countBadge.textContent = "Cần Admin";
            return;
        }

        if (ollamaContainer) {
            ollamaContainer.innerHTML = `<div class="admin-loading-placeholder">Đang quét các mô hình trên máy chủ Ollama...</div>`;
        }

        try {
            const apiBase = CONFIG.getApiBase();
            const res = await fetch(`${apiBase}/api/admin/models/ollama-scan?username=${encodeURIComponent(currentUser.username)}&role=${currentUser.role}`, {
                headers: {
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                }
            });
            const data = await res.json();
            if (data.success) {
                detectedOllamaModels = data.models || [];

                if (statStatus) {
                    if (data.online) {
                        statStatus.innerHTML = `<span style="color:#16a34a;">🟢 Hoạt Động</span>`;
                    } else {
                        statStatus.innerHTML = `<span style="color:#ef4444;">🔴 Ngoại Tuyến</span>`;
                    }
                }
                if (statUrl) statUrl.textContent = data.ollama_url || "Ollama Host";
                if (countBadge) countBadge.textContent = `${detectedOllamaModels.length} phát hiện`;

                renderOllamaList();
            } else {
                if (ollamaContainer) {
                    ollamaContainer.innerHTML = `<div class="admin-loading-placeholder" style="color:#ef4444;">Không thể quét Ollama: ${data.error || 'Lỗi server'}</div>`;
                }
            }
        } catch (err) {
            console.error("[AdminModels] Lỗi quét Ollama:", err);
            if (ollamaContainer) {
                ollamaContainer.innerHTML = `<div class="admin-loading-placeholder" style="color:#ef4444;">Không thể kết nối đến Ollama: ${err.message}</div>`;
            }
        }
    }

    function renderOllamaList() {
        const ollamaContainer = document.getElementById("admin-ollama-list-container");
        if (!ollamaContainer) return;

        if (detectedOllamaModels.length === 0) {
            ollamaContainer.innerHTML = `<div class="admin-loading-placeholder">Không tìm thấy mô hình nào trên máy chủ Ollama.</div>`;
            return;
        }

        ollamaContainer.innerHTML = "";
        const activeIds = new Set(allAdminModels.map(m => m.id.toLowerCase()));

        detectedOllamaModels.forEach(om => {
            const item = document.createElement("div");
            item.className = "admin-ollama-item";

            const isActive = activeIds.has(om.id.toLowerCase());

            item.innerHTML = `
                <div style="min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="ollama-tag-name">${escapeHtml(om.id)}</span>
                        <span class="ollama-size-badge">${escapeHtml(om.size)}</span>
                        ${om.multimodal ? '<span class="badge-vision" style="font-size: 0.65rem; padding: 1px 5px;">VISION</span>' : ''}
                    </div>
                </div>
                <div>
                    ${isActive ? `
                        <span style="font-size: 0.76rem; font-weight: 600; color: #16a34a; background: rgba(34, 197, 94, 0.1); padding: 3px 8px; border-radius: 999px;">✓ Đã kích hoạt</span>
                    ` : `
                        <button type="button" class="btn btn-outline btn-xs btn-quick-add" style="color: #0284c7; border-color: #38bdf8;" data-id="${escapeHtml(om.id)}" data-mm="${om.multimodal ? '1' : '0'}">
                            + Thêm vào web
                        </button>
                    `}
                </div>
            `;

            const addBtn = item.querySelector(".btn-quick-add");
            if (addBtn) {
                addBtn.addEventListener("click", () => {
                    if (!checkIsAdminUser()) {
                        alert("Vui lòng đăng nhập tài khoản Quản trị viên (Admin) để thêm mô hình.");
                        return;
                    }
                    openAddModelModal(om.id, `${om.id.toUpperCase()} (Ollama)`, om.multimodal);
                });
            }

            ollamaContainer.appendChild(item);
        });
    }

    async function handleSaveModelSubmit() {
        if (!checkIsAdminUser()) {
            alert("Bạn cần quyền Quản trị viên (Admin) để thêm mô hình.");
            return;
        }

        const idInput = document.getElementById("admin-input-model-id");
        const nameInput = document.getElementById("admin-input-model-name");
        const provSelect = document.getElementById("admin-select-provider");
        const mmChk = document.getElementById("admin-chk-multimodal");
        const defChk = document.getElementById("admin-chk-default");
        const descInput = document.getElementById("admin-input-model-desc");
        const submitBtn = document.getElementById("admin-submit-model-btn");
        const addModal = document.getElementById("admin-add-model-modal");

        const modelId = idInput ? idInput.value.trim() : "";
        const modelName = nameInput ? nameInput.value.trim() : "";
        const provider = provSelect ? provSelect.value : "ollama";
        const isMultimodal = mmChk ? mmChk.checked : false;
        const isDefault = defChk ? defChk.checked : false;
        const description = descInput ? descInput.value.trim() : "";

        if (!modelId || !modelName) {
            alert("Vui lòng điền đầy đủ Mã định danh và Tên hiển thị của mô hình.");
            return;
        }

        const payload = {
            id: modelId,
            name: modelName,
            provider: provider,
            multimodal: isMultimodal,
            is_default: isDefault,
            description: description
        };

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Đang lưu vào Neon DB...";
        }

        try {
            const apiBase = CONFIG.getApiBase();
            const res = await fetch(`${apiBase}/api/admin/models?username=${encodeURIComponent(currentUser.username)}&role=${currentUser.role}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                alert(`Mô hình "${modelName}" (${modelId}) đã được lưu thành công vào Neon DB!`);
                if (addModal) addModal.style.display = "none";
                const form = document.getElementById("admin-add-model-form");
                if (form) form.reset();
                await loadAdminModelsData();
                renderOllamaList();
            } else {
                alert(`Lỗi khi lưu mô hình: ${data.error || 'Lỗi server'}`);
            }
        } catch (err) {
            console.error("[AdminModels] Lỗi thêm mô hình:", err);
            alert(`Không thể kết nối đến server: ${err.message}`);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Lưu Vào Neon DB & Kích Hoạt";
            }
        }
    }

    async function handleDeleteModel(modelId, modelName) {
        if (!checkIsAdminUser()) {
            alert("Bạn cần quyền Quản trị viên (Admin) để xóa mô hình.");
            return;
        }

        if (!confirm(`Bạn có chắc chắn muốn xóa mô hình "${modelName}" (${modelId}) khỏi toàn bộ hệ thống?\n\nNgười dùng trên web sẽ không thể chọn mô hình này nữa.`)) {
            return;
        }

        try {
            const apiBase = CONFIG.getApiBase();
            const res = await fetch(`${apiBase}/api/admin/models/${encodeURIComponent(modelId)}?username=${encodeURIComponent(currentUser.username)}&role=${currentUser.role}`, {
                method: "DELETE",
                headers: {
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                }
            });
            const data = await res.json();
            if (data.success) {
                alert(`Đã xóa mô hình "${modelName}" thành công khỏi Neon DB!`);
                await loadAdminModelsData();
                renderOllamaList();
            } else {
                alert(`Lỗi khi xóa mô hình: ${data.error || 'Lỗi server'}`);
            }
        } catch (err) {
            console.error("[AdminModels] Lỗi xóa model:", err);
            alert(`Không thể kết nối đến server: ${err.message}`);
        }
    }

    async function handleSetDefaultModel(modelId, modelName) {
        if (!checkIsAdminUser()) {
            alert("Bạn cần quyền Quản trị viên (Admin) để đổi mô hình mặc định.");
            return;
        }

        try {
            const apiBase = CONFIG.getApiBase();
            const res = await fetch(`${apiBase}/api/admin/models/set-default?username=${encodeURIComponent(currentUser.username)}&role=${currentUser.role}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-User-Name": currentUser.username,
                    "X-User-Role": currentUser.role
                },
                body: JSON.stringify({ id: modelId })
            });
            const data = await res.json();
            if (data.success) {
                alert(`Đã đặt "${modelName}" (${modelId}) làm mô hình mặc định trên toàn hệ thống!`);
                await loadAdminModelsData();
            } else {
                alert(`Lỗi: ${data.error || 'Không thể đặt mặc định'}`);
            }
        } catch (err) {
            console.error("[AdminModels] Lỗi đặt mặc định:", err);
            alert(`Lỗi kết nối: ${err.message}`);
        }
    }

    // ---------------------- KHỞI CHẠY LẦN ĐẦU ----------------------
    updateUserUI();
    loadConfig();
    loadDocumentsList();
    loadHistorySessions();
    initOfficeStudio();



    // =========================================================================
    // AI PLAYGROUND: STABLE DIFFUSION 1.5 IMAGE STUDIO LOGIC
    // =========================================================================
    let currentSdStyle = "none";
    let currentSdWidth = 512;
    let currentSdHeight = 512;
    let lastGeneratedSeed = null;

    const SAMPLE_SD_PROMPTS = [
        "Một chú phi hành gia mèo đáng yêu đang lơ lửng ngắm Trái Đất trong không gian vũ trụ, ánh sao lấp lánh, phong cách anime rực rỡ, 8k",
        "A futuristic cyberpunk Vietnamese street food stall at night, glowing neon signs, rain reflections on asphalt, highly detailed, cinematic lighting",
        "Lâu đài cổ tích trên mây bồng bềnh, thác nước đổ xuống không trung, cầu vồng rực rỡ phong cách anime Makoto Shinkai, studio ghibli",
        "Chân dung một cô gái Việt Nam mặc áo dài trắng truyền thống đứng bên hồ sen mùa hạ, ánh nắng dịu dàng, ảnh chụp chân dung dslr 8k",
        "A majestic dragon perched on a mountain peak, storm clouds, lightning, dramatic cinematic lighting, 8k concept art, Artstation trending",
        "Robot cổ điển phong cách steampunk bằng đồng thau đang đọc sách trong thư viện cổ ngập tràn ánh nắng vàng ấm áp",
        "Thành phố dưới đáy đại dương rực rỡ san hô phát sáng, cá voi khổng lồ bơi qua các tháp kính pha lê, phong cách digital 3d Unreal Engine",
        "Một tách cà phê nóng tỏa khói bốc lên hình trái tim trên bàn gỗ bên cửa sổ ngắm mưa rơi, không khí ấm cúng, ảnh chụp macro dslr"
    ];

    function initImageStudio() {
        const sdModelSelect = document.getElementById("sd-model-select");
        const sdPromptInput = document.getElementById("sd-prompt-input");
        const sdEnhanceCheck = document.getElementById("sd-enhance-prompt-check");
        const sdStylePills = document.querySelectorAll(".sd-style-pill");
        const sdRatioBtns = document.querySelectorAll(".sd-ratio-btn");
        const sdToggleAdvancedBtn = document.getElementById("sd-toggle-advanced-btn");
        const sdAdvancedPanel = document.getElementById("sd-advanced-panel");
        const sdNegPromptInput = document.getElementById("sd-neg-prompt");
        const sdStepsSlider = document.getElementById("sd-steps-slider");
        const sdStepsVal = document.getElementById("sd-steps-val");
        const sdCfgSlider = document.getElementById("sd-cfg-slider");
        const sdCfgVal = document.getElementById("sd-cfg-val");
        const sdSeedInput = document.getElementById("sd-seed-input");
        const sdGenerateBtn = document.getElementById("sd-generate-btn");
        const sdSampleBtn = document.getElementById("sd-btn-sample-prompt");
        const sdEmptyState = document.getElementById("sd-empty-state");
        const sdLoadingState = document.getElementById("sd-loading-state");
        const sdResultState = document.getElementById("sd-result-state");
        const sdResultImg = document.getElementById("sd-result-img");
        const sdDownloadBtn = document.getElementById("sd-download-btn");
        const sdReuseSeedBtn = document.getElementById("sd-reuse-seed-btn");
        const sdMetaTime = document.getElementById("sd-meta-time");
        const sdMetaSize = document.getElementById("sd-meta-size");
        const sdMetaSeed = document.getElementById("sd-meta-seed");
        const sdPromptUsedBox = document.getElementById("sd-prompt-used-box");
        const sdPromptUsedText = document.getElementById("sd-prompt-used-text");
        const sdStyleBadge = document.getElementById("sd-style-badge");
        const sdHistoryGrid = document.getElementById("sd-history-grid");
        const sdHistoryCount = document.getElementById("sd-history-count");
        const sdRefreshHistoryBtn = document.getElementById("sd-refresh-history-btn");
        const sdGpuBadge = document.getElementById("sd-gpu-badge");

        // Model & GPU Status Card Elements
        const sdStatusDot = document.getElementById("sd-status-dot");
        const sdStatusTitle = document.getElementById("sd-status-title");
        const sdStatusText = document.getElementById("sd-status-text");
        const sdBtnLoadModel = document.getElementById("sd-btn-load-model");
        const sdBtnUnloadModel = document.getElementById("sd-btn-unload-model");
        const sdDownloadProgressContainer = document.getElementById("sd-download-progress-container");
        const sdProgressFile = document.getElementById("sd-progress-file");
        const sdProgressPct = document.getElementById("sd-progress-pct");
        const sdProgressBarFill = document.getElementById("sd-progress-bar-fill");
        const sdProgressSize = document.getElementById("sd-progress-size");
        const sdProgressSpeed = document.getElementById("sd-progress-speed");
        const sdProgressEta = document.getElementById("sd-progress-eta");

        let sdPollTimer = null;

        // 1. Style Pills Handler
        sdStylePills.forEach(pill => {
            pill.addEventListener("click", () => {
                sdStylePills.forEach(p => p.classList.remove("active"));
                pill.classList.add("active");
                currentSdStyle = pill.getAttribute("data-style") || "none";
            });
        });

        // 2. Aspect Ratio Buttons Handler
        sdRatioBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                sdRatioBtns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                currentSdWidth = parseInt(btn.getAttribute("data-width") || 512);
                currentSdHeight = parseInt(btn.getAttribute("data-height") || 512);
            });
        });

        // 3. Toggle Advanced Panel
        if (sdToggleAdvancedBtn && sdAdvancedPanel) {
            sdToggleAdvancedBtn.addEventListener("click", () => {
                const isHidden = sdAdvancedPanel.style.display === "none";
                sdAdvancedPanel.style.display = isHidden ? "block" : "none";
                const svg = sdToggleAdvancedBtn.querySelector("svg");
                if (svg) svg.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
            });
        }

        // 4. Sliders live update
        if (sdStepsSlider && sdStepsVal) {
            sdStepsSlider.addEventListener("input", () => {
                sdStepsVal.textContent = sdStepsSlider.value;
            });
        }
        if (sdCfgSlider && sdCfgVal) {
            sdCfgSlider.addEventListener("input", () => {
                sdCfgVal.textContent = parseFloat(sdCfgSlider.value).toFixed(1);
            });
        }

        // 5. Random Sample Prompt
        if (sdSampleBtn && sdPromptInput) {
            sdSampleBtn.addEventListener("click", () => {
                const randomPrompt = SAMPLE_SD_PROMPTS[Math.floor(Math.random() * SAMPLE_SD_PROMPTS.length)];
                sdPromptInput.value = randomPrompt;
                sdPromptInput.focus();
            });
        }

        // 6. Reuse Seed
        if (sdReuseSeedBtn && sdSeedInput) {
            sdReuseSeedBtn.addEventListener("click", () => {
                if (lastGeneratedSeed !== null && lastGeneratedSeed !== undefined) {
                    sdSeedInput.value = lastGeneratedSeed;
                    if (sdAdvancedPanel && sdAdvancedPanel.style.display === "none") {
                        sdAdvancedPanel.style.display = "block";
                    }
                    sdSeedInput.focus();
                    alert(`Đã gán Seed: ${lastGeneratedSeed} vào ô cài đặt nâng cao!`);
                }
            });
        }

        // 7. Load GPU & Model Status (kèm tiến trình tải)
        async function loadSdStatus() {
            try {
                const res = await fetchApiWithFallback("/api/image/status");
                const data = await res.json();
                if (!data.success) return;

                // Update GPU badge
                if (sdGpuBadge) {
                    if (data.device === "cuda") {
                        sdGpuBadge.innerHTML = `<span class="dot green"></span> GPU: ${data.device_name} (${data.vram_used_gb || 0}/${data.vram_total_gb || 4.0}GB VRAM)`;
                    } else {
                        sdGpuBadge.innerHTML = `<span class="dot yellow"></span> CPU Mode`;
                    }
                }

                // Update Status Card
                if (sdStatusTitle && sdStatusText) {
                    const downloadInfo = data.download_info;
                    const isDownloading = data.state === "downloading" || (downloadInfo && downloadInfo.status === "downloading");

                    if (data.model_loaded) {
                        if (sdStatusDot) sdStatusDot.className = "dot green";
                        sdStatusTitle.textContent = "Mô hình SD 1.5 đã nạp sẵn trong VRAM GPU";
                        sdStatusText.textContent = data.message || `Đang chạy trên GPU ${data.device_name} (Đã cấp phát ${data.vram_used_gb} GB VRAM). Sẵn sàng tạo ảnh!`;
                        if (sdBtnLoadModel) sdBtnLoadModel.style.display = "none";
                        if (sdBtnUnloadModel) sdBtnUnloadModel.style.display = "inline-flex";
                        if (sdDownloadProgressContainer) sdDownloadProgressContainer.style.display = "none";
                    } else if (isDownloading && downloadInfo) {
                        if (sdStatusDot) sdStatusDot.className = "dot blue";
                        sdStatusTitle.textContent = "Đang tải tệp trọng số FP16 qua mạng (GPU 0%)...";
                        sdStatusText.textContent = "Hệ thống đang tải trọng số SD 1.5 FP16 về máy qua đa luồng. Trong lúc tải qua mạng GPU chưa hoạt động. Khi tải xong, mô hình sẽ nạp vào GPU và chạy với 100% công suất.";
                        if (sdBtnLoadModel) {
                            sdBtnLoadModel.style.display = "inline-flex";
                            sdBtnLoadModel.disabled = true;
                            sdBtnLoadModel.innerHTML = '<span class="spinner-sm" style="width:12px;height:12px;margin-right:4px;"></span> Đang tải...';
                        }
                        if (sdBtnUnloadModel) sdBtnUnloadModel.style.display = "none";

                        // Update progress bar
                        if (sdDownloadProgressContainer) {
                            sdDownloadProgressContainer.style.display = "block";
                            if (sdProgressFile) sdProgressFile.textContent = downloadInfo.current_file || "Đang tải...";
                            if (sdProgressPct) sdProgressPct.textContent = `${downloadInfo.overall_percent || 0}%`;
                            if (sdProgressBarFill) sdProgressBarFill.style.width = `${downloadInfo.overall_percent || 0}%`;
                            if (sdProgressSize) sdProgressSize.textContent = `${downloadInfo.overall_downloaded_mb || 0} / ${downloadInfo.overall_total_mb || 2035} MB`;
                            if (sdProgressSpeed) sdProgressSpeed.textContent = `⚡ ${downloadInfo.speed_mb_s || 0} MB/s`;
                            if (sdProgressEta) sdProgressEta.textContent = `Còn ~${downloadInfo.eta_seconds || '--'}s`;
                        }

                        // Poll again in 1.5s
                        if (sdPollTimer) clearTimeout(sdPollTimer);
                        sdPollTimer = setTimeout(loadSdStatus, 1500);

                    } else if (data.state === "loading_gpu") {
                        if (sdStatusDot) sdStatusDot.className = "dot yellow";
                        sdStatusTitle.textContent = "Đang nạp mô hình vào VRAM GPU Quadro P600...";
                        sdStatusText.textContent = "Đang khởi tạo pipeline PyTorch và cấp phát bộ nhớ GPU...";
                        if (sdBtnLoadModel) {
                            sdBtnLoadModel.style.display = "inline-flex";
                            sdBtnLoadModel.disabled = true;
                            sdBtnLoadModel.innerHTML = '<span class="spinner-sm" style="width:12px;height:12px;margin-right:4px;"></span> Đang nạp...';
                        }
                        if (sdBtnUnloadModel) sdBtnUnloadModel.style.display = "none";
                        if (sdDownloadProgressContainer) sdDownloadProgressContainer.style.display = "none";

                        if (sdPollTimer) clearTimeout(sdPollTimer);
                        sdPollTimer = setTimeout(loadSdStatus, 1500);

                    } else if (data.is_local_ready) {
                        if (sdStatusDot) sdStatusDot.className = "dot yellow";
                        sdStatusTitle.textContent = "Mô hình đã có sẵn trên máy (Chưa nạp GPU)";
                        sdStatusText.textContent = "Các tệp FP16 đã nằm sẵn trên ổ cứng. Bấm 'Nạp vào GPU' để nạp tức thì trong 5-8 giây mà không cần tải từ mạng.";
                        if (sdBtnLoadModel) {
                            sdBtnLoadModel.style.display = "inline-flex";
                            sdBtnLoadModel.disabled = false;
                            sdBtnLoadModel.innerHTML = '<span>🚀 Nạp vào GPU</span>';
                        }
                        if (sdBtnUnloadModel) sdBtnUnloadModel.style.display = "none";
                        if (sdDownloadProgressContainer) sdDownloadProgressContainer.style.display = "none";

                    } else {
                        if (sdStatusDot) sdStatusDot.className = "dot yellow";
                        sdStatusTitle.textContent = "Mô hình SD 1.5 chưa được nạp";
                        sdStatusText.textContent = "Lần đầu tiên cần tải trọng số FP16 (~2.0 GB). Bấm 'Tải & Nạp GPU' để bắt đầu tải ngầm siêu tốc.";
                        if (sdBtnLoadModel) {
                            sdBtnLoadModel.style.display = "inline-flex";
                            sdBtnLoadModel.disabled = false;
                            sdBtnLoadModel.innerHTML = '<span>🚀 Tải & Nạp GPU</span>';
                        }
                        if (sdBtnUnloadModel) sdBtnUnloadModel.style.display = "none";
                        if (sdDownloadProgressContainer) sdDownloadProgressContainer.style.display = "none";
                    }
                }
            } catch (e) {
                console.warn("[SDStudio] Lỗi lấy status GPU:", e);
            }
        }

        // Load / Unload Buttons
        if (sdBtnLoadModel) {
            sdBtnLoadModel.addEventListener("click", async () => {
                const modelId = sdModelSelect ? sdModelSelect.value : null;
                sdBtnLoadModel.disabled = true;
                sdBtnLoadModel.innerHTML = '<span class="spinner-sm" style="width:12px;height:12px;margin-right:4px;"></span> Đang xử lý...';
                try {
                    const res = await fetchApiWithFallback("/api/image/load_model", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ model_id: modelId })
                    });
                    const data = await res.json();
                    if (data.message) {
                        if (sdStatusText) sdStatusText.textContent = data.message;
                    }
                    loadSdStatus();
                } catch (e) {
                    alert(`Lỗi khi nạp mô hình: ${e.message}`);
                    loadSdStatus();
                }
            });
        }

        if (sdBtnUnloadModel) {
            sdBtnUnloadModel.addEventListener("click", async () => {
                try {
                    const res = await fetchApiWithFallback("/api/image/unload_model", { method: "POST" });
                    const data = await res.json();
                    if (data.success) {
                        alert("Đã giải phóng VRAM GPU thành công!");
                        loadSdStatus();
                    }
                } catch (e) {
                    alert(`Lỗi giải phóng VRAM: ${e.message}`);
                }
            });
        }

        // 8. Load Models Dropdown
        async function loadSdModels() {
            try {
                const res = await fetchApiWithFallback("/api/image/models");
                const data = await res.json();
                if (data.success && data.models && sdModelSelect) {
                    sdModelSelect.innerHTML = "";
                    data.models.forEach(m => {
                        const opt = document.createElement("option");
                        opt.value = m.id;
                        opt.textContent = m.name;
                        sdModelSelect.appendChild(opt);
                    });
                }
            } catch (e) {
                console.warn("[SDStudio] Lỗi nạp danh sách model SD:", e);
            }
        }

        // 9. Load History Gallery
        async function loadSdHistory() {
            if (!sdHistoryGrid) return;
            try {
                const res = await fetchApiWithFallback("/api/image/history?limit=30");
                const data = await res.json();
                if (data.success && data.history) {
                    if (sdHistoryCount) sdHistoryCount.textContent = data.history.length;
                    sdHistoryGrid.innerHTML = "";

                    if (data.history.length === 0) {
                        sdHistoryGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 20px; color: var(--text-muted); font-size: 0.85rem;">Chưa có tác phẩm nào trong thư viện. Hãy tạo ảnh đầu tiên!</div>`;
                        return;
                    }

                    const apiBase = CONFIG.getApiBase();
                    data.history.forEach(item => {
                        const card = document.createElement("div");
                        card.className = "sd-history-card";
                        const fullImgUrl = `${apiBase}${item.url}`;

                        card.innerHTML = `
                            <img src="${fullImgUrl}" alt="${escapeHtml(item.prompt)}" loading="lazy">
                            <div class="sd-history-card-hover">
                                <div class="sd-history-prompt-preview">${escapeHtml(item.prompt)}</div>
                                <div class="sd-history-card-actions">
                                    <button type="button" class="btn-use-prompt" title="Dùng lại Prompt này">📋 Dùng</button>
                                    <button type="button" class="btn-view-card" title="Xem trên Canvas">👁️ Xem</button>
                                    <a href="${fullImgUrl}" download="${item.filename}" title="Tải về">⬇️</a>
                                </div>
                            </div>
                        `;

                        const viewBtn = card.querySelector(".btn-view-card");
                        if (viewBtn) {
                            viewBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                displayImageOnCanvas(item);
                            });
                        }

                        const promptBtn = card.querySelector(".btn-use-prompt");
                        if (promptBtn) {
                            promptBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                if (sdPromptInput) {
                                    sdPromptInput.value = item.prompt;
                                    sdPromptInput.focus();
                                }
                                if (item.style) {
                                    sdStylePills.forEach(p => {
                                        if (p.getAttribute("data-style") === item.style) p.click();
                                    });
                                }
                            });
                        }

                        card.addEventListener("click", () => {
                            displayImageOnCanvas(item);
                        });

                        sdHistoryGrid.appendChild(card);
                    });
                }
            } catch (e) {
                console.warn("[SDStudio] Lỗi tải lịch sử ảnh:", e);
            }
        }

        function displayImageOnCanvas(item) {
            const apiBase = CONFIG.getApiBase();
            const fullImgUrl = `${apiBase}${item.url}`;
            if (sdResultImg) sdResultImg.src = fullImgUrl;
            if (sdDownloadBtn) {
                sdDownloadBtn.href = fullImgUrl;
                sdDownloadBtn.setAttribute("download", item.filename);
            }
            if (sdMetaTime) sdMetaTime.textContent = `⚡ ${item.time_taken || 0}s`;
            if (sdMetaSize) sdMetaSize.textContent = `📐 ${item.width || 512}×${item.height || 512}`;
            if (sdMetaSeed) sdMetaSeed.textContent = `🌱 Seed: ${item.seed || '-'}`;
            lastGeneratedSeed = item.seed;

            if (sdPromptUsedBox && sdPromptUsedText) {
                sdPromptUsedBox.style.display = "block";
                sdPromptUsedText.textContent = item.enhanced_prompt || item.prompt;
                if (sdStyleBadge) sdStyleBadge.textContent = item.style_name || item.style || "Tự do";
            }

            if (sdEmptyState) sdEmptyState.style.display = "none";
            if (sdLoadingState) sdLoadingState.style.display = "none";
            if (sdResultState) sdResultState.style.display = "flex";

            try {
                const canvasCard = document.querySelector(".sd-canvas-card");
                if (canvasCard) canvasCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } catch (_) {}
        }

        // 10. Generate Button Handler
        if (sdGenerateBtn) {
            sdGenerateBtn.addEventListener("click", async () => {
                const prompt = sdPromptInput ? sdPromptInput.value.trim() : "";
                if (!prompt) {
                    alert("Vui lòng nhập mô tả ý tưởng bức ảnh cần tạo!");
                    if (sdPromptInput) sdPromptInput.focus();
                    return;
                }

                const negativePrompt = sdNegPromptInput ? sdNegPromptInput.value.trim() : "";
                const steps = sdStepsSlider ? parseInt(sdStepsSlider.value) : 25;
                const cfgScale = sdCfgSlider ? parseFloat(sdCfgSlider.value) : 7.5;
                const seed = sdSeedInput ? parseInt(sdSeedInput.value) : -1;
                const enhancePrompt = sdEnhanceCheck ? sdEnhanceCheck.checked : true;
                const modelId = sdModelSelect ? sdModelSelect.value : "runwayml/stable-diffusion-v1-5";

                sdGenerateBtn.disabled = true;
                if (sdEmptyState) sdEmptyState.style.display = "none";
                if (sdResultState) sdResultState.style.display = "none";
                if (sdPromptUsedBox) sdPromptUsedBox.style.display = "none";
                if (sdLoadingState) sdLoadingState.style.display = "flex";

                const loadingDesc = document.getElementById("sd-loading-desc");
                if (loadingDesc) {
                    loadingDesc.textContent = enhancePrompt 
                        ? "Đang dùng Ollama dịch & tối ưu prompt, sau đó tạo ảnh trên GPU Quadro P600..." 
                        : "Đang khuếch tán không gian tiềm ẩn (Latent Diffusion 25 steps) trên GPU Quadro P600...";
                }

                try {
                    const res = await fetchApiWithFallback("/api/image/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prompt: prompt,
                            negative_prompt: negativePrompt,
                            style: currentSdStyle,
                            width: currentSdWidth,
                            height: currentSdHeight,
                            steps: steps,
                            cfg_scale: cfgScale,
                            seed: seed,
                            enhance_prompt: enhancePrompt,
                            model_id: modelId
                        })
                    });

                    const data = await res.json();

                    // Nếu mô hình đang được tải ngầm
                    if (res.status === 202 || data.is_downloading) {
                        alert("Mô hình SD 1.5 đang được tải tệp trọng số về máy (~2.0 GB). Bạn có thể theo dõi tiến trình trực tiếp ở khung trạng thái phía trên!");
                        if (sdEmptyState) sdEmptyState.style.display = "flex";
                        if (sdLoadingState) sdLoadingState.style.display = "none";
                        loadSdStatus();
                        const statusCard = document.getElementById("sd-model-status-card");
                        if (statusCard) statusCard.scrollIntoView({ behavior: "smooth", block: "center" });
                        return;
                    }

                    if (!res.ok || !data.success) {
                        throw new Error(data.error || "Không thể tạo ảnh từ mô hình SD 1.5.");
                    }

                    displayImageOnCanvas(data);
                    await loadSdHistory();
                    loadSdStatus();

                } catch (err) {
                    console.error("[SDStudio] Lỗi tạo ảnh:", err);
                    alert(`Lỗi khi tạo ảnh: ${err.message || 'Lỗi server'}`);
                    if (sdEmptyState) sdEmptyState.style.display = "flex";
                    if (sdLoadingState) sdLoadingState.style.display = "none";
                } finally {
                    sdGenerateBtn.disabled = false;
                }
            });
        }

        if (sdRefreshHistoryBtn) {
            sdRefreshHistoryBtn.addEventListener("click", () => {
                loadSdHistory();
            });
        }

        // Initial loading calls
        loadSdStatus();
        loadSdModels();
        loadSdHistory();
    }

    initImageStudio();
    initRoleplay();
    initChatParameters();
});
