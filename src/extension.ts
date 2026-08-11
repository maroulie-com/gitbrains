import * as vscode from 'vscode';
import * as gitUtils from './utils/gitUtils';
import { checkOriginalHead, checkFileInOrigin } from './context/contextState';
import { toggleAnnotate, enableAnnotate, updateAnnotateContext, disposeAll as disposeAnnotations } from './annotate/blameDecorations';
import { rollback, localRollback, showDiff, compareWithBranch, compareWithRevisions, resolveConflict, showCommit } from './commands/gitCommands';
import { CommitViewerPanel } from './webview/commitViewerPanel';
import { GitCompareContentProvider } from './contentProvider/gitCompareProvider';

/**
 * Extension entry point: wires up commands, providers, and event listeners.
 * Called once by VS Code when the extension activates.
 */
export function activate(context: vscode.ExtensionContext): void {
    // Prefer the git binary VS Code's own git extension already resolved,
    // so we stay consistent with whatever git.path the user has configured.
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (gitExtension) {
        const api = gitExtension.getAPI(1);
        if (api?.git?.path) gitUtils.configureGitPath(api.git.path);
    }

    checkOriginalHead();
    checkFileInOrigin();

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('git-compare', new GitCompareContentProvider()),
        vscode.commands.registerCommand('gitHelpers.rollback', rollback),
        vscode.commands.registerCommand('gitHelpers.localRollback', localRollback),
        vscode.commands.registerCommand('gitHelpers.showDiff', showDiff),
        vscode.commands.registerCommand('gitHelpers.compareWithBranch', compareWithBranch),
        vscode.commands.registerCommand('gitHelpers.compareWithRevisions', compareWithRevisions),
        vscode.commands.registerCommand('gitHelpers.toggleAnnotate', toggleAnnotate),
        vscode.commands.registerCommand('gitHelpers.showCommit', () => showCommit(context.extensionUri)),
        vscode.commands.registerCommand('gitHelpers.resolveConflict', resolveConflict),

        vscode.workspace.onDidChangeWorkspaceFolders(() => checkOriginalHead()),
        vscode.window.onDidChangeActiveTextEditor(e => {
            checkFileInOrigin();
            checkOriginalHead();
            updateAnnotateContext();
            if (e && e.document.uri.scheme === 'file') enableAnnotate(e.document.uri);
        })
    );

    if (vscode.window.activeTextEditor) {
        enableAnnotate(vscode.window.activeTextEditor.document.uri);
    }
}

/** Extension teardown: releases decorations and closes the commit viewer. */
export function deactivate(): void {
    disposeAnnotations();
    CommitViewerPanel.currentPanel?.dispose();
}