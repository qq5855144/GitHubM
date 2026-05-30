import { Project, SyntaxKind, Node } from "ts-morph";
import * as fs from "fs";

const project = new Project({
  tsConfigFilePath: "/workspace/app-bo4w33bsdqm9/tsconfig.json",
});

project.addSourceFilesAtPaths("/workspace/app-bo4w33bsdqm9/src/**/*.{ts,tsx}");

const zhRegex = /[\u4e00-\u9fa5]/;
let dict: Record<string, string> = {};

const sourceFiles = project.getSourceFiles();

let modifiedFiles = 0;

for (const sourceFile of sourceFiles) {
  const baseName = sourceFile.getBaseName();
  if (baseName === "i18n.ts" || baseName === "LoginPage.tsx" || baseName === "SettingsPage.tsx" || baseName === "GraphQLPlaygroundPage.tsx") continue;
  if (baseName.includes(".test.")) continue;

  let fileModified = false;

  const stringLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral);
  const jsxTexts = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);
  const noSubTemplates = sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral);

  const nodesToReplace: { node: Node, text: string, type: string }[] = [];

  for (const node of jsxTexts) {
    const text = node.getLiteralText();
    if (zhRegex.test(text) && text.trim().length > 0) {
      nodesToReplace.push({ node, text: text.trim(), type: 'jsxText' });
    }
  }

  for (const node of stringLiterals) {
    const text = node.getLiteralValue();
    if (zhRegex.test(text) && text.trim().length > 0) {
      if (node.getParentIfKind(SyntaxKind.ImportDeclaration)) continue;
      // Skip large text blocks to avoid syntax errors
      if (text.length > 50) continue; 
      nodesToReplace.push({ node, text: text.trim(), type: 'string' });
    }
  }

  for (const node of noSubTemplates) {
    const text = node.getLiteralText();
    if (zhRegex.test(text) && text.trim().length > 0) {
      if (text.length > 50) continue;
      nodesToReplace.push({ node, text: text.trim(), type: 'template' });
    }
  }

  if (nodesToReplace.length === 0) continue;

  nodesToReplace.sort((a, b) => b.node.getPos() - a.node.getPos());

  for (const { node, text, type } of nodesToReplace) {
    dict[text] = text;
    try {
      if (type === 'jsxText') {
        node.replaceWithText(`{i18n.t('${text.replace(/'/g, "\\'")}')}`);
        fileModified = true;
      } else if (type === 'string' || type === 'template') {
        const parent = node.getParent();
        if (parent && parent.getKind() === SyntaxKind.JsxAttribute) {
          node.replaceWithText(`{i18n.t('${text.replace(/'/g, "\\'")}')}`);
          fileModified = true;
        } else {
          node.replaceWithText(`i18n.t('${text.replace(/'/g, "\\'")}')`);
          fileModified = true;
        }
      }
    } catch (e) {
      // Ignore errors silently for one node, try next
    }
  }

  if (fileModified) {
    const hasI18n = sourceFile.getImportDeclarations().some(imp => 
      imp.getModuleSpecifierValue() === '@/i18n' || imp.getModuleSpecifierValue() === '../../i18n' || imp.getModuleSpecifierValue() === '../i18n'
    );
    if (!hasI18n) {
      sourceFile.addImportDeclaration({
        defaultImport: "i18n",
        moduleSpecifier: "@/i18n",
      });
    }
    sourceFile.saveSync();
    modifiedFiles++;
  }
}

fs.writeFileSync("/workspace/app-bo4w33bsdqm9/extracted-zh.json", JSON.stringify(dict, null, 2));
console.log(`Done. Modified ${modifiedFiles} files. Extracted ${Object.keys(dict).length} keys.`);
