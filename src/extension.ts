import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { PNG } from 'pngjs';

const ENDPOINT = 'http://98.85.228.131:8000/api/v1/analyze/image';
const API_KEY = 'm1n1m4p-pesquisa-2026!';

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

async function showAnalysisResult(result: {
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
