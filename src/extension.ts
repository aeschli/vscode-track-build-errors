
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as util from 'util';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "vscode-track-build-errors" is now active!');

	updateRegisterWatchers();
	vscode.workspace.onDidChangeWorkspaceFolders(_ => {
		updateRegisterWatchers();
	});
}

const collections: { [outFilePath: string]: vscode.DiagnosticCollection } = {};
const watchers: vscode.FileSystemWatcher[] = [];

function updateRegisterWatchers() {
	watchers.forEach(w => w.dispose());

	for (const path in collections) {
		const collection = collections[path];
		collection.clear();
		delete collections[path];
	}

	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.build/log'));
			watchers.push(watcher);
			watcher.onDidCreate(e => updateErrors(e, false));
			watcher.onDidCreate(e => updateErrors(e, false));
			watcher.onDidCreate(e => updateErrors(e, true));
		}
	}
}

function updateErrors(outFileUri: vscode.Uri, isDeleted = false) {
	console.log('Reading ' + outFileUri.toString());
	if (outFileUri.scheme !== 'file') {
		return;
	}
	let collection = collections[outFileUri.path];
	if (isDeleted) {
		if (collection) {
			collection.clear();
			delete collections[outFileUri.path];
		}
		return;
	}
	if (!collection) {
		collection = vscode.languages.createDiagnosticCollection(outFileUri.path);
		collections[outFileUri.path] = collection;
	} else {
		collection.clear();
	}
	util.promisify(fs.readFile)(outFileUri.fsPath).then(buffer => {
		const problems = JSON.parse(buffer.toString());
		if (Array.isArray(problems)) {
			const diagnosticsByPath: { [path: string]: vscode.Diagnostic[] } = {};
			for (let problem of problems) {
				const { path, line, column, message } = problem;
				if (typeof path === 'string' && typeof line === 'number' && typeof column === 'number' && typeof message === 'string') {
					let ds = diagnosticsByPath[path];
					if (!ds) {
						ds = diagnosticsByPath[path] = [];
					}
					ds.push(new vscode.Diagnostic(new vscode.Range(line, column, line, column + 1), message));
				}
			}
			collection.set()
		}
	});
}

export function deactivate() { }
