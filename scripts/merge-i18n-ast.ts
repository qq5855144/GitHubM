import { Project, SyntaxKind } from "ts-morph";
import * as fs from "fs";

const translated = JSON.parse(fs.readFileSync("/workspace/app-bo4w33bsdqm9/translated-en.json", "utf-8"));

const project = new Project();
project.addSourceFileAtPath("/workspace/app-bo4w33bsdqm9/src/i18n.ts");
const sourceFile = project.getSourceFileOrThrow("src/i18n.ts");

// find `const resources = { ... }`
const resourcesDecl = sourceFile.getVariableDeclaration("resources");
const resourcesInit = resourcesDecl.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

const enProp = resourcesInit.getPropertyOrThrow("en");
if (enProp.getKind() === SyntaxKind.PropertyAssignment) {
  const enObj = enProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const translationProp = enObj.getPropertyOrThrow("translation");
  if (translationProp.getKind() === SyntaxKind.PropertyAssignment) {
    const transObj = translationProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    
    // Add all keys from translated
    for (const [key, value] of Object.entries(translated)) {
      // Check if property exists
      const propName = JSON.stringify(key);
      const existing = transObj.getProperty(p => p.getKind() === SyntaxKind.PropertyAssignment && (p.getName() === key || p.getName() === propName));
      if (!existing) {
        transObj.addPropertyAssignment({
          name: propName,
          initializer: JSON.stringify(value)
        });
      } else {
        existing.setInitializer(JSON.stringify(value));
      }
    }
  }
}

sourceFile.saveSync();
console.log("Merged with AST successfully.");
