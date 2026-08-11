import * as vscode from 'vscode';
import * as path from 'path';
import * as gitUtils from '../utils/gitUtils';
import { CommitViewerPanel } from '../webview/commitViewerPanel';

/**
 * Replaces the active/target file's content with its version from the
 * remote's default branch (origin/HEAD).
 * @param uri - File to roll back; defaults to the active editor's file.
 */
export async function rollback(uri?: vscode.Uri): Promise<void> {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) { vscode.window.showErrorMessage('No File Selected'); return; }
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const relativePath = await gitUtils.getRelativeToRepo(filePath, cwd);
        const head = await gitUtils.getOriginHead(cwd);
        const content = await gitUtils.git(cwd, `show ${head}:${relativePath}`);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        await editor.edit(eb => eb.replace(fullRange, content));
        vscode.window.showInformationMessage(`Rolled back to ${head}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to rollback: ${(err as Error).message}`);
    }
}

/**
 * Replaces the active/target file's content with its version at HEAD
 * (discards uncommitted local changes).
 * @param uri - File to roll back; defaults to the active editor's file.
 */
export async function localRollback(uri?: vscode.Uri): Promise<void> {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) { vscode.window.showErrorMessage('No File Selected'); return; }
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const relativePath = await gitUtils.getRelativeToRepo(filePath, cwd);
        const content = await gitUtils.git(cwd, `show HEAD:${relativePath}`);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        await editor.edit(eb => eb.replace(fullRange, content));
        vscode.window.showInformationMessage('Rolled back to HEAD');
    } catch (err) {
        vscode.window.showErrorMessage(`Rollback Failed: ${(err as Error).message}`);
    }
}

/**
 * Opens VS Code's diff view comparing the staged version of a file against
 * its current working-tree contents.
 * @param uri - File to diff; defaults to the active editor's file.
 */
export async function showDiff(uri?: vscode.Uri): Promise<void> {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) { vscode.window.showErrorMessage('No File Selected'); return; }
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const root = await gitUtils.getGitRoot(cwd);
        const relativePath = await gitUtils.getRelativeToRepo(filePath, cwd);
        const stagedUri = vscode.Uri.from({ scheme: 'git-compare', path: '/' + relativePath, query: ':', fragment: root });
        const localUri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('vscode.diff', stagedUri, localUri, `${relativePath} (staged <-> working)`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to get diff: ${(err as Error).message}`);
    }
}

/**
 * Prompts for a remote branch, then opens VS Code's diff view comparing the
 * file on that branch against its current working-tree contents.
 * @param uri - File to diff; defaults to the active editor's file.
 */
export async function compareWithBranch(uri?: vscode.Uri): Promise<void> {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) { vscode.window.showErrorMessage('No File Selected'); return; }
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const relativePath = await gitUtils.getRelativeToRepo(filePath, cwd);
        await gitUtils.git(cwd, 'fetch --all');
        const branchOutput = await gitUtils.git(cwd, 'branch -a');
        const branches = branchOutput.split('\n').map(b => b.trim()).filter(b => b && !b.includes('->'));
        const picked = await vscode.window.showQuickPick(branches, { placeHolder: 'Select branch to compare with' });
        if (!picked) return;
        const root = await gitUtils.getGitRoot(cwd);
        const branchUri = vscode.Uri.from({ scheme: 'git-compare', path: '/' + relativePath, query: picked, fragment: root });
        const localUri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('vscode.diff', branchUri, localUri, `${relativePath} (${picked} <-> working)`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to compare with branch: ${(err as Error).message}`);
    }
}

interface RevisionItem extends vscode.QuickPickItem {
    hash: string;
}

/**
 * Prompts for one of the file's past revisions (via `git log`), then opens
 * VS Code's diff view comparing that revision against the current
 * working-tree contents.
 * @param uri - File to diff; defaults to the active editor's file.
 */
export async function compareWithRevisions(uri?: vscode.Uri): Promise<void> {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) { vscode.window.showErrorMessage('No File Selected'); return; }
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const relativePath = await gitUtils.getRelativeToRepo(filePath, cwd);
        const root = await gitUtils.getGitRoot(cwd);
        // Fields are separated with \x1f (unit separator) rather than a visible
        // character, since commit subjects can contain almost anything else.
        const logOutput = await gitUtils.git(root, `log --follow --date=relative --format="%H%x1f%ad%x1f%an%x1f%s" -- ${relativePath}`);
        const revisions = logOutput.trim().split('\n').filter(Boolean).map(line => {
            const [hash, date, author, subject] = line.split('\x1f');
            return { hash, date, author, subject };
        });
        if (!revisions.length) { vscode.window.showInformationMessage('No revisions found for this file.'); return; }

        const items: RevisionItem[] = revisions.map(r => ({
            label: r.hash.substring(0, 7),
            description: `${r.date} · ${r.author}`,
            detail: r.subject,
            hash: r.hash,
        }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a revision to compare with' });
        if (!picked) return;

        const revisionUri = vscode.Uri.from({ scheme: 'git-compare', path: '/' + relativePath, query: picked.hash, fragment: root });
        const localUri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('vscode.diff', revisionUri, localUri, `${relativePath} (${picked.label} <-> working)`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to compare with revisions: ${(err as Error).message}`);
    }
}

/**
 * Prompts for one of the repo's currently-conflicted files, then opens it in
 * VS Code's merge editor.
 */
export async function resolveConflict(): Promise<void> {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) { vscode.window.showErrorMessage('No File Selected'); return; }
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const root = await gitUtils.getGitRoot(cwd);
        const output = await gitUtils.git(root, 'diff --name-only --diff-filter=U');
        const conflictedFiles = output.trim().split('\n').filter(Boolean);
        if (!conflictedFiles.length) { vscode.window.showInformationMessage('No conflicts found.'); return; }
        const picked = await vscode.window.showQuickPick(conflictedFiles, { placeHolder: 'Select a file to resolve conflict' });
        if (!picked) return;
        const fileUri = vscode.Uri.file(path.join(root, picked));
        await vscode.commands.executeCommand('git.openMergeEditor', fileUri);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to resolve conflict: ${(err as Error).message}`);
    }
}

/**
 * Blames the active editor's current line and opens the resulting commit in
 * the commit viewer webview.
 * @param extensionUri - Extension's install root, needed to load commitViewer.html.
 */
export async function showCommit(extensionUri: vscode.Uri): Promise<void> {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) { vscode.window.showErrorMessage('No File Selected'); return; }
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const relativePath = await gitUtils.getRelativeToRepo(filePath, cwd);
        const root = await gitUtils.getGitRoot(cwd);
        const line = vscode.window.activeTextEditor!.selection.active.line + 1;
        const blameOutput = await gitUtils.git(root, `blame --porcelain -L ${line},${line} ${relativePath}`);
        const hashMatch = blameOutput.match(/^([0-9a-f]{40})/);
        if (!hashMatch || /^0+$/.test(hashMatch[1])) { vscode.window.showErrorMessage('No commit found for this line'); return; }
        await CommitViewerPanel.createOrShow(hashMatch[1], root, relativePath, extensionUri);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to show commit: ${(err as Error).message}`);
    }
}
