import * as vscode from 'vscode';
import * as gitUtils from '../utils/gitUtils';

/**
 * Sets the `gitHelpers.hasOriginHead` context key, which controls whether the
 * "Rollback" menu item (rollback to origin) is shown.
 */
export async function checkOriginalHead(): Promise<void> {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const cwd = filePath ? gitUtils.getCwdForFile(filePath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
        vscode.commands.executeCommand('setContext', 'gitHelpers.hasOriginHead', false);
        return;
    }
    try {
        const remotes = await gitUtils.git(cwd, 'remote');
        vscode.commands.executeCommand('setContext', 'gitHelpers.hasOriginHead', remotes.trim().length > 0);
    } catch {
        vscode.commands.executeCommand('setContext', 'gitHelpers.hasOriginHead', false);
    }
}

/**
 * Sets the `gitHelpers.fileInOrigin` context key based on whether the active
 * file differs from the remote's default branch.
 */
export async function checkFileInOrigin(): Promise<void> {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
        vscode.commands.executeCommand('setContext', 'gitHelpers.fileInOrigin', false);
        return;
    }
    const cwd = gitUtils.getCwdForFile(filePath);
    try {
        const relativePath = await gitUtils.getRelativeToRepo(filePath, cwd);
        const head = await gitUtils.getOriginHead(cwd);
        const diff = await gitUtils.git(cwd, `diff ${head} -- ${relativePath}`);
        vscode.commands.executeCommand('setContext', 'gitHelpers.fileInOrigin', diff.trim().length > 0);
    } catch {
        vscode.commands.executeCommand('setContext', 'gitHelpers.fileInOrigin', false);
    }
}
