const vscode = require('vscode');
const {exec} = require('child_process');
const path = require('path');

const annotatedFiles = new Map();
let gitPath = 'git';

function getWorkspaceFolder(filePath) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))
    return folder?.uri.fsPath;
}

function git(cwd, args) {
    return new Promise((resolve, reject) => {
        exec(`"${gitPath}" ${args}`, {cwd, maxBuffer: 10*1024*1024}, (err, stdout, stderr) => {
            if(err) return reject(new Error(stderr || err.message));
            resolve(stdout);
        });
    });
}

async function getGitRoot(cwd) {
    return (await git(cwd, 'rev-parse --show-toplevel')).trim();
}

async function getRelativeToRepo(filePath, cwd) {
    const root = await getGitRoot(cwd);
    return path.relative(root, filePath).replace(/\\/g, '/');
}

async function checkOriginalHead() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        vscode.commands.executeCommand('setContext', 'gitHelper.hasOriginHead', false);
        return;
    }
    for (const folder of folders) {
        try {
            await git(folder.uri.fsPath, 'rev-parse --abbrev-ref origin/HEAD');
            vscode.commands.executeCommand('setContext', 'gitHelpers.fileInOrigin', true);
            return;
        }catch{}
    }
    vscode.commands.executeCommand('setContext', 'gitHelpers.hasOriginHead', false);
}

async function checkFileInOrigin() {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
        vscode.commands.executeCommand('setContext', 'gitHelpers.fileInOrigin', false);
        return;
    }
    const cwd = getWorkspaceFolder(filePath);
    if (!cwd) {
        vscode.commands.executeCommand('setContext', 'gitHelpers.fileInOrigin', false);
        return;
    }

    try {
        const relativePath = await getRelativeToRepo(filePath, cwd);
        const head = (await git(cwd, 'rev-parse --abbrev-ref origin/HEAD')).trim();
        const diff = await git(cwd, `diff ${head} -- ${relativePath}`);
        vscode.commands.executeCommand('setConext', 'gitHelpers.fileInOrigin', diff.trim().length > 0);
    } catch {
        vscode.commands.executeCommand('setContext', 'gitHelpers.fileInOrigin', false);
    }
}

async function rollback(uri) {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) return vscode.window.showErrorMessage('No File Selected');

    const cwd = getWorkspaceFolder(filePath);
    if (!cwd) return vscode.window.showErrorMessage('File Not in Workspace');

    try {
        const relativePath = await getRelativeToRepo(filePath, cwd);
        const head = (await git(cwd, 'rev-parse --abbrev-ref origin/HEAD')).trim();
        const content = await git(cwd, `show ${head}:${relativePath}`);

        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
        );
        await editor.edit(eb => eb.replace(fullRange, content));
        vscode.window.showInformationMessage(`Rolled back to ${head}`);

    } catch(err) {
        vscode.window.showErrorMessage(`Failed to rollback: ${err.message}`);
    }
}

async function localRollback(uri) {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) return vscode.window.showErrorMessage('No File Selected');

    const cwd = getWorkspaceFolder(filePath);
    if (!cwd) return vscode.window.showErrorMessage('File Not in Workspace');

    try {
        const relativePath = await getRelativeToRepo(filePath, cwd);
        const content = await git(cwd, `show HEAD:${relativePath}`);
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
        );
        await editor.edit(eb => eb.replace(fullRange, content));
        vscode.window.showInformationMessage(`Rolled back to HEAD`);
    } catch (err) {
        vscode.window.showErrorMessage(`Rollback Failed: ${err.message}`);
    }
}

async function showDiff(uri) {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) return vscode.window.showErrorMessage('No File Selected');

    const cwd = getWorkspaceFolder(filePath);
    if (!cwd) return vscode.window.showErrorMessage('File Not in Workspace');

    try {
        const relativePath = await getRelativeToRepo(filePath, cwd);
        const stagedUri = vscode.Uri.from({scheme: 'git-compare', path: '/' + relativePath, query: ':', fragment: cwd});
        const localUri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('vscode.diff', stagedUri, localUri, `${relativePath} (staged <-> working)`)
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to get diff: ${err.message}`);
    }
}

async function compareWithBranch(uri) {
    const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) return vscode.window.showErrorMessage('No File Selected');

    const cwd = getWorkspaceFolder(filePath);
    if (!cwd) return vscode.window.showErrorMessage('File Not in Workspace');

    try {
        const relativePath = await getRelativeToRepo(filePath, cwd);
        await git(cwd, 'fetch --all');
        const branchOutput = await git(cwd, 'branch -r');
        const branches = branchOutput.split('\n')
        .map(b =>b.trim())
        .filter(b => b && !b.includes('->'));

        const picked = await vscode.window.showQuickPick(branches, {placeHolder: 'Select branch to compare with'});
        if(!picked) return;

        const branchUri = vscode.Uri.from({scheme: 'git-compare', path: '/' + relativePath, query: picked, fragment: cwd});
        const localUri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('vscode.diff', branchUri, localUri, `${relativePath} (${picked} <-> working)`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to compare with branch: ${err.message}`);
    }
}

