import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('typescript');

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'typescript') {
        updateDiagnostics(event.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'typescript') {
        updateDiagnostics(document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection.delete(document.uri);
    })
  );
}

function updateDiagnostics(document: vscode.TextDocument) {
  const diagnostics: vscode.Diagnostic[] = [];

  // Step 1: Get workspace folder and tsconfig.json path
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return;
  }

  const tsConfigPath = path.join(workspaceFolder.uri.fsPath, 'tsconfig.json');
  if (!fs.existsSync(tsConfigPath)) {
    vscode.window.showWarningMessage('No tsconfig.json found in the workspace folder.');
    return;
  }

  // Step 2: Parse tsconfig.json to get compiler options and file list
  const configParseResult = ts.parseJsonConfigFileContent(
    JSON.parse(fs.readFileSync(tsConfigPath, 'utf8')),
    ts.sys,
    workspaceFolder.uri.fsPath
  );

  // Step 3: Create the TypeScript Program with all files from tsconfig.json
  const program = ts.createProgram(configParseResult.fileNames, configParseResult.options);

  const checker = program.getTypeChecker();

  // Step 4: Traverse the AST of the current file and find inferred any types
  const sourceFile = program.getSourceFile(document.uri.fsPath);
  if (!sourceFile) {
    return;
  }

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && !node.type) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, node);
        const typeString = checker.typeToString(type);

        // Check if the type is inferred as 'any'
        if (typeString === 'any') {
          const start = node.getStart();
          const end = node.getEnd();
          const range = new vscode.Range(document.positionAt(start), document.positionAt(end));

          const diagnostic = new vscode.Diagnostic(
            range,
            `Variable "${node.name.getText()}" is inferred as 'any'`,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostics.push(diagnostic);
        }
      }
    }
    node.forEachChild(visit);
  }

  visit(sourceFile);

  // Step 5: Apply diagnostics to the document
  diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
