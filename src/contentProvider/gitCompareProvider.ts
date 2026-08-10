import * as vscode from 'vscode';
import * as gitUtils from '../utils/gitUtils';

/**
 * Serves read-only file content for the "git-compare" URI scheme, used to
 * feed VS Code's diff view without checking anything out to disk.
 *
 * URIs are encoded as: git-compare:/<repo-relative-path>?<ref>#<repo-root>
 * (path = file, query = ref to read at — a branch/commit/"~1", or ":" for
 * the index — fragment = repo root, since diff URIs carry no other way to
 * pass it through to the provider).
 */
export class GitCompareContentProvider implements vscode.TextDocumentContentProvider {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const branch = uri.query;
        if (branch === '_empty') return '';
        const filePath = uri.path.replace(/^\//, '');
        const root = uri.fragment;
        const ref = branch === ':' ? `:${filePath}` : `${branch}:${filePath}`;
        return await gitUtils.git(root, `show ${ref}`);
    }
}
