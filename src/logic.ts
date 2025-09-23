import * as yaml from 'js-yaml';
import * as path from 'path';
import { FileSystemProvider, FsDirent } from './fileSystemProvider';

// 모듈 레벨 변수로 defaultExperimenter 관리
let defaultExperimenter: string = '';

export function setDefaultExperimenter(author: string): void {
    defaultExperimenter = author;
}

export function getDefaultExperimenter(): string {
    return defaultExperimenter;
}

export interface WorkflowFrontMatter {
    title: string;
    experimenter: string;
    created_date: string;
    last_updated_date: string;
}

export interface ParsedWorkflow {
    id: string;
    name: string;
    description: string;
    label: string;
}

export interface ReadmeFrontMatter {
    title: string;
    author: string;
    experiment_type: string;
    created_date: string;
    last_updated_date: string;
    description?: string;
}

function getSeoulDateString(date: Date): string {
    // Returns YYYY-MM-DD in Asia/Seoul timezone
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function getSeoulDateTimeString(date: Date): string {
    // Returns YYYY-MM-DD HH:mm in Asia/Seoul timezone (24h)
    const datePart = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
    const timePart = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
    return `${datePart} ${timePart}`;
}

function getFormattedDate(date: Date): string {
    return getSeoulDateString(date);
}

/**
 * 디렉토리 내의 'XXX_' 형태의 파일/폴더 번호를 분석하여
 * 사용 가능한 다음 번호를 찾아 반환합니다. (예: 001, 003이 있으면 002 반환)
 */
function getNextAvailableIndex(existingItems: string[]): number {
    const existingIndexes = existingItems
        .map(item => parseInt(item.substring(0, 3), 10))
        .filter(num => !isNaN(num))
        .sort((a, b) => a - b);

    let nextIndex = 1;
    for (const index of existingIndexes) {
        if (index === nextIndex) {
            nextIndex++;
        } else {
            break;
        }
    }
    return nextIndex;
}


export function createNewLabnote(provider: FileSystemProvider, workspaceRoot: string, experimentTitle: string) {
    if (!experimentTitle) {
        throw new Error("Experiment title cannot be empty.");
    }
    const labnoteRoot = path.join(workspaceRoot, 'labnote');
    if (!provider.exists(labnoteRoot)) provider.mkdir(labnoteRoot);

    const entries = provider.readDir(labnoteRoot);
    const existingDirs = entries.filter(e => e.isDirectory() && /^\d{3}_/.test(e.name)).map(e => e.name);

    const nextId = getNextAvailableIndex(existingDirs);
    const formattedId = nextId.toString().padStart(3, '0');
    const safeTitle = experimentTitle.replace(/\s+/g, '_');
    const newDirName = `${formattedId}_${safeTitle}`;
    const newDirPath = path.join(labnoteRoot, newDirName);

    provider.mkdir(path.join(newDirPath, 'images'));
    provider.mkdir(path.join(newDirPath, 'resources'));

    const formattedDate = getFormattedDate(new Date());
    const readmeFrontMatter: ReadmeFrontMatter = {
        title: experimentTitle,
        author: '',
        experiment_type: 'labnote',
        created_date: formattedDate,
        last_updated_date: formattedDate,
    };

    const yamlText = yaml.dump(readmeFrontMatter, { sortKeys: false, lineWidth: -1 });
    const readmeContent = `---\n${yamlText}---\n\n## 🎯 실험 목표\n> 이 실험의 주된 목표와 가설을 간략하게 작성합니다.\n\n## 🗂️ 관련 워크플로\n\n> 아래 표시 사이에 관련된 워크플로 파일 목록을 입력합니다.\n> \`F1\`, \`New workflow\` 명령 수행시 해당 목록은 표시된 위치 사이에 자동 추가됩니다.\n> 위 YAML 블록의 author: 항목에 입력된 이름은 워크플로와 유닛오퍼레이션 생성시 실험자 이름으로 자동 입력됩니다.\n\n\n\n\n`;

    const newReadmePath = path.join(newDirPath, 'README.md');
    provider.writeTextFile(newReadmePath, readmeContent);

    const parsedFrontMatter = parseReadmeFrontMatter(readmeContent);
    const globalAuthor = parsedFrontMatter?.author || '';
    setDefaultExperimenter(globalAuthor);

    return { newReadmePath, newDirName };
}


export function createNewWorkflow(provider: FileSystemProvider, readmePath: string, selectedWorkflow: ParsedWorkflow, description: string) {
    const today = new Date();
    const safeName = selectedWorkflow.name.replace(/\s+/g, '_');
    const safeDescription = description.replace(/\s+/g, '_');
    const currentDir = path.dirname(readmePath);

    const entries = provider.readDir(currentDir);
    const existingWfFiles = entries
        .filter((e: FsDirent) => !e.isDirectory() && /^\d{3}_.+\.md$/i.test(e.name))
        .map((e: FsDirent) => e.name);
        
    const nextSeq = getNextAvailableIndex(existingWfFiles);
    const seqString = String(nextSeq).padStart(3, '0');
    const workflowFileName = `${seqString}_${selectedWorkflow.id}_${safeName}${description ? '--' + safeDescription : ''}.md`;
    const workflowFilePath = path.join(currentDir, workflowFileName);

    let experimenter = '';
    try {
        const readmeContent = provider.readTextFile(readmePath);
        const parsedFrontMatter = parseReadmeFrontMatter(readmeContent);
        experimenter = parsedFrontMatter?.author || '';
    } catch (error) {
        experimenter = '';
    }

    const workflowContent = createWorkflowFileContent(selectedWorkflow, description, today, experimenter);
    provider.writeTextFile(workflowFilePath, workflowContent);

    const linkText = `${seqString} ${selectedWorkflow.id} ${selectedWorkflow.name}${description ? ' - ' + description : ''}`;
    const textToInsert = `[ ] [${linkText}](./${workflowFileName})\n`;

    return { workflowFilePath, textToInsert };
}

export function isValidReadmePath(filePath: string): boolean {
    if (path.basename(filePath).toLowerCase() !== 'readme.md') {
        return false;
    }
    try {
        const dirPath = path.dirname(filePath);
        const experimentDirName = path.basename(dirPath);

        const labnoteDirPath = path.dirname(dirPath);
        const labnoteDirName = path.basename(labnoteDirPath);

        const isLabnoteDir = labnoteDirName.toLowerCase() === 'labnote';
        const hasCorrectPrefix = /^\d{3}_/.test(experimentDirName);

        return isLabnoteDir && hasCorrectPrefix;
    } catch (e: unknown) {
        return false;
    }
}

export function isValidWorkflowPath(filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();
    if (!filePath.toLowerCase().endsWith('.md') || base === 'readme.md') {
        return false;
    }
    try {
        const dirPath = path.dirname(filePath);
        const experimentDirName = path.basename(dirPath);

        const labnoteDirPath = path.dirname(dirPath);
        const labnoteDirName = path.basename(labnoteDirPath);

        return labnoteDirName.toLowerCase() === 'labnote' && /^\d{3}_/.test(experimentDirName);
    } catch (e) {
        return false;
    }
}

export function parseWorkflows(content: string): ParsedWorkflow[] {
    const workflows: ParsedWorkflow[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\s*-\s*\*\*(.*?)\*\*:\s*(.*)/);
        if (match) {
            const id = match[1];
            const name = match[2].trim();
            const description = (lines[i + 1] || '').trim().replace(/^- /, '');
            workflows.push({ id, name, description, label: `${id}: ${name}` });
        }
    }
    return workflows;
}

