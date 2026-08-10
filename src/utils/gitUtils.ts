import { exec } from 'child_process';
import * as path from 'path';

let gitPath = 'git';

/**
 * Sets the git executable to use for all subsequent git() calls.
 * @param p - Absolute path to the git executable.
 */
export function configureGitPath(p: string): void {
    gitPath = p;
}

/**
 * Runs a git command and resolves with its stdout.
 * @param cwd - Directory to run the command in (any path inside the repo).
 * @param args - Raw git arguments, e.g. "status --short".
 * @returns stdout of the command.
 */
export function git(cwd: string, args: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`"${gitPath}" ${args}`, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(stdout);
        });
    });
}

/**
 * Returns the directory to use as `cwd` for git commands on a given file.
 * @param filePath - Absolute path to a file.
 * @returns The file's containing directory.
 */
export function getCwdForFile(filePath: string): string {
    return path.dirname(filePath);
}

/**
 * Finds the root directory of the git repository containing `cwd`.
 * @param cwd - Any directory inside the repo.
 * @returns Absolute repo root, OS-native path separators.
 */
export async function getGitRoot(cwd: string): Promise<string> {
    return (await git(cwd, 'rev-parse --show-toplevel')).trim().replace(/\//g, path.sep);
}

/**
 * Converts an absolute file path into a path relative to its repo root, in
 * the forward-slash form git expects on the command line.
 * @param filePath - Absolute path to a file.
 * @param cwd - Any directory inside the same repo.
 * @returns Repo-relative path, e.g. "src/foo.js".
 */
export async function getRelativeToRepo(filePath: string, cwd: string): Promise<string> {
    const root = await getGitRoot(cwd);
    return path.relative(root, filePath).replace(/\\/g, '/');
}

/**
 * Determines the ref that represents the remote's default branch, trying
 * origin/HEAD first and falling back to common branch names.
 * @param cwd - Any directory inside the repo.
 * @returns A ref usable in other git commands, e.g. "origin/main".
 */
export async function getOriginHead(cwd: string): Promise<string> {
    try {
        return (await git(cwd, 'rev-parse --abbrev-ref origin/HEAD')).trim();
    } catch {
        // origin/HEAD isn't always set (e.g. after a shallow clone or a fresh
        // `git remote add`), so fall back to guessing the usual default names.
        for (const branch of ['origin/main', 'origin/master']) {
            try {
                await git(cwd, `rev-parse ${branch}`);
                return branch;
            } catch {}
        }
        throw new Error('Could not determine origin HEAD. Try running: git remote set-head origin --auto');
    }
}
