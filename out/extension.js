"use strict";
// vscode-labnote-extension/src/extension.ts
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logic = __importStar(require("./logic"));
const fetch = require('node-fetch');
const realFsProvider = {
    exists: (p) => fs.existsSync(p),
    mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
    readDir: (p) => fs.readdirSync(p, { withFileTypes: true }),
    readTextFile: (p) => fs.readFileSync(p, 'utf-8'),
    writeTextFile: (p, content) => fs.writeFileSync(p, content),
};
// --- 확장 프로그램 활성화 ---
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel("LabNote AI");
    outputChannel.appendLine("LabNote AI/Manager extension is now active.");
    // --- 템플릿 경로 관리 ---
    const resolveConfiguredPath = (settingKey, defaultFileName) => {
        const config = vscode.workspace.getConfiguration('labnote.manager');
        let configured = (config.get(settingKey) || '').trim();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        if (configured) {
            if (workspaceRoot) {
                configured = configured.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
            }
            if (workspaceRoot && !path.isAbsolute(configured)) {
                configured = path.join(workspaceRoot, configured);
            }
            if (fs.existsSync(configured)) {
                return configured;
            }
            else {
                vscode.window.showWarningMessage(`[Labnote Manager] 설정된 경로를 찾을 수 없어 기본 템플릿으로 대체합니다: ${configured}`);
            }
        }
        return path.join(context.extensionPath, 'out', 'resources', defaultFileName);
    };
    const customWorkflowsPath = resolveConfiguredPath('workflowsPath', 'workflows_en.md');
    const customHwUoPath = resolveConfiguredPath('hwUnitOperationsPath', 'unitoperations_hw_en.md');
    const customSwUoPath = resolveConfiguredPath('swUnitOperationsPath', 'unitoperations_sw_en.md');
    // --- 파일 이름 변경 감지 및 처리 ---
    context.subscriptions.push(vscode.workspace.onDidRenameFiles(async (e) => {
        const edit = new vscode.WorkspaceEdit();
        for (const file of e.files) {
            const oldPath = file.oldUri.fsPath;
            const newPath = file.newUri.fsPath;
            if (logic.isValidWorkflowPath(oldPath) || logic.isValidWorkflowPath(newPath)) {
                const oldBaseName = path.basename(oldPath);
                const newBaseName = path.basename(newPath);
                const oldMatch = oldBaseName.match(/^(\d{3})_/);
                const newMatch = newBaseName.match(/^(\d{3})_/);
                if (oldMatch && newMatch && oldMatch[1] !== newMatch[1]) {
                    const dir = path.dirname(newPath);
                    const readmePath = path.join(dir, 'README.md');
                    if (fs.existsSync(readmePath)) {
                        const readmeUri = vscode.Uri.file(readmePath);
                        const doc = await vscode.workspace.openTextDocument(readmeUri);
                        for (let i = 0; i < doc.lineCount; i++) {
                            const line = doc.lineAt(i);
                            if (line.text.includes(oldBaseName)) {
                                const newText = line.text.replace(oldBaseName, newBaseName)
                                    .replace(new RegExp(`^(\\[ \\] \\[)${oldMatch[1]}`), `$1${newMatch[1]}`);
                                edit.replace(readmeUri, line.range, newText);
                            }
                        }
                    }
                }
            }
        }
        await vscode.workspace.applyEdit(edit);
    }));
    // --- 명령어 등록 ---
    context.subscriptions.push(vscode.commands.registerCommand('labnote.ai.generate', () => {
        vscode.window.showInputBox({
            prompt: '생성할 연구노트의 핵심 내용을 입력하세요.',
            placeHolder: '예: Golden Gate Assembly 이용한 플라스미드 제작'
        }).then(userInput => {
            if (userInput)
                interactiveGenerateFlow(userInput, outputChannel);
        });
    }), vscode.commands.registerCommand('labnote.ai.populateSection', () => populateSectionFlow(context, outputChannel)), vscode.commands.registerCommand('labnote.ai.chat', () => {
        vscode.window.showInputBox({
            prompt: 'AI에게 질문할 내용을 입력하세요.',
            placeHolder: '예: CRISPR-Cas9 시스템에 대해 설명해줘'
        }).then(userInput => {
            if (userInput)
                callChatApi(userInput, outputChannel, null); // Command Palette에서는 대화 ID 없이 호출
        });
    }), vscode.commands.registerCommand('labnote.manager.newWorkflow', async () => {
        try {
            const activeUri = getActiveFileUri();
            if (!activeUri || !logic.isValidReadmePath(activeUri.fsPath)) {
                vscode.window.showErrorMessage("이 명령어는 'labnote/<번호>_주제/README.md' 파일에서만 실행할 수 있습니다.");
                return;
            }
            const customWorkflowsContent = realFsProvider.readTextFile(customWorkflowsPath);
            const workflowItems = logic.parseWorkflows(customWorkflowsContent);
            const selectedWorkflow = await vscode.window.showQuickPick(workflowItems, { placeHolder: "Select a standard workflow" });
            if (!selectedWorkflow)
                return;
            const description = await vscode.window.showInputBox({ prompt: `Enter a specific description for "${selectedWorkflow.label}"` });
            if (description === undefined)
                return;
            const result = logic.createNewWorkflow(realFsProvider, activeUri.fsPath, selectedWorkflow, description);
            const doc = await vscode.workspace.openTextDocument(activeUri);
            const insertPos = findInsertPosBeforeEndMarker(doc, '');
            const we = new vscode.WorkspaceEdit();
            we.insert(activeUri, insertPos, result.textToInsert);
            await vscode.workspace.applyEdit(we);
            await doc.save();
            vscode.window.showInformationMessage(`워크플로 '${path.basename(result.workflowFilePath)}'가 생성되었습니다.`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`[New Workflow] 오류: ${error.message}`);
        }
    }), vscode.commands.registerCommand('labnote.manager.newHwUnitOperation', createUnitOperationCommand(realFsProvider, customHwUoPath)), vscode.commands.registerCommand('labnote.manager.newSwUnitOperation', createUnitOperationCommand(realFsProvider, customSwUoPath)), vscode.commands.registerCommand('labnote.manager.manageTemplates', async () => {
        const template = await vscode.window.showQuickPick(logic.getManagableTemplates({
            workflows: customWorkflowsPath,
            hwUnitOperations: customHwUoPath,
            swUnitOperations: customSwUoPath,
        }), { placeHolder: 'Select a template file to manage' });
        if (!template)
            return;
        const doc = await vscode.workspace.openTextDocument(template.filePath);
        await vscode.window.showTextDocument(doc);
    }), vscode.commands.registerCommand('labnote.manager.insertTable', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const columns = await vscode.window.showInputBox({ prompt: "생성할 표의 열(Column) 개수:", value: '3' });
        if (!columns)
            return;
        const rows = await vscode.window.showInputBox({ prompt: "생성할 표의 행(Row) 개수(헤더 제외):", value: '2' });
        if (!rows)
            return;
        const numCols = parseInt(columns, 10);
        const numRows = parseInt(rows, 10);
        let table = `\n| ${Array(numCols).fill('Header').join(' | ')} |\n`;
        table += `| ${Array(numCols).fill('---').join(' | ')} |\n`;
        for (let i = 0; i < numRows; i++) {
            table += `| ${Array(numCols).fill(' ').join(' | ')} |\n`;
        }
        editor.edit(editBuilder => editBuilder.insert(editor.selection.active, table));
    }), vscode.commands.registerCommand('labnote.manager.reorderWorkflows', async () => {
        const activeUri = getActiveFileUri();
        if (!activeUri || !logic.isValidReadmePath(activeUri.fsPath)) {
            vscode.window.showErrorMessage("이 명령어는 'labnote/<번호>_주제/README.md' 파일에서만 실행할 수 있습니다.");
            return;
        }
        await reorderWorkflowFiles(activeUri.fsPath);
    }), vscode.commands.registerCommand('labnote.manager.reorderLabnotes', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("작업 영역(workspace)이 열려 있어야 합니다.");
            return;
        }
        const labnoteRoot = path.join(workspaceFolders[0].uri.fsPath, 'labnote');
        await reorderLabnoteFolders(labnoteRoot);
    }));
    // --- 🚀 Copilot Chat Participant 등록 ---
    // 1. Chat Participant 핸들러 정의
    const handler = async (request, chatContext, stream, token) => {
        // 2. 사용자의 자연어 프롬프트 분석 및 라우팅
        if (request.command === 'new') { // 예: @labnote /new
            stream.markdown("새로운 연구노트 생성을 시작하겠습니다. 실험의 핵심 주제를 말씀해주세요. (예: `DmpR 센서 라이브러리 제작`)");
            // 향후 이 부분에서 interactiveGenerateFlow 함수를 호출하는 로직으로 발전시킬 수 있습니다.
        }
        else {
            // 일반적인 Q&A 요청 처리
            try {
                stream.progress("LabNote AI 백엔드에 요청 중입니다...");
                // Copilot Chat은 자체적으로 대화 기록을 관리하므로, 백엔드에 conversation_id를 넘겨줄 필요가 없습니다.
                // 매번 새로운 대화로 간주하거나, 필요시 chatContext.history를 활용하여 직접 맥락을 구성할 수 있습니다.
                const response = await callChatApi(request.prompt, outputChannel, null); // 항상 새 대화로 시작
                if (response) {
                    stream.markdown(response.response);
                }
                else {
                    stream.markdown("죄송합니다. AI로부터 응답을 받지 못했습니다.");
                }
            }
            catch (error) {
                const errorMessage = `오류가 발생했습니다: ${error.message}`;
                stream.markdown(errorMessage);
                outputChannel.appendLine(`[Copilot Chat ERROR] ${errorMessage}`);
            }
        }
        return { metadata: { command: request.command || "" } };
    };
    // 3. VSCode에 Chat Participant 등록
    const participant = vscode.chat.createChatParticipant('labnote.participant', handler);
    // 4. 아이콘, 설명 등 추가 설정
    // icon.png가 'vscode-labnote-extension/images/icon.png' 경로에 있다고 가정합니다.
    participant.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'images', 'icon.png'));
    participant.followupProvider = {
        provideFollowups(result, context, token) {
            // 후속 질문 제안
            return [{
                    prompt: '새 연구노트 생성',
                    label: '새 연구노트 생성하기',
                    command: 'new'
                }, {
                    prompt: '현재 실험 주제와 가장 관련있는 SOP 3개를 찾아줘',
                    label: '관련 SOP 검색하기',
                }];
        }
    };
    context.subscriptions.push(participant);
}
function deactivate() { }
// --- Helper Functions ---
// --- 실험 폴더 재정렬 로직 ---
async function reorderLabnoteFolders(labnoteRoot) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "실험 폴더 번호 재정렬 중...",
        cancellable: false
    }, async (progress) => {
        try {
            if (!fs.existsSync(labnoteRoot)) {
                vscode.window.showInformationMessage("'labnote' 폴더를 찾을 수 없습니다.");
                return;
            }
            const entries = fs.readdirSync(labnoteRoot, { withFileTypes: true });
            const labnoteDirs = entries
                .filter(e => e.isDirectory() && /^\d{3}_/.test(e.name))
                .map(e => e.name)
                .sort();
            if (labnoteDirs.length === 0) {
                vscode.window.showInformationMessage("재정렬할 실험 폴더가 없습니다.");
                return;
            }
            progress.report({ increment: 10, message: "폴더 목록 분석 중..." });
            const renames = [];
            let needsReordering = false;
            for (let i = 0; i < labnoteDirs.length; i++) {
                const newIndex = i + 1;
                const newPrefix = String(newIndex).padStart(3, '0');
                const oldDirName = labnoteDirs[i];
                const oldPrefix = oldDirName.substring(0, 3);
                if (oldPrefix !== newPrefix) {
                    needsReordering = true;
                    const restOfDirName = oldDirName.substring(4);
                    const newDirName = `${newPrefix}_${restOfDirName}`;
                    renames.push({
                        oldPath: path.join(labnoteRoot, oldDirName),
                        newPath: path.join(labnoteRoot, newDirName)
                    });
                }
            }
            if (!needsReordering) {
                vscode.window.showInformationMessage("실험 폴더 번호가 이미 순서대로 정렬되어 있습니다.");
                return;
            }
            progress.report({ increment: 30, message: "이름 변경 계획 수립 중..." });
            const edit = new vscode.WorkspaceEdit();
            // 임시 이름으로 먼저 변경 (이름 충돌 방지)
            for (const r of renames) {
                edit.renameFile(vscode.Uri.file(r.oldPath), vscode.Uri.file(r.newPath + '.tmp'), { overwrite: true });
            }
            await vscode.workspace.applyEdit(edit);
            // 최종 이름으로 변경
            const finalEdit = new vscode.WorkspaceEdit();
            for (const r of renames) {
                finalEdit.renameFile(vscode.Uri.file(r.newPath + '.tmp'), vscode.Uri.file(r.newPath), { overwrite: true });
            }
            await vscode.workspace.applyEdit(finalEdit);
            progress.report({ increment: 100 });
            vscode.window.showInformationMessage("실험 폴더 번호 재정렬이 완료되었습니다.");
        }
        catch (error) {
            vscode.window.showErrorMessage(`실험 폴더 재정렬 중 오류 발생: ${error.message}`);
        }
    });
}
function getActiveFileUri() {
    const editor = vscode.window.activeTextEditor;
    if (editor)
        return editor.document.uri;
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const input = activeTab?.input;
    if (input instanceof vscode.TabInputText)
        return input.uri;
    if (input instanceof vscode.TabInputTextDiff)
        return input.modified;
    if (input && typeof input === 'object' && 'uri' in input) {
        return input.uri;
    }
    return null;
}
function findInsertPosBeforeEndMarker(doc, endMarker) {
    for (let i = doc.lineCount - 1; i >= 0; i--) {
        const line = doc.lineAt(i);
        if (line.text.includes(endMarker)) {
            // 주석 바로 앞 빈 줄에 삽입
            if (i > 0 && doc.lineAt(i - 1).isEmptyOrWhitespace) {
                return new vscode.Position(i - 1, 0);
            }
            return new vscode.Position(i, 0);
        }
    }
    // 마커를 찾지 못하면 파일 끝에 추가
    return new vscode.Position(doc.lineCount, 0);
}
function createUnitOperationCommand(fsProvider, uoFilePath) {
    return async () => {
        const activeUri = getActiveFileUri();
        if (!activeUri || !logic.isValidWorkflowPath(activeUri.fsPath)) {
            vscode.window.showErrorMessage("이 명령어는 'labnote' 실험 폴더 내의 워크플로 파일에서만 실행할 수 있습니다.");
            return;
        }
        try {
            const uoContent = fsProvider.readTextFile(uoFilePath);
            const uoItems = logic.parseUnitOperations(uoContent);
            const selectedUo = await vscode.window.showQuickPick(uoItems, { placeHolder: "Select a Unit Operation" });
            if (!selectedUo)
                return;
            const userDescription = await vscode.window.showInputBox({ prompt: `Enter a specific description for "${selectedUo.name}"` });
            if (userDescription === undefined)
                return;
            const workflowDir = path.dirname(activeUri.fsPath);
            const readmePath = path.join(workflowDir, 'README.md');
            let experimenter = '';
            if (fsProvider.exists(readmePath)) {
                const readmeContent = fsProvider.readTextFile(readmePath);
                const parsedFrontMatter = logic.parseReadmeFrontMatter(readmeContent);
                experimenter = parsedFrontMatter?.author || '';
            }
            const textToInsert = logic.createUnitOperationContent(selectedUo, userDescription, new Date(), experimenter);
            const wfDoc = await vscode.workspace.openTextDocument(activeUri);
            const pos = findInsertPosBeforeEndMarker(wfDoc, 'UNITOPERATION_LIST_END');
            const we = new vscode.WorkspaceEdit();
            we.insert(activeUri, pos, textToInsert);
            await vscode.workspace.applyEdit(we);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error creating Unit Operation: ${error.message}`);
        }
    };
}
async function reorderWorkflowFiles(readmePath) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "워크플로우 번호 재정렬 중...",
        cancellable: false
    }, async (progress) => {
        try {
            const dir = path.dirname(readmePath);
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const workflowFiles = entries
                .filter(e => !e.isDirectory() && /^\d{3}_.+\.md$/.test(e.name))
                .map(e => e.name)
                .sort();
            if (workflowFiles.length === 0) {
                vscode.window.showInformationMessage("재정렬할 워크플로우 파일이 없습니다.");
                return;
            }
            progress.report({ increment: 10, message: "파일 목록 분석 중..." });
            const edit = new vscode.WorkspaceEdit();
            const renameQueue = [];
            let needsReordering = false;
            for (let i = 0; i < workflowFiles.length; i++) {
                const newIndex = i + 1;
                const newPrefix = String(newIndex).padStart(3, '0');
                const oldFileName = workflowFiles[i];
                const oldPrefix = oldFileName.substring(0, 3);
                if (oldPrefix !== newPrefix) {
                    needsReordering = true;
                    const restOfFileName = oldFileName.substring(4);
                    const newFileName = `${newPrefix}_${restOfFileName}`;
                    renameQueue.push({
                        oldPath: path.join(dir, oldFileName),
                        newPath: path.join(dir, newFileName)
                    });
                }
            }
            if (!needsReordering) {
                vscode.window.showInformationMessage("워크플로우 번호가 이미 순서대로 정렬되어 있습니다.");
                return;
            }
            progress.report({ increment: 30, message: "이름 변경 계획 수립 중..." });
            // 임시 이름으로 먼저 변경하여 이름 충돌 방지
            const tempRenameQueue = renameQueue.map(item => ({
                oldUri: vscode.Uri.file(item.oldPath),
                newUri: vscode.Uri.file(item.newPath + ".tmp")
            }));
            for (const item of tempRenameQueue) {
                edit.renameFile(item.oldUri, item.newUri, { overwrite: true });
            }
            await vscode.workspace.applyEdit(edit);
            // 실제 이름으로 변경
            const finalEdit = new vscode.WorkspaceEdit();
            const finalRenameQueue = renameQueue.map(item => ({
                oldUri: vscode.Uri.file(item.newPath + ".tmp"),
                newUri: vscode.Uri.file(item.newPath)
            }));
            for (const item of finalRenameQueue) {
                finalEdit.renameFile(item.oldUri, item.newUri, { overwrite: true });
            }
            await vscode.workspace.applyEdit(finalEdit);
            progress.report({ increment: 70, message: "README.md 링크 업데이트 중..." });
            // README.md 업데이트
            const readmeUri = vscode.Uri.file(readmePath);
            const readmeDoc = await vscode.workspace.openTextDocument(readmeUri);
            let readmeContent = readmeDoc.getText();
            for (const item of renameQueue) {
                const oldBase = path.basename(item.oldPath);
                const newBase = path.basename(item.newPath);
                const oldPrefix = oldBase.substring(0, 3);
                const newPrefix = newBase.substring(0, 3);
                // 정규표현식을 사용하여 링크와 텍스트를 동시에 업데이트
                // 예: [ ] [002 ...](./002_...) -> [ ] [001 ...](./001_...)
                const regex = new RegExp(`(\\[ \\] \\[)${oldPrefix}(.*?\\].*?\\s*\\()\\.\\/${oldBase}(\\))`, "g");
                readmeContent = readmeContent.replace(regex, `$1${newPrefix}$2./${newBase}$3`);
            }
            const fullRange = new vscode.Range(readmeDoc.positionAt(0), readmeDoc.positionAt(readmeContent.length));
            const readmeEdit = new vscode.WorkspaceEdit();
            readmeEdit.replace(readmeUri, fullRange, readmeContent);
            await vscode.workspace.applyEdit(readmeEdit);
            await readmeDoc.save();
            progress.report({ increment: 100 });
            vscode.window.showInformationMessage("워크플로우 번호 재정렬이 완료되었습니다.");
        }
        catch (error) {
            vscode.window.showErrorMessage(`재정렬 중 오류 발생: ${error.message}`);
        }
    });
}
// --- AI Feature Implementations ---
async function interactiveGenerateFlow(userInput, outputChannel) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "LabNote AI 분석 중...",
        cancellable: true
    }, async (progress) => {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage("실험 노트를 생성하려면 먼저 작업 영역(workspace)을 열어주세요.");
                return;
            }
            const rootPath = workspaceFolders[0].uri.fsPath;
            const labnoteRoot = path.join(rootPath, 'labnote');
            if (!fs.existsSync(labnoteRoot))
                fs.mkdirSync(labnoteRoot);
            const entries = fs.readdirSync(labnoteRoot, { withFileTypes: true });
            const existingDirs = entries.filter(e => e.isDirectory() && /^\d{3}_/.test(e.name)).map(e => parseInt(e.name.substring(0, 3), 10));
            const nextId = existingDirs.length > 0 ? Math.max(...existingDirs) + 1 : 1;
            const formattedId = nextId.toString().padStart(3, '0');
            const safeTitle = userInput.replace(/\s+/g, '_');
            const newDirName = `${formattedId}_${safeTitle}`;
            const newDirPath = path.join(labnoteRoot, newDirName);
            fs.mkdirSync(newDirPath, { recursive: true });
            fs.mkdirSync(path.join(newDirPath, 'images'), { recursive: true });
            fs.mkdirSync(path.join(newDirPath, 'resources'), { recursive: true });
            outputChannel.appendLine(`[Info] Created new experiment folder: ${newDirPath}`);
            progress.report({ increment: 10, message: "실험 구조 분석 중..." });
            const config = vscode.workspace.getConfiguration('labnote.ai');
            const baseUrl = config.get('backendUrl');
            if (!baseUrl)
                throw new Error("Backend URL이 설정되지 않았습니다.");
            const { ALL_WORKFLOWS, ALL_UOS } = await fetchConstants(baseUrl, outputChannel);
            const finalWorkflowId = await showWorkflowSelectionMenu(ALL_WORKFLOWS);
            if (!finalWorkflowId)
                return;
            const finalUoIds = await showUnifiedUoSelectionMenu(ALL_UOS, []);
            if (!finalUoIds || finalUoIds.length === 0)
                return;
            progress.report({ increment: 60, message: "연구노트 및 워크플로우 파일 생성 중..." });
            const createScaffoldResponse = await fetch(`${baseUrl}/create_scaffold`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: userInput, workflow_id: finalWorkflowId, unit_operation_ids: finalUoIds, experimenter: "AI Assistant" }),
            });
            if (!createScaffoldResponse.ok)
                throw new Error(`뼈대 생성 실패 (HTTP ${createScaffoldResponse.status}): ${await createScaffoldResponse.text()}`);
            const scaffoldData = await createScaffoldResponse.json();
            progress.report({ increment: 90, message: "파일 저장 및 표시 중..." });
            for (const fileName in scaffoldData.files) {
                const content = scaffoldData.files[fileName];
                const filePath = path.join(newDirPath, fileName);
                fs.writeFileSync(filePath, content);
                outputChannel.appendLine(`[Success] Created file: ${filePath}`);
            }
            const readmePath = path.join(newDirPath, 'README.md');
            const doc = await vscode.workspace.openTextDocument(readmePath);
            await vscode.window.showTextDocument(doc, { preview: false });
            vscode.window.showInformationMessage(`연구노트 '${newDirName}' 및 관련 워크플로우 파일들이 생성되었습니다.`);
        }
        catch (error) {
            vscode.window.showErrorMessage('LabNote AI 작업 중 오류가 발생했습니다: ' + error.message);
            outputChannel.appendLine(`[ERROR] ${error.message}`);
        }
    });
}
// ⭐️ 변경점: 약관 동의 및 새로운 Webview 플로우 적용
async function populateSectionFlow(extensionContext, outputChannel) {
    // 1. 약관 동의 확인
    const consent = extensionContext.globalState.get('labnoteAiConsent');
    if (consent !== 'given') {
        const selection = await vscode.window.showInformationMessage('LabNote AI 성능 향상을 위해, 사용자가 선택하고 수정한 내용을 익명화하여 모델 학습에 사용합니다. 이에 동의하십니까? 자세한 내용은 프로젝트 README의 "데이터 활용 및 저작권 정책"을 참고해주세요.', { modal: true }, '동의', '거부');
        if (selection === '동의') {
            await extensionContext.globalState.update('labnoteAiConsent', 'given');
        }
        else {
            await extensionContext.globalState.update('labnoteAiConsent', 'denied');
            vscode.window.showInformationMessage("AI 기능 사용에 동의하지 않으셨습니다. '섹션 내용 채우기' 기능은 비활성화됩니다.");
            return;
        }
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("활성화된 에디터가 없습니다.");
        return;
    }
    try {
        const sectionContext = findSectionContext(editor.document, editor.selection.active);
        if (!sectionContext) {
            vscode.window.showErrorMessage("현재 커서가 위치한 곳에서 채울 수 있는 Unit Operation 섹션(과 플레이스홀더)을 찾을 수 없습니다.");
            return;
        }
        const { uoId, section, query, fileContent, placeholderRange } = sectionContext;
        outputChannel.appendLine(`[Action] Populate section request for UO '${uoId}', Section '${section}'`);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `LabNote AI: '${section}' 섹션 생성 중...`,
            cancellable: true
        }, async (progress) => {
            progress.report({ increment: 20, message: "AI 에이전트 팀 호출 중..." });
            const config = vscode.workspace.getConfiguration('labnote.ai');
            const baseUrl = config.get('backendUrl');
            if (!baseUrl)
                throw new Error("Backend URL이 설정되지 않았습니다.");
            const populateResponse = await fetch(`${baseUrl}/populate_note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_content: fileContent, uo_id: uoId, section, query })
            });
            if (!populateResponse.ok) {
                throw new Error(`AI 초안 생성 실패 (HTTP ${populateResponse.status}): ${await populateResponse.text()}`);
            }
            const populateData = await populateResponse.json();
            if (!populateData.options || populateData.options.length === 0) {
                vscode.window.showInformationMessage("AI가 생성한 초안이 없습니다.");
                return;
            }
            const panel = createPopulateWebviewPanel(section, populateData.options);
            panel.webview.onDidReceiveMessage(async (message) => {
                if (message.command === 'applyAndLearn') {
                    const { chosen_original, chosen_edited } = message;
                    // 사용자가 선택하지 않은 나머지 옵션들을 'rejected'로 구성
                    const rejectedOptions = populateData.options.filter(opt => opt !== chosen_original);
                    // 1. 에디터에 수정된 내용 적용
                    await editor.edit(editBuilder => {
                        editBuilder.replace(placeholderRange, chosen_edited);
                    });
                    // 2. DPO 데이터 전송
                    fetch(`${baseUrl}/record_preference`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            uo_id: uoId,
                            section,
                            chosen_original,
                            chosen_edited,
                            rejected: rejectedOptions,
                            query,
                            file_content: editor.document.getText()
                        })
                    }).catch((err) => {
                        outputChannel.appendLine(`[WARN] DPO 데이터 기록 실패: ${err.message}`);
                    });
                    vscode.window.showInformationMessage(`'${section}' 섹션이 업데이트되었고, AI가 사용자의 수정을 학습합니다.`);
                    panel.dispose();
                }
            }, undefined, extensionContext.subscriptions);
        });
    }
    catch (error) {
        vscode.window.showErrorMessage(`LabNote AI 작업 중 오류 발생: ${error.message}`);
        outputChannel.appendLine(`[ERROR] ${error.message}`);
    }
}
async function callChatApi(userInput, outputChannel, conversationId) {
    // withProgress가 Promise를 반환하므로, 이를 직접 반환하거나 await 할 수 있습니다.
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "LabNote AI가 응답 중입니다...",
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ increment: 20, message: "AI에게 질문하는 중..." });
            const config = vscode.workspace.getConfiguration('labnote.ai');
            const baseUrl = config.get('backendUrl');
            if (!baseUrl)
                throw new Error("Backend URL이 설정되지 않았습니다.");
            const response = await fetch(`${baseUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: userInput,
                    conversation_id: conversationId
                }),
            });
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`채팅 실패 (HTTP ${response.status}): ${errorBody}`);
            }
            const chatData = await response.json();
            if (conversationId === null) {
                const doc = await vscode.workspace.openTextDocument({
                    content: `# AI 답변: ${userInput}\n\n---\n\n${chatData.response}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc, { preview: false });
            }
            return chatData; // 성공 시 데이터 반환
        }
        catch (error) {
            vscode.window.showErrorMessage('LabNote AI와 대화 중 오류가 발생했습니다.');
            outputChannel.appendLine(`[ERROR] ${error.message}`);
            return null; // 오류 발생 시 null 반환
        }
    });
}
// --- Webview and Context Finding Functions ---
// ⭐️ 변경점: 수정 기능을 포함하는 새로운 Webview HTML 생성
function createPopulateWebviewPanel(section, options) {
    const panel = vscode.window.createWebviewPanel('labnoteAiPopulate', `AI 제안: ${section}`, vscode.ViewColumn.Beside, {
        enableScripts: true,
        // Webview가 닫혀도 상태를 유지하도록 설정
        retainContextWhenHidden: true
    });
    panel.webview.html = getWebviewContent(section, options);
    return panel;
}
// ⭐️ 변경점: Webview 콘텐츠를 수정 기능에 맞게 대폭 수정
function getWebviewContent(section, options) {
    const optionCards = options.map((option, index) => {
        // HTML 렌더링을 위해 특수 문자를 이스케이프하고, 내용을 base64로 인코딩하여 데이터 속성에 저장
        const escapedOption = option.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const encodedOption = Buffer.from(option).toString('base64');
        return `<div class="option-card" data-index="${index}" data-original-content="${encodedOption}">
                    <pre><code>${escapedOption}</code></pre>
                </div>`;
    }).join('');
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AI 제안: ${section}</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 1em; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
            h1, p { text-align: center; }
            #options-container { margin-bottom: 2em; }
            .option-card { border: 1px solid var(--vscode-editorWidget-border, #454545); border-radius: 5px; padding: 1em; margin-bottom: 1em; cursor: pointer; transition: all 0.2s ease-in-out; }
            .option-card:hover { border-color: var(--vscode-focusBorder, #007ACC); }
            .option-card.selected { border: 2px solid var(--vscode-focusBorder, #007ACC); box-shadow: 0 0 8px var(--vscode-focusBorder, #007ACC)66; }
            pre { white-space: pre-wrap; word-wrap: break-word; background-color: var(--vscode-editor-background); padding: 10px; border-radius: 4px; }
            #editor-section { display: none; }
            textarea { width: 100%; height: 250px; box-sizing: border-box; background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 5px; padding: 10px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
            button { padding: 10px 15px; border: none; background-color: var(--vscode-button-background, #0E639C); color: var(--vscode-button-foreground, #FFFFFF); border-radius: 5px; cursor: pointer; font-size: 1em; width: 100%; margin-top: 1em; }
            button:hover { background-color: var(--vscode-button-hoverBackground, #1177BB); }
        </style>
    </head>
    <body>
        <h1>"${section}" 섹션에 대한 AI 제안</h1>
        <p>1. 아래 제안 중 하나를 선택한 후, 2. 필요시 내용을 수정하고, 3. '적용 및 AI 학습' 버튼을 누르세요.</p>
        
        <div id="options-container">${optionCards}</div>

        <div id="editor-section">
            <h2>수정 창</h2>
            <textarea id="editor-textarea"></textarea>
            <button id="apply-btn">적용 및 AI 학습</button>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const cards = document.querySelectorAll('.option-card');
            const editorSection = document.getElementById('editor-section');
            const editorTextarea = document.getElementById('editor-textarea');
            const applyBtn = document.getElementById('apply-btn');
            
            let selectedOriginalContent = '';

            cards.forEach(card => {
                card.addEventListener('click', () => {
                    // 이전에 선택된 카드 스타일 초기화
                    cards.forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');

                    // base64로 인코딩된 원본 내용을 디코딩하여 textarea에 설정
                    selectedOriginalContent = atob(card.dataset.originalContent);
                    editorTextarea.value = selectedOriginalContent;
                    
                    // 수정 창 표시
                    editorSection.style.display = 'block';
                });
            });

            applyBtn.addEventListener('click', () => {
                const editedContent = editorTextarea.value;
                if (selectedOriginalContent) {
                    vscode.postMessage({ 
                        command: 'applyAndLearn', 
                        chosen_original: selectedOriginalContent,
                        chosen_edited: editedContent
                    });
                }
            });
        </script>
    </body>
    </html>`;
}
function findSectionContext(document, position) {
    let currentSection = "";
    let currentUoId = "";
    let sectionLineNum = -1;
    for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text;
        const sectionMatch = lineText.match(/^####\s*([A-Za-z\s&]+)/);
        if (sectionMatch) {
            currentSection = sectionMatch[1].trim();
            sectionLineNum = i;
            break;
        }
    }
    if (!currentSection)
        return null;
    for (let i = sectionLineNum - 1; i >= 0; i--) {
        const lineText = document.lineAt(i).text;
        const uoMatch = lineText.match(/^###\s*\[(U[A-Z]{2,3}\d{3})/);
        if (uoMatch) {
            currentUoId = uoMatch[1];
            break;
        }
    }
    if (!currentUoId)
        return null;
    const placeholderRegex = /^\s*(-\s*)?\(.*\)\s*$/;
    let placeholderRange = null;
    for (let i = sectionLineNum + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        if (line.text.startsWith('###') || line.text.startsWith('####')) {
            break;
        }
        if (placeholderRegex.test(line.text)) {
            placeholderRange = line.range;
            break;
        }
    }
    if (!placeholderRange)
        return null;
    const text = document.getText();
    const yamlMatch = text.match(/^---\s*[\r\n]+title:\s*["']?(.*?)["']?[\r\n]+/);
    const query = yamlMatch ? yamlMatch[1].replace(/\[AI Generated\]\s*/, '').trim() : "Untitled Experiment";
    return { uoId: currentUoId, section: currentSection, query, fileContent: text, placeholderRange };
}
// --- Menu Functions ---
async function fetchConstants(baseUrl, outputChannel) {
    try {
        const response = await fetch(`${baseUrl}/constants`);
        if (!response.ok) {
            throw new Error(`상수 fetch 실패 (HTTP ${response.status})`);
        }
        return await response.json();
    }
    catch (e) {
        outputChannel.appendLine(`[Error] 백엔드에서 상수를 가져올 수 없습니다: ${e.message}. 로컬 폴백을 사용합니다.`);
        return {
            ALL_WORKFLOWS: { "WD070": "Vector Design" },
            ALL_UOS: { "UHW400": "Manual" }
        };
    }
}
async function showWorkflowSelectionMenu(workflows) {
    const allWorkflowItems = Object.keys(workflows).map(id => ({ id, label: `[${id}]`, description: workflows[id] }));
    const selectedItem = await vscode.window.showQuickPick(allWorkflowItems, { title: '워크플로우 선택', matchOnDescription: true, placeHolder: '이름이나 ID로 검색...' });
    return selectedItem?.id;
}
async function showUnifiedUoSelectionMenu(uos, recommendedIds) {
    const recommendedSet = new Set(recommendedIds);
    const allUoItems = Object.keys(uos).map(id => ({ id, label: `[${id}]`, description: uos[id], picked: recommendedSet.has(id) }));
    allUoItems.sort((a, b) => {
        const aIsRecommended = recommendedSet.has(a.id);
        const bIsRecommended = recommendedSet.has(b.id);
        if (aIsRecommended && !bIsRecommended)
            return -1;
        if (!bIsRecommended && aIsRecommended)
            return 1;
        return a.id.localeCompare(b.id);
    });
    const selectedItems = await vscode.window.showQuickPick(allUoItems, {
        title: 'Unit Operation 선택 (AI 추천 항목이 미리 선택됨)',
        canPickMany: true,
        matchOnDescription: true,
        placeHolder: '체크박스를 클릭하여 선택/해제 후 Enter',
    });
    return selectedItems?.map(item => item.id);
}
//# sourceMappingURL=extension.js.map