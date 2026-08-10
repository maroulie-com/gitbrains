import * as vscode from 'vscode';
import * as fs from 'fs';
import * as gitUtils from '../utils/gitUtils';

interface CommitFile {
    name: string;
    status: string;
}

interface CommitData {
    hash: string;
    commitMessage: string;
    files: CommitFile[];
    activeFile: string;
}

interface FileDiffMessage {
    command: 'openFileDiff';
    file: string;
    status: string;
}

/**
 * Fetches a commit's message and changed-file list for display in the panel.
 * @param hash - Full commit hash.
 * @param root - Repo root to run git in.
 * @param activeFile - Repo-relative path of the file the user was viewing, used to pre-highlight it in the file list.
 */
async function fetchCommitData(hash: string, root: string, activeFile: string): Promise<CommitData> {
    const commitMessage = await gitUtils.git(root, `log -1 --format="%H%n%an%n%ad%n%n%s%n%n%b" ${hash}`);
    const fileOutput = await gitUtils.git(root, `diff-tree --no-commit-id --name-status -r ${hash}`);
    const files: CommitFile[] = fileOutput.trim().split('\n').filter(Boolean).map(line => {
        const [status, name] = line.split('\t');
        return { name, status };
    });
    return { hash, commitMessage, files, activeFile };
}

/** Singleton webview panel that displays a commit's message and changed files. */
export class CommitViewerPanel {
    static currentPanel: CommitViewerPanel | null = null;

    private readonly _panel: vscode.WebviewPanel;
    private _hash: string;
    private _root: string;

    /**
     * Fetches the commit data and either updates the existing panel or creates a new one.
     * @param hash - Full commit hash to display.
     * @param root - Repo root to run git in.
     * @param activeFile - Repo-relative path to pre-highlight in the file list.
     * @param extensionUri - Extension's install root, needed to load commitViewer.html.
     */
    static async createOrShow(hash: string, root: string, activeFile: string, extensionUri: vscode.Uri): Promise<void> {
        try {
            const data = await fetchCommitData(hash, root, activeFile);
            if (CommitViewerPanel.currentPanel) {
                CommitViewerPanel.currentPanel._show(hash, root, data);
            } else {
                CommitViewerPanel.currentPanel = new CommitViewerPanel(extensionUri, hash, root, data);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open commit viewer: ${(err as Error).message}`);
        }
    }

    /**
     * Creates the webview panel and loads its HTML. Not called directly —
     * use createOrShow().
     */
    private constructor(extensionUri: vscode.Uri, hash: string, root: string, data: CommitData) {
        // Instance state read at click-time by _handleMessage, instead of being
        // captured once by a closure — keeps the panel correct when reused for a new commit.
        this._hash = hash;
        this._root = root;

        this._panel = vscode.window.createWebviewPanel(
            'gitCommitViewer',
            `Commit ${hash.substring(0, 7)}`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true }
        );
        this._panel.onDidDispose(() => { CommitViewerPanel.currentPanel = null; });

        const htmlPath = vscode.Uri.joinPath(extensionUri, 'commitViewer.html');
        this._panel.webview.html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        this._panel.webview.onDidReceiveMessage((msg: FileDiffMessage) => this._handleMessage(msg));

        this._panel.webview.postMessage(data);
    }

    /**
     * Re-targets an already-open panel at a different commit.
     */
    private _show(hash: string, root: string, data: CommitData): void {
        this._hash = hash;
        this._root = root;
        this._panel.title = `Commit ${hash.substring(0, 7)}`;
        this._panel.reveal(vscode.ViewColumn.Beside, true);
        this._panel.webview.postMessage(data);
    }

    /**
     * Handles messages posted from the webview (currently just file clicks)
     * by opening the appropriate before/after diff for the current commit.
     */
    private async _handleMessage(msg: FileDiffMessage): Promise<void> {
        if (msg.command !== 'openFileDiff') return;
        const hash = this._hash;
        const root = this._root;
        const { file, status } = msg;
        const afterUri = vscode.Uri.from({ scheme: 'git-compare', path: '/' + file, query: hash, fragment: root });
        if (status === 'A') {
            const emptyUri = vscode.Uri.from({ scheme: 'git-compare', path: '/_empty', query: '_empty', fragment: root });
            await vscode.commands.executeCommand('vscode.diff', emptyUri, afterUri, `${file} (added in ${hash.substring(0, 7)})`);
        } else if (status === 'D') {
            const beforeUri = vscode.Uri.from({ scheme: 'git-compare', path: '/' + file, query: `${hash}~1`, fragment: root });
            const emptyUri = vscode.Uri.from({ scheme: 'git-compare', path: '/_empty', query: '_empty', fragment: root });
            await vscode.commands.executeCommand('vscode.diff', beforeUri, emptyUri, `${file} (deleted in ${hash.substring(0, 7)})`);
        } else {
            const beforeUri = vscode.Uri.from({ scheme: 'git-compare', path: '/' + file, query: `${hash}~1`, fragment: root });
            await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, `${file} (${hash.substring(0, 7)})`);
        }
    }

    /** Closes the panel. */
    dispose(): void {
        this._panel.dispose();
    }
}
