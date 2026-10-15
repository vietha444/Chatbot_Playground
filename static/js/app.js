/**
 * HPU2 AI Assistant - Cloudflare Frontend Client Logic (v2.3)
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

    // ---------------------- TABS NAVIGATION ----------------------
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-tab");
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.remove("active"));
            btn.classList.add("active");

            const targetSection = document.getElementById(targetId);
            if (targetSection) targetSection.classList.add("active");

            if (targetId === "tab-documents") {
                loadDocumentsList();
            }
            if (targetId === "tab-office") {
                loadOfficeFilesList();
            }
        });
    });

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
        if (currentUser && currentUser.username && currentUser.username !== "guest") {
            loggedInBox.style.display = "flex";
            if (authButtonsGroup) authButtonsGroup.style.display = "none";
            userDisplayName.textContent = currentUser.username;

            if (currentUser.role === "admin") {
                userRoleBadge.textContent = "👑 Quản trị viên";
                userRoleBadge.className = "user-role-badge admin-badge";
                if (adminUserFilter) adminUserFilter.style.display = "inline-block";
            } else {
                userRoleBadge.textContent = "👤 Người dùng";
                userRoleBadge.className = "user-role-badge user-badge";
                if (adminUserFilter) adminUserFilter.style.display = "none";
            }
        } else {
            loggedInBox.style.display = "none";
            if (authButtonsGroup) authButtonsGroup.style.display = "flex";
            if (adminUserFilter) adminUserFilter.style.display = "none";
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

            // Populate Cả 2 bộ chọn mô hình ở đáy dock: Direct Chat & RAG Chat
            if (currentConfig.models) {
                [selectModelDirect, selectModelRag].forEach(sel => {
                    if (!sel) return;
                    sel.innerHTML = "";
                    currentConfig.models.forEach(m => {
                        const opt = document.createElement("option");
                        opt.value = m.id;
                        opt.textContent = m.name;
                        if (m.default) opt.selected = true;
                        sel.appendChild(opt);
                    });
                });
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
    function appendMessage(sender, text, container, chatType = "direct", attachedImages = []) {
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
                <span class="sender-name">HPU2 AI Assistant</span>
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

    // ---------------------- XỬ LÝ ĐÍNH KÈM HÌNH ẢNH MULTIMODAL ----------------------
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
                files.forEach(file => readAndAttachImage(file, type));
                fileInput.value = "";
            });
        }

        // Hỗ trợ dán ảnh trực tiếp từ Clipboard (Ctrl + V)
        if (textInput) {
            textInput.addEventListener("paste", (e) => {
                const items = (e.clipboardData || window.clipboardData)?.items || [];
                for (const item of items) {
                    if (item.type && item.type.indexOf("image") !== -1) {
                        const file = item.getAsFile();
                        if (file) {
                            readAndAttachImage(file, type);
                        }
                    }
                }
            });
        }
    }

    function readAndAttachImage(file, type) {
        if (!file || !file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            const b64 = dataUrl.split(",")[1];
            const imgObj = {
                name: file.name || `Ảnh dán (${formatTime()})`,
                base64: b64,
                url: dataUrl
            };
            if (type === "direct") {
                directAttachedImages.push(imgObj);
                renderAttachedPreviewStrip("direct");
            } else {
                ragAttachedImages.push(imgObj);
                renderAttachedPreviewStrip("rag");
            }
        };
        reader.readAsDataURL(file);
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

        list.forEach((img, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "attached-thumb-wrap";
            wrap.innerHTML = `
                <img src="${img.url}" alt="${escapeHtml(img.name)}" />
                <span class="attach-name" title="${escapeHtml(img.name)}">${escapeHtml(img.name)}</span>
                <button type="button" class="remove-attach-btn" title="Gỡ ảnh này">&times;</button>
            `;

            wrap.querySelector(".remove-attach-btn").addEventListener("click", () => {
                list.splice(idx, 1);
                renderAttachedPreviewStrip(type);
            });

            previewContainer.appendChild(wrap);
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
        const hasImages = directAttachedImages.length > 0;
        if (!text && !hasImages) return;

        const displayText = text || "(Hình ảnh gửi kèm)";
        const imagesToSend = [...directAttachedImages];
        directAttachedImages = [];
        renderAttachedPreviewStrip("direct");

        const selectedModelId = selectModelDirect ? selectModelDirect.value : "qwen2.5:14b";

        appendMessage("user", displayText, directMessagesContainer, "direct", imagesToSend);
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
                    message: displayText,
                    model: selectedModelId,
                    mode: "direct",
                    collections: [],
                    collection: "",
                    score_threshold: 0.3,
                    history: directChatHistory,
                    username: currentUser.username,
                    user_images: imagesToSend.map(img => img.base64)
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
                            <span class="sender-name">HPU2 AI Assistant</span>
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
        const hasImages = ragAttachedImages.length > 0;
        if (!text && !hasImages) return;

        if (selectedCollections.size === 0) {
            alert("⚠️ Vui lòng tích chọn ít nhất 1 tài liệu ở khung bên trái để hệ thống trích xuất tri thức.");
            return;
        }

        const displayText = text || "(Hình ảnh gửi kèm câu hỏi RAG)";
        const imagesToSend = [...ragAttachedImages];
        ragAttachedImages = [];
        renderAttachedPreviewStrip("rag");

        const selectedRagModeRadio = document.querySelector('input[name="rag-mode"]:checked');
        const selectedMode = selectedRagModeRadio ? selectedRagModeRadio.value : "rag_rerank";
        const selectedModelId = selectModelRag ? selectModelRag.value : "qwen2.5:14b";
        const threshold = rerankerThresholdSlider ? parseFloat(rerankerThresholdSlider.value) : 0.3;

        appendMessage("user", displayText, ragMessagesContainer, "rag", imagesToSend);
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
                    message: displayText,
                    model: selectedModelId,
                    mode: selectedMode,
                    collections: collectionsArray,
                    collection: collectionsArray.join("+"),
                    score_threshold: threshold,
                    history: ragChatHistory,
                    username: currentUser.username,
                    user_images: imagesToSend.map(img => img.base64)
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
                            <span class="sender-name">HPU2 AI Assistant</span>
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
                    appendMessage("user", m.content, container, isDirect ? "direct" : "rag", formattedImages);
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

    // ---------------------- KHỞI CHẠY LẦN ĐẦU ----------------------
    updateUserUI();
    loadConfig();
    loadDocumentsList();
    loadHistorySessions();
    initOfficeStudio();
});