export function createWorkflowFileContent(workflow: ParsedWorkflow, userDescription: string, date: Date, experimenter: string): string {
    const formattedDate = getFormattedDate(date);
    const title = `${workflow.id} ${workflow.name}${userDescription ? ` - ${userDescription}` : ''}`;

    const frontMatter: WorkflowFrontMatter = {
        title: title,
        experimenter: experimenter,
        created_date: formattedDate,
        last_updated_date: formattedDate
    };

    const yamlText = yaml.dump(frontMatter, { sortKeys: false, lineWidth: -1 });

    const bodyTitle = `## [${workflow.id} ${workflow.name}]${userDescription ? ` ${userDescription}` : ''}`;

    const bodyDescription = `> 이 워크플로의 설명을 간략하게 작성합니다 (아래 설명은 템플릿으로 사용자 목적에 맞도록 수정합니다)\n> ${workflow.description}`;

    const unitOperationSection = `## 🗂️ 관련 유닛오퍼레이션\n> 관련된 유닛오퍼레이션 목록을 아래 표시 사이에 입력합니다.\n> \`F1\`, \`New HW/SW Unit Operation\` 명령 수행시 해당 목록은 표시된 위치 사이에 자동 추가됩니다.\n\n\n\n`;

    return `---\n${yamlText}---\n\n${bodyTitle}\n${bodyDescription}\n\n${unitOperationSection}\n`;
}


