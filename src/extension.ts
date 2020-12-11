
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

type DiagnosticsCollector = { update(content: BuildLogContent): void; dispose(): void; };
type BuildLogContent = { path: string, line: number, column: number, message: string }[];

const buildLogWatchers: vscode.Disposable[] = [];

const logFileNames = ['log', 'log_extensions'];

export function activate(context: vscode.ExtensionContext) {

	console.log('Extension "vscode-track-build-errors" is now active');

	updateBuildLogWatchers();
	vscode.workspace.onDidChangeWorkspaceFolders(_ => updateBuildLogWatchers());
}

function updateBuildLogWatchers(): void {
	buildLogWatchers.forEach(w => w.dispose());
	buildLogWatchers.length = 0;

	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			if (folder.uri.scheme === 'file') {
				for (const logFileName of logFileNames) {
					buildLogWatchers.push(createBuildLogWatcher(folder, logFileName));
				}
			}
		}
	}
}

function createBuildLogWatcher(folder: vscode.WorkspaceFolder, logFileName: string): vscode.Disposable {
	const outFilePath = path.join(folder.uri.fsPath, '.build', logFileName);
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.build/' + logFileName));

	let collector: DiagnosticsCollector | undefined;

	watcher.onDidCreate(readBuildLog);
	watcher.onDidChange(readBuildLog);
	watcher.onDidDelete(readBuildLog);

	readBuildLog();

	function disposeCollector() {
		if (collector) {
			collector.dispose();
			collector = undefined;
		}
	}

	function readBuildLog() {
		util.promisify(fs.readFile)(outFilePath).then(buffer => {
			try {
				const problems = JSON.parse(buffer.toString());
				if (!collector) {
					collector = createDiagnosticsCollector(outFilePath);
				}
				collector.update(problems);
			} catch (e) {
				console.log('Error parsing ' + e.message);
				disposeCollector();
			}
		}, e => {
			disposeCollector();
		});
	}

	return {
		dispose() {
			watcher.dispose();
			disposeCollector();
		}
	};
}


function createDiagnosticsCollector(outFile: string): DiagnosticsCollector {

	const collection = vscode.languages.createDiagnosticCollection(outFile);
	const openDocuments: { [path: string]: boolean } = {};

	let diagnosticsByPath: { [path: string]: vscode.Diagnostic[] } = {};

	const onTextDocOpen = vscode.workspace.onDidOpenTextDocument(e => {
		const uri = e.uri;
		if (uri.scheme === 'file') {
			collection.set(uri, []);
			openDocuments[uri.fsPath] = true;
		}
	});
	const onTextDocClose = vscode.workspace.onDidCloseTextDocument(e => {
		const uri = e.uri;
		if (uri.scheme === 'file') {
			collection.set(uri, diagnosticsByPath[uri.fsPath] || []);
			delete openDocuments[uri.fsPath];
		}
	});
	for (const doc of vscode.workspace.textDocuments) {
		const uri = doc.uri;
		if (uri.scheme === 'file') {
			openDocuments[uri.fsPath] = true;
		}
	}

	return {
		update(content: BuildLogContent) {
			diagnosticsByPath = {};

			if (Array.isArray(content)) {
				for (const item of content) {
					const { path, line, column, message } = item;
					if (typeof path === 'string' && typeof line === 'number' && typeof column === 'number' && typeof message === 'string') {
						let ds = diagnosticsByPath[path];
						if (!ds) {
							ds = diagnosticsByPath[path] = [];
						}
						const diagnostic = new vscode.Diagnostic(new vscode.Range(line - 1, column - 1, line - 1, column - 1), message);
						diagnostic.source = 'yarn watch';
						ds.push(diagnostic);
					}
				}
			}

			collection.clear();

			for (const path in diagnosticsByPath) {
				if (!openDocuments[path]) {
					const uri = vscode.Uri.file(path);
					collection.set(uri, diagnosticsByPath[path]);
				}
			}
		},
		dispose() {
			collection.dispose();
			onTextDocOpen.dispose();
			onTextDocClose.dispose();
		}
	};

}

export function deactivate() { }
