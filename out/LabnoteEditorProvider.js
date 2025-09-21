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
/**
 * ⭐️ [v2.3.0 수정 최종본]
 * Visual Editor가 YAML Front Matter를 손상시키는 문제를 해결하기 위해 로직을 대폭 수정했습니다.
 * - YAML과 Markdown 본문을 분리하여 처리합니다.
 * - 확장(Extension)이 YAML을 관리하고, 웹뷰(Webview)는 본문만 수정하도록 역할 분담.
 * - 이를 통해 HTML 변환 라이브러리가 YAML을 손상시키는 문제를 원천적으로 방지합니다.
 */
class LabnoteEditorProvider {
    static register(context) {
        const provider = new LabnoteEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(LabnoteEditorProvider.viewType, provider);
    }
    static updateWebviewSection(documentUri, uoId, section, newContent) {
        const panel = LabnoteEditorProvider.panels.get(documentUri.toString());
        if (panel) {
            panel.webview.postMessage({
                type: 'updateSection',
                uoId,
                section,
                htmlContent: newContent
            });
        }
    }
    constructor(context) {
        this.context = context;
    }
    async resolveCustomTextEditor(document, webviewPanel, _token) {
        LabnoteEditorProvider.panels.set(document.uri.toString(), webviewPanel);
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview);
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                webviewPanel.webview.postMessage({ type: 'update', text: document.getText() });
            }
        });
        webviewPanel.onDidDispose(() => {
            LabnoteEditorProvider.panels.delete(document.uri.toString());
            changeDocumentSubscription.dispose();
        });
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'updateTextDocument': {
                    const originalText = document.getText();
                    const match = originalText.match(/^(---[\s\S]*?---\s*)/);
                    const yaml = match ? match[1] : '';
                    // 웹뷰는 본문(e.text)만 보내고, 확장 프로그램이 원본 YAML과 합칩니다.
                    const newFullText = yaml + e.text;
                    if (newFullText !== originalText) {
                        this.updateTextDocument(document, newFullText);
                    }
                    return;
                }
                case 'populate':
                    vscode.commands.executeCommand('labnote.ai.populateSection.webview', document.uri, e.uoId, e.section);
                    return;
            }
        });
        // 웹뷰에 초기 데이터를 보낼 때도 YAML을 분리해서 보냅니다.
        webviewPanel.webview.postMessage({ type: 'update', text: document.getText() });
    }
    updateTextDocument(document, text) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
        return vscode.workspace.applyEdit(edit);
    }
    getWebviewContent(webview) {
        const markdownitScriptUri = "https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js";
        const turndownScriptUri = "https://unpkg.com/turndown/dist/turndown.js";
        const nonce = new Date().getTime() + '' + new Date().getMilliseconds();
        // Webview 스크립트 부분 수정: YAML을 분리하고 본문만 처리하도록 로직 변경
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" 
                      content="default-src 'none'; 
                               script-src 'nonce-${nonce}'; 
                               style-src ${webview.cspSource} 'unsafe-inline';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Visual Labnote Editor</title>
                <script nonce="${nonce}" src="${markdownitScriptUri}"></script>
                <script nonce="${nonce}" src="${turndownScriptUri}"></script>
                <style>
                    /* 스타일은 기존과 동일 */
                    body { font-family: var(--vscode-editor-font-family, sans-serif); background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 1rem; }
                    #editor { outline: none; padding: 1rem; border: 1px solid var(--vscode-input-border, #ccc); border-radius: 4px; min-height: 80vh; }
                    .ai-fill-btn { float: right; margin-left: 10px; background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border); padding: 2px 8px; font-size: 12px; cursor: pointer; border-radius: 3px; }
                    .ai-fill-btn:hover { background-color: var(--vscode-button-secondaryHoverBackground); }
                    hr { border: none; border-top: 1px solid var(--vscode-editorWidget-border, #454545); margin-top: 1em; margin-bottom: 1em; }
                </style>
            </head>
            <body>
                <div id="editor" contenteditable="true"></div>
                <script nonce="${nonce}">
                    document.addEventListener('DOMContentLoaded', function() {
                        const vscode = acquireVsCodeApi();
                        const editor = document.getElementById('editor');
                        
                        const md = window.markdownit({ html: true, linkify: true, typographer: true });
                        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

                        let lastKnownBodyContent = '';
                        let isInternalUpdate = false;

                        // YAML과 본문을 분리하는 함수
                        function splitYamlAndBody(text) {
                            const match = text.match(/^(---[\\s\\S]*?---\\s*)/);
                            if (match) {
                                const yaml = match[1];
                                const body = text.substring(yaml.length);
                                return { yaml, body };
                            }
                            return { yaml: '', body: text };
                        }

                        // ... (renderContent, getCleanMarkdown 함수는 이전과 동일하게 유지) ...
                        
                        // 렌더링 함수 (AI 버튼 추가 로직 포함)
                        function renderContent(markdownBody) {
                            const html = md.render(markdownBody);
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = html;

                            tempDiv.querySelectorAll('h3').forEach(h3 => {
                                const match = h3.textContent.match(/\\[(U[A-Z]{2,3}\\d{3,4}).*?\\]/); // 정규식 수정
                                if (match) {
                                    const uoId = match[1];
                                    let nextElement = h3.nextElementSibling;
                                    while (nextElement && nextElement.tagName !== 'H3') {
                                        if (nextElement.tagName === 'H4') {
                                            const placeholder = nextElement.nextElementSibling;
                                            const hasPlaceholder = placeholder && (placeholder.tagName === 'P' || placeholder.tagName === 'UL') && placeholder.textContent.trim().startsWith('(');
                                            
                                            if (hasPlaceholder && !nextElement.querySelector('.ai-fill-btn')) {
                                                const sectionName = Array.from(nextElement.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
                                                if (sectionName) {
                                                    const button = document.createElement('button');
                                                    button.className = 'ai-fill-btn';
                                                    button.textContent = '⚡️AI로 채우기';
                                                    button.onclick = (e) => {
                                                        e.stopPropagation();
                                                        vscode.postMessage({ type: 'populate', uoId: uoId, section: sectionName });
                                                    };
                                                    nextElement.appendChild(button);
                                                }
                                            }
                                        }
                                        nextElement = nextElement.nextElementSibling;
                                    }
                                }
                            });
                            
                            isInternalUpdate = true;
                            editor.innerHTML = tempDiv.innerHTML;
                            setTimeout(() => { isInternalUpdate = false; }, 50);
                        }

                        function getCleanMarkdown() {
                            const editorClone = editor.cloneNode(true);
                            editorClone.querySelectorAll('.ai-fill-btn').forEach(btn => btn.remove());
                            return turndownService.turndown(editorClone);
                        }
                        
                        let debounceTimer;
                        editor.addEventListener('input', () => {
                            if (isInternalUpdate) return;

                            clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(() => {
                                const newMarkdownBody = getCleanMarkdown();
                                if (newMarkdownBody !== lastKnownBodyContent) {
                                    lastKnownBodyContent = newMarkdownBody;
                                    // 수정된 본문만 전송
                                    vscode.postMessage({ type: 'updateTextDocument', text: newMarkdownBody });
                                }
                            }, 500);
                        });

                        window.addEventListener('message', event => {
                            const message = event.data;
                            switch (message.type) {
                                case 'update': {
                                    // 전체 텍스트를 받아서 YAML과 본문을 분리
                                    const { body } = splitYamlAndBody(message.text);
                                    if (body !== lastKnownBodyContent) {
                                        lastKnownBodyContent = body;
                                        // 본문만 렌더링
                                        renderContent(body);
                                    }
                                    break;
                                }
                                case 'updateSection': {
                                   const { uoId, section, htmlContent } = message;
                                   const allH3 = Array.from(editor.querySelectorAll('h3'));
                                   for(const h3 of allH3) {
                                       if (h3.textContent.includes('[' + uoId + ']')) {
                                           let nextElement = h3.nextElementSibling;
                                           while(nextElement && nextElement.tagName !== 'H3') {
                                               if (nextElement.tagName === 'H4' && nextElement.textContent.includes(section)) {
                                                   let placeholder = nextElement.nextElementSibling;
                                                   if(placeholder && (placeholder.tagName === 'P' || placeholder.tagName === 'UL' || placeholder.tagName === 'LI')) {
                                                       const newElement = document.createElement('div');
                                                       newElement.innerHTML = htmlContent;
                                                       
                                                       isInternalUpdate = true;
                                                       placeholder.replaceWith(...newElement.childNodes);
                                                       setTimeout(() => { isInternalUpdate = false; }, 50);

                                                       const newMarkdownBody = getCleanMarkdown();
                                                       lastKnownBodyContent = newMarkdownBody;
                                                       vscode.postMessage({ type: 'updateTextDocument', text: newMarkdownBody });
                                                   }
                                                   break; 
                                               }
                                               nextElement = nextElement.nextElementSibling;
                                           }
                                           break; 
                                       }
                                   }
                                   break;
                                }
                            }
                        });
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