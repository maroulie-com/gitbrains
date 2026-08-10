# IntelliGit

Git helpers for VS Code: roll back files to a known-good version, diff against staged/remote/branch content, see inline blame as you move the cursor, and browse a commit's changes without leaving the editor — all from the Explorer and editor context menus, no terminal required.

## Features

### Rollback
- **Rollback** — replace a file's contents with its version from the remote's default branch (`origin/HEAD`). Only shown when the repo has a remote.
- **Reset HEAD** — replace a file's contents with its version at `HEAD`, discarding uncommitted local changes.

### Diffing
- **Show Diff** — open VS Code's diff view comparing the staged version of a file against your working copy.
- **Compare with Branch** — pick any remote branch and diff the file against it.

### Blame
- **Toggle Blame** — inline, end-of-line annotation showing the author, short hash, and commit summary for the line your cursor is on, updating as you move around the file. Automatically enabled for the active editor.
- **Show Commit** — blame the current line and open a commit viewer panel: full commit message plus the list of changed files, with each file clickable to open its before/after diff.

### Conflict resolution
- **Resolve Conflict** — pick from the repo's currently-conflicted files and jump straight into VS Code's merge editor.

All commands live under **Git** in the Explorer and editor context menus.

## Requirements

- Git installed and available on your `PATH` (or configured via the built-in Git extension's `git.path` setting — IntelliGit reuses whatever `git.path` VS Code's own `vscode.git` extension resolves, so it stays consistent with your existing Git setup).
- The built-in `vscode.git` extension enabled (IntelliGit depends on it).

## Installation

*Not yet published to the VS Code Marketplace — this section will be updated with a direct install link once it is.*

Until then, build and install from source:

```sh
git clone https://github.com/<org>/intelligit.git
cd intelligit
npm install
npm run package                        # compiles and produces intelligit-<version>.vsix
code --install-extension intelligit-<version>.vsix
```

## Commands

| Command | Title | What it does |
|---|---|---|
| `gitHelpers.rollback` | Rollback | Replace the file with its version from the remote's default branch |
| `gitHelpers.localRollback` | Reset HEAD | Replace the file with its version at `HEAD` |
| `gitHelpers.showDiff` | Show Diff | Diff staged vs. working copy |
| `gitHelpers.compareWithBranch` | Compare with Branch | Diff the file against a chosen remote branch |
| `gitHelpers.showCommit` | Show Commit | Open the commit viewer for the current line's commit |
| `gitHelpers.toggleAnnotate` | Toggle Blame | Turn inline blame annotation on/off |
| `gitHelpers.resolveConflict` | Resolve Conflict | Pick a conflicted file and open the merge editor |

## Development

Written in TypeScript (`src/`), compiled to `out/` via `tsc`.

```sh
npm run compile   # one-off build
npm run watch      # rebuild on change
npm run package    # build the .vsix
```

`build.sh` bumps the patch version, packages, and installs the extension into your local VS Code in one step.

## License

MIT © Maroulie LLC — see [LICENSE.md](LICENSE.md).