export function parseWorkflowFrontMatter(fileContent: string): WorkflowFrontMatter | null {
    const match = fileContent.match(/^---([\s\S]+?)---/);
    if (!match) return null;
    try {
        const parsed = yaml.load(match[1]) as WorkflowFrontMatter;
        return (parsed && typeof parsed.title === 'string') ? parsed : null;
    } catch (e) {
        return null;
    }
}

export function parseReadmeFrontMatter(fileContent: string): ReadmeFrontMatter | null {
    const match = fileContent.match(/^---([\s\S]+?)---/);
    if (!match) return null;
    try {
        const parsed = yaml.load(match[1]) as ReadmeFrontMatter;
        return (parsed && typeof parsed.title === 'string' && typeof parsed.experiment_type === 'string') ? parsed : null;
    } catch (e) {
        return null;
    }
}

export function createUnitOperationContent(selectedUo: ParsedUnitOperation, userDescription: string, date: Date, experimenter?: string): string {
    const formattedDateTime = getSeoulDateTimeString(date);
    const descriptionPart = userDescription ? ` ${userDescription}` : '';
    const uoDescriptionLine = selectedUo.description ? `\n\n- **Description**: ${selectedUo.description}` : '';

    const finalExperimenter = experimenter !== undefined ? experimenter : getDefaultExperimenter();

    return `\n\n### [${selectedUo.id} ${selectedUo.name}${descriptionPart}]${uoDescriptionLine}\n\n#### Meta\n- Experimenter: ${finalExperimenter}\n- Start_date: '${formattedDateTime}'\n- End_date: ''\n\n#### Input\n- (samples from the previous step)\n\n#### Reagent\n- (e.g. enzyme, buffer, etc.)\n\n#### Consumables\n- (e.g. filter, well-plate, etc.)\n\n#### Equipment\n- (e.g. centrifuge, spectrophotometer, etc.)\n\n#### Method\n- (method used in this step)\n\n#### Output\n- (samples to the next step)\n\n#### Results & Discussions\n- (Any results and discussions. Link file path if needed)\n\n`;
}

export interface ParsedUnitOperation {
    id: string;
    name: string;
    software: string;
    description: string;
    label: string;
}

export function parseUnitOperations(content: string): ParsedUnitOperation[] {
    const unitOperations: ParsedUnitOperation[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const nameMatch = lines[i].match(/^\s*-\s*\*\*((?:USW|UHW|US|UH)\d+)\*\*:\s*(.*)/);
        if (nameMatch) {
            const id = nameMatch[1];
            const name = nameMatch[2].trim();

            let software = '';
            if (i + 1 < lines.length) {
                const softwareMatch = lines[i + 1].match(/^\s+-\s+\*\*Software\*\*:\s*(.*)/);
                if (softwareMatch) {
                    software = softwareMatch[1].trim();
                }
            }

            let description = '';
            if (i + 2 < lines.length) {
                const descriptionMatch = lines[i + 2].match(/^\s+-\s+\*\*Description\*\*:\s*(.*)/);
                if (descriptionMatch) {
                    description = descriptionMatch[1].trim();
                }
            }

            unitOperations.push({
                id,
                name,
                software,
                description,
                label: `${id}: ${name}`
            });
        }
    }
    return unitOperations;
}

export interface ManagableTemplate {
    label: string;
    description: string;
    filePath: string;
}

export function getManagableTemplates(paths: { [key: string]: string }): ManagableTemplate[] {
    return [
        {
            label: 'Workflows',
            description: 'Manage the list of standard workflows',
            filePath: paths.workflows,
        },
        {
            label: 'HW Unit Operations',
            description: 'Manage the list of hardware unit operations',
            filePath: paths.hwUnitOperations,
        },
        {
            label: 'SW Unit Operations',
            description: 'Manage the list of software unit operations',
            filePath: paths.swUnitOperations,
        },
    ];
}