function clearAnnotation(filePath) {
    const entry = annotatedFiles.get(filePath);
    if (!entry) return;

    entry.decorationType.dispose();
    entry.disposables.forEach(d => d.dispose());
    annotatedFiles.delete(filePath);
    updateAnnotateContext();
}

function updateAnnotateContext() {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    vscode.commands.executeCommand('setContext', 'gitHelpers.annotateActive', filePath ? annotatedFiles.has(filePath) : false);
}

async function toggleAnnotate(uri) {
  const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!filePath) return vscode.window.showErrorMessage('No File Selected');

  if (annotatedFiles.has(filePath)) {
    clearAnnotation(filePath);
    return;
  }

  const cwd = getWorkspaceFolder(filePath);
  if (!cwd) return vscode.window.showErrorMessage('File Not in Workspace');

  try {
    const relativePath = await getRelativeToRepo(filePath, cwd);
    const root = await getGitRoot(cwd);
    const blameOutput = await git(root, `blame --porcelain ${relativePath}`);

    const commits = {};
    const lineBlame = [];
    let currentHash = null;

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
        after: { margin: "0 0 0 3em", color: new vscode.ThemeColor("editoCodeLens.foreground"), textDecoration: "none"},
    });

    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === filePath);
    if (!editor) return;

    const decorations = [];
    for (let i = 0; i< lineBlame.length; i++) {
        const hash = lineBlame[i];
        if (!hash || !commits[hash]) continue;

        if (/^0+$/.test(hash)) continue;

        const { author, summary } = commits[hash];
        const shortHash = hash.substring(0, 7);
        const isFirstLine = i === 0 || lineBlame[i-1] !== hash;

        let text;
        if (isFirstLine) {
            text = `| ${author} (${shortHash}): ${summary || ''}`;
        } else {
            text = `|> ${author} (${shortHash})`
        }

        decorations.push({
            range: new vscode.Range(i, Number.MAX_SAFE_INTEGER, i, Number.MAX_SAFE_INTEGER),
            renderOptions: {
                after: {
                    contentText: text,
                },
            },
            hash,
            linie: i,
        });
    }

    editor.setDecorations(decorationType, decorations);

    const blameData = decorations.map(d => ({ line: d.linie, hash: d.hash, root }));

    const disposables = [];

    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(e => {
        if (e?.document.uri.fsPath === filePath) {
            e.setDecorations(decorationType, decorations);
            updateAnnotateContext();
        }
    });
    disposables.push(editorChangeDisposable);

    const closeDisposable = vscode.workspace.onDidCloseTextDocument(d => {
        if (d.uri.fsPath === filePath) clearAnnotation(filePath);
    });
    disposables.push(closeDisposable);

    annotatedFiles.set(filePath, { decorationType, disposables, blameData });
    updateAnnotateContext();
    } catch(err) {
        vscode.window.showErrorMessage(`Failed to annotate: ${err.message}`);
    }
}

