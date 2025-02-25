import * as vscode from "vscode";
import * as toml from "toml";
import * as fs from "fs";
import * as path from "path";

interface ImportConfig {
  relative: boolean;
  excludes: string[];
}

interface ProjectConfig {
  import: ImportConfig;
}

interface CompletionItem {
  name: string;
  path: string;
}

let projectConfig: ProjectConfig = {
  import: {
    relative: false,
    excludes: ["test"],
  },
};

let workspaceFolder = "";

const functionStore: Map<string, string[]> = new Map();
const completionDictionary: CompletionItem[] = [];
const SUPPORTED_LANGUAGES = ["python"];

// 读取toml文件
const readTomlFile = (filePath: string) => {
  const tomlData = fs.readFileSync(filePath, "utf-8");
  return toml.parse(tomlData);
};

// 读取配置
const loadProjectConfig = () => {
  const projectTomlPath = path.join(workspaceFolder, "pyproject.toml");
  if (fs.existsSync(projectTomlPath)) {
    const tomlData = readTomlFile(projectTomlPath);

    const importerConfig = tomlData?.tool["python-importer"];
    if (importerConfig) {
      projectConfig = {
        import: Object.assign({}, projectConfig.import, importerConfig["import"]),
      };
    }
  }
};

// 提取函数列表
const extractAllFromInitPy = (filePath: string): any[] => {
  if (fs.existsSync(filePath)) {
    const fileContent = fs.readFileSync(filePath, "utf-8");

    const match = fileContent.match(/__all__\s*=\s*\[\s*([^\]]+)\s*\]/);
    if (match && match[1]) {
      try {
        // 使用正则表达式提取并清理字符串内容
        const allListString = match[1]
          .replace(/\s*,\s*/g, ",") // 清理空白字符
          .replace(/'/g, '"'); // 替换单引号为双引号

        // 解析字符串为数组
        return JSON.parse("[" + allListString + "]");
      } catch (error) {
        console.error("解析函数列表失败:", filePath, error);
        return [];
      }
    }
  }
  return [];
};

// 更新文件储存的函数
function updateFunctionStore(filePath: string): boolean {
  const allFunctions = extractAllFromInitPy(filePath);
  let hasChanged = false;
  // 没有函数 检测库存 并考虑删除
  if (allFunctions.length === 0) {
    if (functionStore.has(filePath)) {
      functionStore.delete(filePath);
      hasChanged = true;
    }
  } else {
    const existingFunctions = functionStore.get(filePath) || [];
    const sortedExistingFunctions = [...existingFunctions].sort();
    const sortedNewFunctions = [...allFunctions].sort();

    // 按序对比, 不一致则重置该路径节点的函数列表
    if (JSON.stringify(sortedExistingFunctions) !== JSON.stringify(sortedNewFunctions)) {
      functionStore.set(filePath, allFunctions);
      hasChanged = true;
    }
  }
  return hasChanged;
}

// 重置工作区
function refreshWorkspace() {
  loadProjectConfig();
  const { excludes } = projectConfig.import;

  const traverseDirectory = (dir: string) => {
    fs.readdirSync(dir).forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory() && !excludes.includes(file) && !file.startsWith(".") && !file.startsWith("_")) {
        traverseDirectory(filePath);
      } else if (file.endsWith("__init__.py")) {
        updateFunctionStore(filePath);
      }
    });
  };

  if (fs.existsSync(workspaceFolder)) {
    traverseDirectory(workspaceFolder);
  } else {
    console.error(`根目录不存在: ${workspaceFolder}`);
  }

  // 重构字典
  rebuildCompletionDictionary();
}

function rebuildCompletionDictionary() {
  completionDictionary.length = 0;
  functionStore.forEach((functions, filePath) => {
    functions.forEach((func) => {
      if (!completionDictionary.some((item) => item.name === func)) {
        const relativePath = path.relative(workspaceFolder, filePath);
        completionDictionary.push({ name: func, path: relativePath });
      }
    });
  });
}

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return;
  }

  workspaceFolder = workspaceFolders[0].uri.fsPath;

  // 加载一下
  refreshWorkspace();

  // 监控init变动
  const documentSaveListener = vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.fileName.endsWith("__init__.py")) {
      const filePath = path.join(document.uri.fsPath);
      const { excludes } = projectConfig.import;
      // 跳过非本项目文件
      if (!filePath.startsWith(workspaceFolder)) {
        return;
      }

      // 跳过忽略的文件夹
      const folders = filePath.replace(workspaceFolder, "").split("\\");
      for (const folder of folders) {
        if (excludes.includes(folder)) {
          return;
        }

        // 跳过以 . 或 _ 开头的文件夹
        if (folder.startsWith(".") || folder.startsWith("_")) {
          return;
        }
      }

      // 跳过 . _开头的文件夹

      if (updateFunctionStore(filePath)) {
        rebuildCompletionDictionary();
      }
    }
    if (document.fileName.endsWith("pyproject.toml")) {
      loadProjectConfig();
    }
  });
  context.subscriptions.push(documentSaveListener);

  // 语言提示
  const completionProvider = vscode.languages.registerCompletionItemProvider(SUPPORTED_LANGUAGES, {
    async provideCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
      context: vscode.CompletionContext
    ) {
      const range = new vscode.Range(new vscode.Position(position.line, 0), position);
      const text = document.getText(range);

      const { relative } = projectConfig.import;

      const completionItems: vscode.CompletionItem[] = completionDictionary
        .filter((item) => item.name.startsWith(text))
        .map((item, idx) => {
          const completionItem = new vscode.CompletionItem(item.name, vscode.CompletionItemKind.Function);
          completionItem.detail = item.path;

          // 这是__int__.py 所在位置
          const funcPath = path.join(workspaceFolder, item.path);

          let tip = "";

          if (relative) {
            // 这是当前文档相对于要导入函数的路径
            const relativePath = path.relative(document.uri.fsPath, funcPath);
            // 处理反斜杠
            let result = relativePath.replace(/\\/g, "/");
            // 移除 `__init__.py` 部分
            result = result.replace(/\/__init__\.py$/, "");

            result = result.replace(/\.\.\//g, ".").replace(/\//g, ".");
            if (!result.startsWith(".")) {
              result = "." + result;
            }
            tip = `from ${result} import ${item.name}`;
          } else {
            // 这是函数路径基于项目路径的相对值
            const relativePath = funcPath.replace(workspaceFolder, "");
            // 处理反斜杠
            let result = relativePath.replace(/\\/g, "/");
            // 移除 `__init__.py` 部分
            result = result.replace(/\/__init__\.py$/, "");
            // 去掉前面多余的/
            result = result.replace("/", "");
            // 中间的路径/ 全部替换为.
            result = result.replace(/\.\.\//g, ".").replace(/\//g, ".");
            tip = `from ${result} import ${item.name}`;
          }

          completionItem.documentation = tip;
          completionItem.insertText = tip;
          return completionItem;
        });
      return completionItems;
    },
  });

  context.subscriptions.push(completionProvider);

  // 重置提示词
  const refreshCommand = vscode.commands.registerCommand("python-importer.refresh", () => {
    refreshWorkspace();
    vscode.window.showInformationMessage("更新函数完毕");
  });

  context.subscriptions.push(refreshCommand);
}

export function deactivate() {}
