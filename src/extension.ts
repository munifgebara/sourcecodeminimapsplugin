import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { PNG } from 'pngjs';

const ENDPOINT = 'http://98.85.228.131:8000/api/v1/analyze/image';
const API_KEY = 'm1n1m4p-pesquisa-2025';

const IMAGE_WIDTH = 128;
const IMAGE_HEIGHT = 128;
const UNKNOWN_PROJECT_NAME = 'UNKNOW';

const SAVE_MINIMAP_IMAGES_FOR_DEVELOPMENT = true;


type ApiPrediction = {
    class: string;
    confidence: number;
};

type ApiPredictionGroup = {
    target: string;
    predictions: ApiPrediction[];
};

type ApiResponse = {
    hash: string;
    predict: ApiPredictionGroup[];
};

export function activate(context: vscode.ExtensionContext): void {
    const analyzeCurrentFileCommand = vscode.commands.registerCommand(
        'sourcecodeminimapsplugin.analyzeCurrentFile',
        analyzeCurrentFile
    );

    context.subscriptions.push(analyzeCurrentFileCommand);
}

export function deactivate(): void {}


async function showAnalysisResult(result: {
    projectName: string;
    relativePath: string;
    fileHash: string;
    apiResponse: ApiResponse;
}): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'sourceCodeMinimapsResult',
        'SourceCodeMinimaps Result',
        vscode.ViewColumn.Beside,
        {
            enableScripts: false
        }
    );

    panel.webview.html = buildAnalysisResultHtml(result);
}

function buildAnalysisResultHtml(result: {
    projectName: string;
    relativePath: string;
    fileHash: string;
    apiResponse: ApiResponse;
}): string {
    const groupsHtml = result.apiResponse.predict.map(group => {
        const predictionsHtml = group.predictions.map(prediction => {
            const percent = (prediction.confidence * 100).toFixed(2);

            return `
                <div class="prediction-row">
                    <span class="class-name">${escapeHtml(prediction.class)}</span>
                    <span class="confidence">${percent}%</span>
                </div>
                <div class="bar">
                    <div class="bar-fill" style="width: ${percent}%"></div>
                </div>
            `;
        }).join('');

        return `
            <section class="card">
                <h2>${escapeHtml(group.target)}</h2>
                ${predictionsHtml}
            </section>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    padding: 24px;
                }

                h1 {
                    margin-top: 0;
                    font-size: 22px;
                }

                .meta {
                    padding: 14px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 10px;
                    margin-bottom: 18px;
                    background: var(--vscode-sideBar-background);
                }

                .meta div {
                    margin: 6px 0;
                }

                .grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                    gap: 16px;
                }

                .card {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 12px;
                    padding: 16px;
                    background: var(--vscode-sideBar-background);
                }

                .card h2 {
                    margin-top: 0;
                    text-transform: capitalize;
                    font-size: 18px;
                }

                .prediction-row {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 12px;
                    font-size: 14px;
                }

                .class-name {
                    font-weight: 600;
                }

                .confidence {
                    opacity: 0.85;
                }

                .bar {
                    height: 8px;
                    border-radius: 999px;
                    background: var(--vscode-editorWidget-background);
                    overflow: hidden;
                    margin-top: 5px;
                }

                .bar-fill {
                    height: 100%;
                    background: var(--vscode-progressBar-background);
                }

                code {
                    word-break: break-all;
                }
            </style>
        </head>
        <body>
            <h1>SourceCodeMinimaps Analysis</h1>

            <div class="meta">
                <div><strong>Project:</strong> ${escapeHtml(result.projectName)}</div>
                <div><strong>File:</strong> <code>${escapeHtml(result.relativePath)}</code></div>
                <div><strong>MD5:</strong> <code>${escapeHtml(result.fileHash)}</code></div>
                <div><strong>Returned hash:</strong> <code>${escapeHtml(result.apiResponse.hash)}</code></div>
            </div>

            <div class="grid">
                ${groupsHtml}
            </div>
        </body>
        </html>
    `;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function saveMinimapImageForDevelopment(
    fileHash: string,
    pngBuffer: Buffer
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
        return;
    }

    const outputFolderUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        'sourcecodeminimaps'
    );

    await vscode.workspace.fs.createDirectory(outputFolderUri);

    const outputFileUri = vscode.Uri.joinPath(
        outputFolderUri,
        `${fileHash}.png`
    );

    await vscode.workspace.fs.writeFile(outputFileUri, pngBuffer);
}

async function analyzeCurrentFile(): Promise<void> {
    try {
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            vscode.window.showWarningMessage('No file is currently open.');
            return;
        }

        const document = editor.document;

        if (document.isUntitled) {
            vscode.window.showWarningMessage('Please save the file before analyzing it.');
            return;
        }

        const sourceCode = document.getText();
        const relativePath = getRelativeFilePath(document.uri);
        const projectName = getProjectName(document.uri);
        const fileHash = createMd5Hash(relativePath);

        const pngBuffer = createSourceCodeMinimapPng(sourceCode);

		if (SAVE_MINIMAP_IMAGES_FOR_DEVELOPMENT) {
    		await saveMinimapImageForDevelopment(fileHash, pngBuffer);
		}
		
        const imageBase64 = pngBuffer.toString('base64');

        const requestPayload = {
            project: projectName,
            hash: fileHash,
            image: imageBase64
        };

        vscode.window.setStatusBarMessage(
            'SourceCodeMinimapsPlugin: sending source code minimap...',
            5000
        );

        const apiResponse = await sendMinimapToApi(requestPayload);

        await showAnalysisResult({
            projectName,
            relativePath,
            fileHash,
            apiResponse
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`SourceCodeMinimapsPlugin error: ${errorMessage}`);
    }
}

function getProjectName(fileUri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);

    if (!workspaceFolder) {
        return UNKNOWN_PROJECT_NAME;
    }

    return workspaceFolder.name;
}