let commitViewerPanel = null
function getCommitViewerHtml(commitMessage, files, hash, activeFile) {
    const fileListHtml = files.map(f => {
        const isActive = f == activeFile;
        return `<li class="file-items${isActive ? ' active' : ''}" data-file="${escapeHtml(f)}">${escapeHtml(f)}</li>`
    }).join('');

    const linkedMessage = commitMessage.split(/(https?:\/\/[^\s]+)/g).map(part =>
        part.match(/^https?:\/\//) ? `<a href="${escapeHtml(part)}">${escapeHtml(part)}</a>` : escapeHtml(part)
    ).join('')

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Commit Viewer</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif; }
            .sidebar {width: 300px; min-width: 150px}
            .divider { width: 4px; cursor: col-resize}
            .content {flex: 1; overflow-y: auto; padding: 10px;}
            .file-item {padding: 4px 8px; cursor: pointer; list-style: none;}
        </style>
    </head>
    <body>
        <div class="sidebar" id="sidebar">
            <h3>Files Changed (${files.length})</h3>
            <ul>${fileListHtml}</ul>
        </div>

        <div class="divider" id="divider"></div>

        <div class="content">
            <h3>Commit ${hash.substring(0, 7)}</h3>
            <pre>${linkedMessage}</pre>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            const activeEl = document.querySelector('.file-item.active');
            if(activeEl) activeEl.scrollIntoView({block: 'center'});
            document.querySelectorAll('.file-item').forEach(el => {
                el.addEventListener('click', () => {
                    document.querySelectorAll('.file-item.active').forEach(i => i.classList.remove('active'));
                    vscode.postMessage({ command: 'openFileDiff', file: el.dataset.file });
                });
            });
            const divider = document.getElementById('divider');
            const sidebar = document.getElementById('sidebar');
            let dragging = false;
            divider.addEventListener('mousedown', () => { dragging = true; document.body.style.cursor = 'col-resize'; });
            document.addEventListener('mousemove', e => { if (dragging) sidebar.style.width = Math.max(150, e.clientX) + 'px'; });
            odcument.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
        </script>
    </body>
    </html>
    `;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function openCommitViewer(hash, root, activeFile) {
    try {
        const commitMessage = await git(root, `log -1 --format="%H%n%an%n%ad%n%n%s%n%n%b" ${hash}`);
        const fileOutput = await git(root, `diff-tree --no-commit-id --name-only -r ${hash}`);
        const files = fileOutput.trim().split('\n').filter(Boolean);

        if (commitViewerPanel) {
            commitViewerPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            commitViewerPanel = vscode.window.createWebviewPanel(
                'gitCommitViewer',
                `Commit ${hash.substring(0,7)}`,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true},
                { enableScripts: true }
            );
            commitViewerPanel.onDidDispose(() => { commitViewerPanel = null; });
        }

        commitViewerPanel.title = `Commit ${hash.substring(0,7)}`;
        commitViewerPanel.webview.html = getCommitViewerHtml(commitMessage, files, hash, activeFile);

        commitViewerPanel.webview.onDidReceiveMessage(async msg => {
            if (msg.command === 'openFileDiff') {
                const file = msg.file;
                const beforeUri = vscode.Uri.from({ scheme: 'git-compare', path: '/' + file, query: `${hash}~1`, fragment: root });
                const afterUri = vscode.Uri.from({ scheme: 'git-compare', path: '/' + file, query: hash, fragment: root });
                await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, `${file} (${hash.substring(0,7)})`);
            }
        });
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to open commit viewer: ${err.message}`);
    }
}

async function showCommitDiff(line) {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath)return;

    const entry = annotatedFiles.get(filePath);
    if (!entry) return;

    const blame = entry.blameData.find(b => b.line === line);
    if (!blame || /^0+$/.test(blame.hash)) return;

    const cwd = getWorkspaceFolder(filePath);
    let activeRelPath;
    try {
        activeRelPath = cwd ? await getRelativeToRepo(filePath, cwd) : undefined;
    } catch {}

    await openCommitViewer(blame.hash, blame.root, activeRelPath);
}

function activate(context) {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (gitExtension) {
        const api = gitExtension.getAPI(1);
        if (api?.git?.path) gitPath = api.git.path;
    }

    checkOriginalHead();
    checkFileInOrigin();

    const gitCompareProvider = new (class {
        async provideTextDocumentContent(uri) {
            const branch = uri.query;
            const filePath = uri.path.replace(/^\//, '');
            const cwd = uri.fragment;
            const root = await getGitRoot(cwd);
            const ref = branch === ':' ? `:${filePath}` : `${branch}:${filePath}`;
            return await git(root, `show ${ref}`);
        }
    })();

    const clickDisposable = vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
        const filePath = e.textEditor.document.uri.fsPath;
        if (!annotatedFiles.has(filePath)) return;
        const line = e.selections[0]?.start.line;
        if (line !== undefined) showCommitDiff(line);
    });

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('git-compare', gitCompareProvider),
        vscode.commands.registerCommand('gitHelpers.rollback', rollback),
        vscode.commands.registerCommand('gitHelpers.localRollback', localRollback),
        vscode.commands.registerCommand('gitHelpers.showDiff', showDiff),
        vscode.commands.registerCommand('gitHelpers.compareWithBranch', compareWithBranch),
        vscode.commands.registerCommand('gitHelpers.toggleAnnotate', toggleAnnotate),

        vscode.workspace.onDidChangeWorkspaceFolders(() => checkOriginalHead()),
        vscode.window.onDidChangeActiveTextEditor(() => {checkFileInOrigin(); updateAnnotateContext();}),
        clickDisposable
    );
}

function deactivate() {
    annotatedFiles.forEach((_, filePath) => clearAnnotation(filePath));
    if (commitViewerPanel) commitViewerPanel.dispose();
}

module.exports = { activate, deactivate };
