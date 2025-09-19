"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LabnoteEditorProvider = void 0;
const vscode = __importStar(require("vscode"));
class LabnoteEditorProvider {
    static register(context) {
        const provider = new LabnoteEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(LabnoteEditorProvider.viewType, provider);
        return providerRegistration;
    }
    constructor(context) {
        this.context = context;
    }
    async resolveCustomTextEditor(document, webviewPanel, _token) {
        LabnoteEditorProvider.panels.set(document.uri.toString(), webviewPanel);
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        // ⭐️ getWebviewContent 함수에 document.uri를 전달하여 웹뷰가 현재 파일 위치를 알 수 있도록 합니다.
        webviewPanel.webview.html = this.getWebviewContent(document.uri);
        const updateWebview = () => {
            webviewPanel.webview.postMessage({
                type: 'update',
                text: document.getText(),
            });
        };
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
                // Undo/Redo는 루프를 유발할 수 있으므로 제외
                if (e.reason !== vscode.TextDocumentChangeReason.Undo && e.reason !== vscode.TextDocumentChangeReason.Redo) {
                    updateWebview();
                }
            }
        });
        webviewPanel.onDidDispose(() => {
            LabnoteEditorProvider.panels.delete(document.uri.toString());
            changeDocumentSubscription.dispose();
        });
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'save':
                    this.updateTextDocument(document, e.text);
                    return;
                case 'populate':
                    // ⭐️ 통합된 명령어로 호출하도록 수정
                    vscode.commands.executeCommand('labnote.ai.populateSection', document.uri, e.uoId, e.section);
                    return;
                // 'updateTextDocument'는 contenteditable에서 직접 수정하므로, 
                // 'save' 버튼을 누를 때만 동기화하는 것이 더 안정적입니다.
            }
        });
        updateWebview();
    }
    updateTextDocument(document, text) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
        return vscode.workspace.applyEdit(edit);
    }
    getWebviewContent(documentUri) {
        const markdownitScript = 'https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js';
        const turndownScript = 'https://unpkg.com/turndown/dist/turndown.js';
        // Nonce for Content Security Policy
        const nonce = new Date().getTime() + '' + new Date().getMilliseconds();
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Visual Labnote Editor</title>
                <script nonce="${nonce}" src="${markdownitScript}"></script>
                <script nonce="${nonce}" src="${turndownScript}"></script>
                <style>
                    body { font-family: var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif); background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 1rem; }
                    .controls { margin-bottom: 1rem; position: fixed; top: 1rem; right: 2rem; background-color: var(--vscode-editor-background); padding: 0.5rem; border-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
                    #editor { outline: none; padding: 1rem; border: 1px solid var(--vscode-input-border, #ccc); border-radius: 4px; min-height: 80vh; margin-top: 4rem; }
                    button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border); padding: 0.5em 1em; cursor: pointer; border-radius: 2px; }
                    button:hover { background-color: var(--vscode-button-hoverBackground); }
                    .ai-fill-btn { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border); padding: 2px 8px; font-size: 12px; cursor: pointer; border-radius: 3px; margin-left: 10px; float: right; }
                    .ai-fill-btn:hover { background-color: var(--vscode-button-secondaryHoverBackground); }
                </style>
            </head>
            <body>
                <div class="controls">
                    <button id="save-button">Save Changes</button>
                </div>
                <div id="editor" contenteditable="true"></div>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    const editor = document.getElementById('editor');
                    const saveButton = document.getElementById('save-button');

                    const md = window.markdownit({ html: true, linkify: true, typographer: true });
                    const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
                    let lastKnownText = '';
                    
                    // ⭐️ [핵심 수정] 버튼 생성 및 렌더링 로직
                    function renderContent(markdown) {
                        const html = md.render(markdown);
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = html;

                        // Unit Operation(h3)을 기준으로 하위 섹션(h4)을 순회
                        tempDiv.querySelectorAll('h3').forEach(h3 => {
                            // 1. 정확한 정규식으로 UO ID 추출
                            const uoMatch = h3.textContent.match(/\\[(U[A-Z]{2,3}\\d{3,4})\\]/);
                            if (!uoMatch) return;
                            
                            const uoId = uoMatch[1];
                            let currentElement = h3.nextElementSibling;
                            
                            // 2. 다음 H3를 만나기 전까지 모든 H4를 검사
                            while(currentElement && currentElement.tagName !== 'H3') {
                                if (currentElement.tagName === 'H4') {
                                    const h4 = currentElement;
                                    // 3. 플레이스홀더가 있는지 확인
                                    let placeholder = h4.nextElementSibling;
                                    if(placeholder && (placeholder.tagName === 'P' || placeholder.tagName === 'UL') && placeholder.textContent.trim().startsWith('(')) {
                                        // 4. 버튼이 이미 있는지 확인 (중복 방지)
                                        if (!h4.querySelector('.ai-fill-btn')) {
                                            const sectionName = Array.from(h4.childNodes)
                                                .filter(node => node.nodeType === Node.TEXT_NODE)
                                                .map(node => node.textContent)
                                                .join('').trim();

                                            if(sectionName) {
                                                const button = document.createElement('button');
                                                button.className = 'ai-fill-btn';
                                                button.textContent = '⚡️ AI로 채우기';
                                                button.onclick = (e) => {
                                                    e.stopPropagation(); // 편집기 포커스 잃지 않도록
                                                    vscode.postMessage({ type: 'populate', uoId: uoId, section: sectionName });
                                                };
                                                h4.appendChild(button);
                                            }
                                        }
                                    }
                                }
                                currentElement = currentElement.nextElementSibling;
                            }
                        });
                        
                        editor.innerHTML = tempDiv.innerHTML;
                    }

                    // AI 버튼 등 UI 요소를 제외하고 순수 마크다운만 추출하는 함수
                    function getCleanMarkdown() {
                        const editorClone = editor.cloneNode(true);
                        editorClone.querySelectorAll('.ai-fill-btn').forEach(btn => btn.remove());
                        return turndownService.turndown(editorClone.innerHTML);
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'update') {
                            const newText = message.text;
                            // 무한 루프를 막기 위해 내용이 실제로 변경되었을 때만 렌더링
                            if (newText !== lastKnownText) {
                                lastKnownText = newText;
                                renderContent(newText);
                            }
                        }
                    });

                    saveButton.addEventListener('click', () => {
                        const markdownToSave = getCleanMarkdown();
                        lastKnownText = markdownToSave; // 저장 후 lastKnownText 업데이트
                        vscode.postMessage({ type: 'save', text: markdownToSave });
                    });

                </script>
            </body>
            </html>
        `;
    }
}
exports.LabnoteEditorProvider = LabnoteEditorProvider;
LabnoteEditorProvider.viewType = 'labnote.visualEditor';
LabnoteEditorProvider.panels = new Map();
//# sourceMappingURL=LabnoteEditorProvider.js.map