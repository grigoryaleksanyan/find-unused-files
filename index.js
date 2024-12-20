const fs = require("fs");
const path = require("path");
const { parse } = require("@vue/compiler-sfc");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

// Укажите путь к директории с исходным кодом
const directoryPath = path.resolve(__dirname, "../../src");
// Сейчас поддерживается только .js и .vue
const extensions = [".js", ".vue"];
// Укажите путь к директории, на которую ссылается алиас
const aliasMap = {
  "@": path.resolve(__dirname, "src"),
};
// Укажите массив путей для исключения из проверки
const excludedPaths = [
  "/src/main.js", // Точка входа
];

const allFiles = new Set();
const usedFiles = new Set();
const dynamicImportFiles = new Set();

// Настройки парсера babel
const parserOptions = {
  sourceType: "module",
  plugins: [
    "optionalChaining", // Поддержка оператора опциональной цепочки вызовов ?.
    "nullishCoalescingOperator", // Поддержка оператора нулевого слияния ??
  ],
};

// Функция для рекурсивного обхода директории
function findFiles(dir) {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      findFiles(filePath);
    } else if (extensions.includes(path.extname(file))) {
      allFiles.add(filePath);
    }
  });
}

// Функция для проверки, содержит ли путь какой-либо из исключенных путей
function isExcludedPath(filePath) {
  // Нормализуем пути для корректного сравнения
  const normalizedPath = path.normalize(filePath);

  // Проверяем, содержит ли путь какой-либо из исключенных путей
  return excludedPaths.some((excludedPath) =>
    normalizedPath.includes(path.normalize(excludedPath))
  );
}

// Функция для преобразования алиасов в реальные пути
function resolveAlias(importPath) {
  for (const alias in aliasMap) {
    if (importPath.startsWith(alias)) {
      return path.resolve(aliasMap[alias], importPath.slice(alias.length));
    }
  }

  return importPath; // Возвращаем оригинальный путь, если алиас не найден
}

// Функция для получения имени файла из полного пути
function getFileName(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

// Функция для поиска импортов файлов
function findImports(filePath) {
  const ext = path.extname(filePath);
  const content = fs.readFileSync(filePath, "utf-8");

  try {
    let ast;

    if (ext === ".vue") {
      const { descriptor } = parse(content);
      if (descriptor.script) {
        ast = parser.parse(descriptor.script.content, parserOptions);
      } else {
        return;
      }
    } else {
      ast = parser.parse(content, parserOptions);
    }

    traverse(ast, {
      ImportDeclaration(nodePath) {
        const importPath = nodePath.node.source.value;
        const resolvedPath = resolveAlias(importPath);
        usedFiles.add(getFileName(resolvedPath));
      },
      CallExpression(nodePath) {
        // Динамический импорт через import()
        if (
          nodePath.node.callee.type === "Import" &&
          nodePath.node.arguments.length > 0 &&
          nodePath.node.arguments[0].type === "StringLiteral"
        ) {
          const importPath = nodePath.node.arguments[0].value;
          const resolvedPath = resolveAlias(importPath);
          dynamicImportFiles.add(getFileName(resolvedPath));
        }
      },
    });
  } catch (error) {
    console.error(`Ошибка при парсинге файла ${filePath}:`, error);
  }
}

// Функция для вывода статистики неиспользуемых файлов
function analyzeUnusedFiles(unusedFiles, totalFiles) {
  const dirStats = {};

  unusedFiles.forEach((file) => {
    const dir = path.dirname(file);
    dirStats[dir] = (dirStats[dir] || 0) + 1;
  });

  console.log("\nСтатистика неиспользуемых файлов по директориям:");

  Object.entries(dirStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([dir, count]) => {
      console.log(`${dir}:`, count);
    });

  console.log(
    `\nПроцент неиспользуемых файлов: ${(
      (unusedFiles.length / totalFiles) *
      100
    ).toFixed(2)}%`
  );
}

// Запуск поиска
findFiles(directoryPath);
allFiles.forEach((file) => {
  findImports(file);
});

// Определение неиспользуемых файлов
const unusedFiles = [...allFiles].filter((file) => {
  const fileName = getFileName(file);
  return (
    !usedFiles.has(fileName) &&
    !dynamicImportFiles.has(fileName) &&
    !isExcludedPath(file)
  );
});

// Вывод результатов
console.log("Результаты анализа:");
console.log("Всего файлов:", allFiles.size);
console.log("Используемые файлы:", usedFiles.size);
console.log(
  "Используемые файлы с динамическими импортами:",
  dynamicImportFiles.size
);

if (unusedFiles.length) {
  console.log("Неиспользуемые файлы:", unusedFiles.length);

  unusedFiles.forEach((file) => console.log(file));
  analyzeUnusedFiles(unusedFiles, allFiles.size);
} else {
  console.log("Не найдено неиспользуемых файлов.");
}
