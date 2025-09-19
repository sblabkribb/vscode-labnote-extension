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
                case 'updateTextDocument':
                    this.updateTextDocument(document, e.text);
                    return;
                case 'populate':
                    vscode.commands.executeCommand('labnote.ai.populateSection.webview', document.uri, e.uoId, e.section);
                    return;
            }
        });
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

                        // ⭐️ 마크다운 형식이 깨지는 문제를 해결하기 위한 turndown 규칙 추가
                        turndownService.addRule('yamlFrontMatter', {
                            filter: (node, options) => {
                                return node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE' && /---/.test(node.firstChild.textContent);
                            },
                            replacement: (content, node) => {
                                return '---\\n' + node.firstChild.textContent + '\\n---\\n';
                            }
                        });
                        turndownService.addRule('horizontalRule', {
                            filter: 'hr',
                            replacement: () => '\\n---\\n'
                        });


                        let lastKnownContent = '';

                        function renderContent(markdown) {
                            const html = md.render(markdown);
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = html;

                            tempDiv.querySelectorAll('h3').forEach(h3 => {
                                const match = h3.textContent.match(/\\[(U[A-Z]{2,3}\\d{3,4})\\]/);
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
                            editor.innerHTML = tempDiv.innerHTML;
                        }

                        function getCleanMarkdown() {
                            const editorClone = editor.cloneNode(true);
                            editorClone.querySelectorAll('.ai-fill-btn').forEach(btn => btn.remove());
                            return turndownService.turndown(editorClone);
                        }
                        
                        let debounceTimer;
                        editor.addEventListener('input', () => {
                            clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(() => {
                                const newMarkdown = getCleanMarkdown();
                                if (newMarkdown !== lastKnownContent) {
                                    lastKnownContent = newMarkdown;
                                    vscode.postMessage({ type: 'updateTextDocument', text: newMarkdown });
                                }
                            }, 500);
                        });

                        window.addEventListener('message', event => {
                            const message = event.data;
                            if (message.type === 'update') {
                                const newContent = message.text;
                                if (newContent !== lastKnownContent) {
                                    lastKnownContent = newContent;
                                    renderContent(newContent);
                                }
                            } else if (message.type === 'updateSection') {
                               const { uoId, section, htmlContent } = message;
                                const allH3 = Array.from(editor.querySelectorAll('h3'));
                                for(const h3 of allH3) {
                                    if (h3.textContent.includes(\`[\${uoId}\`)) {
                                        let nextElement = h3.nextElementSibling;
                                        while(nextElement && nextElement.tagName !== 'H3') {
                                            if (nextElement.tagName === 'H4' && nextElement.textContent.includes(section)) {
                                                let placeholder = nextElement.nextElementSibling;
                                                if(placeholder && (placeholder.tagName === 'P' || placeholder.tagName === 'UL' || placeholder.tagName === 'LI')) {
                                                    const newElement = document.createElement('div');
                                                    newElement.innerHTML = htmlContent;
                                                    placeholder.replaceWith(...newElement.childNodes);
                                                }
                                                break; 
                                            }
                                            nextElement = nextElement.nextElementSibling;
                                        }
                                        break; 
                                    }
                                }
                                const newMarkdown = getCleanMarkdown();
                                lastKnownContent = newMarkdown;
                                vscode.postMessage({ type: 'updateTextDocument', text: newMarkdown });
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