function getRelativeFilePath(fileUri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);

    if (!workspaceFolder) {
        return fileUri.fsPath.replace(/\\/g, '/');
    }

    return vscode.workspace.asRelativePath(fileUri, false).replace(/\\/g, '/');
}

function createMd5Hash(value: string): string {
    return crypto
        .createHash('md5')
        .update(value, 'utf8')
        .digest('hex');
}

function convertCharacterToPixelIntensity(character: string): number {
    const ascii = character.charCodeAt(0);

    if (ascii >= 0 && ascii <= 32) {
        return 0;
    }

    if (ascii >= 48 && ascii <= 57) {
        return 53;
    }

    if (ascii >= 65 && ascii <= 90) {
        return 77;
    }

    if (ascii >= 97 && ascii <= 122) {
        return 109;
    }

    if (ascii >= 122 && ascii <= 127) {
        return ascii;
    }

    return 127;
}

function createSourceCodeMinimapPng(sourceCode: string): Buffer {
    const png = new PNG({
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT
    });

    const normalizedSourceCode = sourceCode
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

    const sourceLines = normalizedSourceCode.split('\n');

    for (let row = 0; row < IMAGE_HEIGHT; row++) {
        const sourceLine = sourceLines[row] ?? '';

        for (let column = 0; column < IMAGE_WIDTH; column++) {
            const character = sourceLine[column];

            const pixelIntensity = character === undefined
                ? 0
                : convertCharacterToPixelIntensity(character);

            const pixelIndex = (row * IMAGE_WIDTH + column) * 4;

            png.data[pixelIndex] = pixelIntensity;       // R
            png.data[pixelIndex + 1] = pixelIntensity;   // G
            png.data[pixelIndex + 2] = pixelIntensity;   // B
            png.data[pixelIndex + 3] = 255;              // Alpha
        }
    }

    return PNG.sync.write(png);
}

async function sendMinimapToApi(requestPayload: {
    project: string;
    hash: string;
    image: string;
}): Promise<ApiResponse> {
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': API_KEY
        },
        body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`HTTP ${response.status}: ${responseText}`);
    }

    return await response.json() as ApiResponse;
}

async function showAnalysisResultInDoc(result: {
    projectName: string;
    relativePath: string;
    fileHash: string;
    apiResponse: ApiResponse;
}): Promise<void> {
    const markdownLines: string[] = [];

    markdownLines.push('# SourceCodeMinimapsPlugin - Analysis Result');
    markdownLines.push('');
    markdownLines.push(`**Project:** ${result.projectName}`);
    markdownLines.push(`**File:** ${result.relativePath}`);
    markdownLines.push(`**MD5:** ${result.fileHash}`);
    markdownLines.push(`**Returned hash:** ${result.apiResponse.hash}`);
    markdownLines.push('');

    for (const predictionGroup of result.apiResponse.predict) {
        markdownLines.push(`## ${predictionGroup.target}`);
        markdownLines.push('');
        markdownLines.push('| Class | Confidence |');
        markdownLines.push('|---|---:|');

        for (const prediction of predictionGroup.predictions) {
            const confidencePercent = (prediction.confidence * 100).toFixed(2);
            markdownLines.push(`| ${prediction.class} | ${confidencePercent}% |`);
        }

        markdownLines.push('');
    }

    const resultDocument = await vscode.workspace.openTextDocument({
        content: markdownLines.join('\n'),
        language: 'markdown'
    });

    await vscode.window.showTextDocument(resultDocument, { preview: false });
}
