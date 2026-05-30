import { Project, SyntaxKind } from "ts-morph";
import * as fs from "fs";

const project = new Project();
project.addSourceFileAtPath("/workspace/app-bo4w33bsdqm9/src/i18n.ts");
const sourceFile = project.getSourceFileOrThrow("src/i18n.ts");

const resourcesDecl = sourceFile.getVariableDeclaration("resources");
const resourcesInit = resourcesDecl.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

const enProp = resourcesInit.getPropertyOrThrow("en");
if (enProp.getKind() === SyntaxKind.PropertyAssignment) {
  const enObj = enProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const translationProp = enObj.getPropertyOrThrow("translation");
  
  if (translationProp.getKind() === SyntaxKind.PropertyAssignment) {
    const transObj = translationProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    
    // Remove the SpreadAssignment if it exists
    const spreadAssignment = transObj.getProperties().find(p => p.getKind() === SyntaxKind.SpreadAssignment);
    if (spreadAssignment) {
      spreadAssignment.remove();
    }
  }
}

sourceFile.saveSync();
console.log("Cleaned up spread assignment from i18n.ts");
