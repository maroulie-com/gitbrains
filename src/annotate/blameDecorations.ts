import * as vscode from 'vscode';
import * as gitUtils from '../utils/gitUtils';

interface CommitInfo {
    author?: string;
    summary?: string;
}

interface AnnotatedFileEntry {
    decorationType: vscode.TextEditorDecorationType;
    disposables: vscode.Disposable[];
    blameData: { line: number; hash: string; root: string }[];
}

// filePath -> { decorationType, disposables, blameData }
const annotatedFiles = new Map<string, AnnotatedFileEntry>();

/**
 * Syncs the `gitHelpers.annotateActive` context key with whether the active
 * file currently has blame annotation enabled (drives the toggle menu label).
 */
export function updateAnnotateContext(): void {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    vscode.commands.executeCommand('setContext', 'gitHelpers.annotateActive', filePath ? annotatedFiles.has(filePath) : false);
}

/**
 * Disposes a file's blame decoration and event listeners, and forgets it.
 * @param filePath - Absolute path of the annotated file.
 */
export function clearAnnotation(filePath: string): void {
    const entry = annotatedFiles.get(filePath);
    if (!entry) return;
    entry.decorationType.dispose();
    entry.disposables.forEach(d => d.dispose());
    annotatedFiles.delete(filePath);
    updateAnnotateContext();
}

/**
 * Renders (or clears) the blame decoration for an editor's current line.
 * @param ed - Editor to decorate.
 * @param lineBlame - Line index -> commit hash, for the editor's file.
 * @param commits - Commit hash -> { author, summary }, for the editor's file.
 * @param decorationType - Decoration type to apply.
 */
function applyDecoration(
    ed: vscode.TextEditor,
    lineBlame: string[],
    commits: Record<string, CommitInfo>,
    decorationType: vscode.TextEditorDecorationType
): void {
    const line = ed.selection.active.line;
    const hash = lineBlame[line];
    if (!hash || !commits[hash] || /^0+$/.test(hash)) {
        // No hash (e.g. a locally-added line), or a boundary/uncommitted
        // hash made of all zeros: nothing meaningful to show.
        ed.setDecorations(decorationType, []);
        return;
    }
    const { author, summary } = commits[hash];
    const shortHash = hash.substring(0, 7);
    ed.setDecorations(decorationType, [{
        range: new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
        renderOptions: { after: { contentText: `→ ${author} (${shortHash}): ${summary || ''}` } },
    }]);
}

/**
 * Turns on inline blame annotation for a file: runs `git blame`, then shows
 * an end-of-line decoration with the author/commit for the cursor's current
 * line, updating as the cursor moves.
 * @param uri - URI of the file to annotate.
 */
export async function enableAnnotate(uri: vscode.Uri | undefined): Promise<void> {
    const filePath = uri?.fsPath;
    if (!filePath || annotatedFiles.has(filePath)) return;
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const relativePath = await gitUtils.getRelativeToRepo(filePath, cwd);
        const root = await gitUtils.getGitRoot(cwd);
        const blameOutput = await gitUtils.git(root, `blame --porcelain ${relativePath}`);

        const commits: Record<string, CommitInfo> = {};
        const lineBlame: string[] = [];
        let currentHash: string | null = null;

        for (const line of blameOutput.split('\n')) {
            const headerMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
            if (headerMatch) {
                currentHash = headerMatch[1];
                const linenum = parseInt(headerMatch[2], 10) - 1;
                if (!commits[currentHash]) commits[currentHash] = {};
                lineBlame[linenum] = currentHash;
            } else if (currentHash && line.startsWith('author ')) {
                commits[currentHash].author = line.substring(7);
            } else if (currentHash && line.startsWith('summary ')) {
                commits[currentHash].summary = line.substring(8);
            }
        }

        const decorationType = vscode.window.createTextEditorDecorationType({
            after: { margin: '0 0 0 3em', color: new vscode.ThemeColor('editorCodeLens.foreground'), textDecoration: 'none' },
        });

        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === filePath);
        if (!editor) return;

        applyDecoration(editor, lineBlame, commits, decorationType);

        const blameData = lineBlame.map((hash, line) => ({ line, hash, root }));
        const disposables: vscode.Disposable[] = [];

        disposables.push(vscode.window.onDidChangeTextEditorSelection(e => {
            if (e.textEditor.document.uri.fsPath === filePath) applyDecoration(e.textEditor, lineBlame, commits, decorationType);
        }));
        disposables.push(vscode.window.onDidChangeActiveTextEditor(e => {
            if (e?.document.uri.fsPath === filePath) { applyDecoration(e, lineBlame, commits, decorationType); updateAnnotateContext(); }
        }));
        disposables.push(vscode.workspace.onDidCloseTextDocument(d => {
            if (d.uri.fsPath === filePath) clearAnnotation(filePath);
        }));

        annotatedFiles.set(filePath, { decorationType, disposables, blameData });
        updateAnnotateContext();
    } catch { /* not a git file, silently skip */ }
}

/**
 * Toggles blame annotation on/off for a file.
 * @param uri - File to toggle; defaults to the active editor's file.
 */
export async function toggleAnnotate(uri?: vscode.Uri): Promise<void> {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) { vscode.window.showErrorMessage('No File Selected'); return; }
    if (annotatedFiles.has(filePath)) {
        clearAnnotation(filePath);
    } else {
        await enableAnnotate(vscode.Uri.file(filePath));
    }
}

/** Clears every active annotation. Called on extension deactivation. */
export function disposeAll(): void {
    annotatedFiles.forEach((_, filePath) => clearAnnotation(filePath));
}
