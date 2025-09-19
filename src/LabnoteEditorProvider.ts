import * as vscode from 'vscode';

export class LabnoteEditorProvider implements vscode.CustomTextEditorProvider {

    public static readonly viewType = 'labnote.visualEditor';

    private static readonly panels = new Map<string, vscode.WebviewPanel>();

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new LabnoteEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(LabnoteEditorProvider.viewType, provider);
        return providerRegistration;
    }

    public static updateWebviewSection(documentUri: vscode.Uri, uoId: string, section: string, newContent: string) {
        const panel = LabnoteEditorProvider.panels.get(documentUri.toString());
        if (panel) {
            panel.webview.postMessage({
                type: 'updateSection',
                uoId: uoId,
                section: section,
                htmlContent: newContent
            });
        }
    }

    constructor(
        private readonly context: vscode.ExtensionContext
    ) { }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        LabnoteEditorProvider.panels.set(document.uri.toString(), webviewPanel);

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
                    vscode.commands.executeCommand('labnote.ai.populateSection.webview', 
                        document.uri, 
                        e.uoId, 
                        e.section
                    );
                    return;
                case 'updateTextDocument':
                    this.updateTextDocument(document, e.text);
                    return;
            }
        });

        updateWebview();
    }

    private updateTextDocument(document: vscode.TextDocument, text: any) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            text
        );
        return vscode.workspace.applyEdit(edit);
    }

    private getWebviewContent(): string {
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
                    body { font-family: var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif); background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 1rem; }
                    .controls { margin-bottom: 1rem; }
                    #editor { outline: none; padding: 1rem; border: 1px solid var(--vscode-input-border, #ccc); border-radius: 4px; min-height: 80vh; }
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

                <script>
                    const vscode = acquireVsCodeApi();
                    const editor = document.getElementById('editor');
                    const saveButton = document.getElementById('save-button');

                    const md = window.markdownit({ html: true, linkify: true, typographer: true });
                    const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
                    let lastKnownContent = '';

                    function renderContent(markdown) {
                        const html = md.render(markdown);
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = html;

                        const uoHeadings = tempDiv.querySelectorAll('h3');
                        uoHeadings.forEach(h3 => {
                            // ⭐️ [버그 수정] 잘못된 정규식을 올바르게 수정
                            const match = h3.textContent.match(/\\[(U[A-Z]{1,3}\\d{3,4})/);
                            if (match) {
                                const uoId = match[1];
                                let nextElement = h3.nextElementSibling;
                                while(nextElement && nextElement.tagName !== 'H3') {
                                    if (nextElement.tagName === 'H4') {
                                        if (nextElement.querySelector('.ai-fill-btn')) {
                                            nextElement = nextElement.nextElementSibling;
                                            continue;
                                        }
                                        const sectionName = Array.from(nextElement.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
                                        if (sectionName) {
                                            const button = document.createElement('button');
                                            button.className = 'ai-fill-btn';
                                            button.textContent = 'AI로 채우기';
                                            button.onclick = (e) => {
                                                e.stopPropagation();
                                                vscode.postMessage({ type: 'populate', uoId: uoId, section: sectionName });
                                            };
                                            nextElement.appendChild(button);
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
                        return turndownService.turndown(editorClone.innerHTML);
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'update':
                                const newContent = message.text;
                                if (newContent !== lastKnownContent) {
                                    lastKnownContent = newContent;
                                    renderContent(newContent);
                                }
                                break;
                            case 'updateSection':
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
                                break;
                        }
                    });

                    saveButton.addEventListener('click', () => {
                        const newMarkdown = getCleanMarkdown();
                        lastKnownContent = newMarkdown;
                        vscode.postMessage({ type: 'save', text: newMarkdown });
                    });
                </script>
            </body>
            </html>
        `;
    }
}