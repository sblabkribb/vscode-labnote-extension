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
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getWebviewContent();
        const updateWebview = () => {
            webviewPanel.webview.postMessage({
                type: 'update',
                text: document.getText(),
            });
        };
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
                // Avoid updating the webview if the change came from the webview itself
                // This check is basic and might need more robust logic for complex scenarios
                const sourceOfChange = e.reason;
                if (sourceOfChange !== vscode.TextDocumentChangeReason.Undo && sourceOfChange !== vscode.TextDocumentChangeReason.Redo) {
                    // A simple heuristic: if the change is not a simple undo/redo, it might be from an external source.
                    // For a truly robust solution, one would need a more complex state management.
                    // console.log('Document changed externally, updating webview.');
                    // updateWebview();
                }
            }
        });
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'save':
                    this.updateTextDocument(document, e.text);
                    return;
                case 'edit':
                    // This is for live edits, if we want to implement auto-save or dirty status
                    // For now, we only care about the explicit save action
                    return;
            }
        });
        updateWebview();
    }
    updateTextDocument(document, text) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
        return vscode.workspace.applyEdit(edit);
    }
    getWebviewContent() {
        // Use CDN for markdown-it and turndown libraries
        const markdownitScript = 'https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js';
        const turndownScript = 'https://unpkg.com/turndown/dist/turndown.js';
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Visual Labnote Editor</title>
                <script src="${markdownitScript}"></script>
                <script src="${turndownScript}"></script>
                <style>
                    body, html {
                        margin: 0;
                        padding: 0;
                        height: 100%;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        display: flex;
                        flex-direction: column;
                    }
                    .controls {
                        padding: 10px;
                        border-bottom: 1px solid var(--vscode-editorWidget-border);
                        display: flex;
                        justify-content: flex-end;
                        flex-shrink: 0;
                    }
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 16px;
                        cursor: pointer;
                        border-radius: 5px;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    #editor {
                        flex-grow: 1;
                        padding: 20px;
                        overflow-y: auto;
                        font-size: 16px;
                        line-height: 1.6;
                    }
                    #editor:focus {
                        outline: none;
                    }

                    /* Basic Markdown Styles */
                    #editor h1, #editor h2, #editor h3, #editor h4 {
                        border-bottom: 1px solid var(--vscode-editorWidget-border);
                        padding-bottom: .3em;
                    }
                    #editor blockquote {
                        border-left: .25em solid var(--vscode-editorWidget-border);
                        padding: 0 1em;
                        color: var(--vscode-editor-foreground);
                        opacity: 0.8;
                    }
                    #editor code {
                        background-color: var(--vscode-textBlockQuote-background);
                        padding: .2em .4em;
                        margin: 0;
                        font-size: 85%;
                        border-radius: 3px;
                    }
                    #editor pre {
                        padding: 16px;
                        overflow: auto;
                        font-size: 85%;
                        line-height: 1.45;
                        background-color: var(--vscode-textBlockQuote-background);
                        border-radius: 3px;
                    }
                    #editor table {
                        border-collapse: collapse;
                        width: 100%;
                    }
                    #editor th, #editor td {
                        border: 1px solid var(--vscode-editorWidget-border);
                        padding: 8px;
                    }
                    #editor th {
                        background-color: var(--vscode-toolbar-hoverBackground);
                    }
                    #editor hr {
                        border: 0;
                        height: .25em;
                        padding: 0;
                        margin: 24px 0;
                        background-color: var(--vscode-editorWidget-border);
                    }
                </style>
            </head>
            <body>
                <div class="controls">
                    <button id="save-button">Save Changes</button>
                </div>
                <div id="editor" contenteditable="true"></div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const editor = document.getElementById('editor');
                    const saveButton = document.getElementById('save-button');

                    // Initialize markdown-it and turndown
                    const md = window.markdownit({
                        html: true,
                        linkify: true,
                        typographer: true
                    });
                    const turndownService = new TurndownService({ 
                        headingStyle: 'atx', 
                        codeBlockStyle: 'fenced' 
                    });

                    let lastKnownContent = '';

                    // Handle messages from the extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'update':
                                const newContent = message.text;
                                // Only update if content has actually changed to avoid losing cursor position
                                if (newContent !== lastKnownContent) {
                                    lastKnownContent = newContent;
                                    // Render markdown to HTML and set it in the editor
                                    editor.innerHTML = md.render(newContent);
                                }
                                break;
                        }
                    });

                    // Save button listener
                    saveButton.addEventListener('click', () => {
                        // Convert HTML back to markdown
                        const newMarkdown = turndownService.turndown(editor.innerHTML);
                        lastKnownContent = newMarkdown; // Update last known content
                        
                        vscode.postMessage({
                            type: 'save',
                            text: newMarkdown
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
//# sourceMappingURL=LabnoteEditorProvider.js.map