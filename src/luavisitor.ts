import * as ts from "typescript";
import * as path from "path";
import { isNamedImports, isNamespaceImport } from "typescript";
import { PackageExtras } from "./package-extra";

interface Options {
    elseIf?: boolean;
    callee?: boolean;
    class?: string;
    export?: boolean;
    classConstructor?: boolean;
}

interface ImportVariable {
    alias: string;
    name: string;
    usages: number;
    module: string;
}

interface Import {
    module: string;
    variable?: string;
    variables?: ImportVariable[];
    hasCode?: boolean;
    isExternalLibraryImport?: boolean;
    path?: string;
}

enum ModuleType {
    WithoutObject,
    WithObject,
}

const globalModules: { [key: string]: ModuleType } = {
    ["@wowts/table"]: ModuleType.WithObject,
    ["@wowts/string"]: ModuleType.WithObject,
    ["@wowts/coroutine"]: ModuleType.WithObject,
    ["@wowts/math"]: ModuleType.WithObject,
    ["@wowts/bit"]: ModuleType.WithObject,
    ["@wowts/wow-mock"]: ModuleType.WithoutObject,
    ["@wowts/lua"]: ModuleType.WithoutObject,
};

const enum LuaLib {
    Nothing = 0,
    Class = 1,
    Ternary = 2,
}

export class LuaVisitor {
    private result = "";
    public imports: Import[] = [];
    // private importedVariables: {[name:string]: string} = {};
    private exportedVariables: { [name: string]: boolean } = {};
    private hasExportDefault = false;
    private classDeclarations: ts.ClassLikeDeclaration[] = [];
    private currentClassDeclaration:
        | ts.ClassLikeDeclaration
        | undefined = undefined;
    private exports: ts.Symbol[] = [];
    public errors: string[] = [];
    private luaLib = LuaLib.Nothing;
    private importedVariables: { [name: string]: ImportVariable } = {};
    private forwardUsedLocalSymbols = new Map<ts.Symbol, boolean>();

    constructor(
        private sourceFile: ts.SourceFile,
        private typeChecker: ts.TypeChecker,
        private moduleVersion: number,
        private appName: string,
        private rootDir: string,
        private packageExtras: PackageExtras
    ) {
        if (typeChecker) {
            const currentModule = typeChecker.getSymbolAtLocation(sourceFile);
            if (currentModule) {
                this.exports = typeChecker.getExportsOfModule(currentModule);
            }
        }
    }

    private isStringBinaryOperator(binary: ts.BinaryExpression) {
        const leftType = this.typeChecker.getTypeAtLocation(binary.left);
        const rightType = this.typeChecker.getTypeAtLocation(binary.right);
        return (
            leftType.flags &
                (ts.TypeFlags.String | ts.TypeFlags.StringLiteral) ||
            rightType.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)
        );
    }

    getResult() {
        let hasExportedVariables = this.hasExportDefault;
        const hasForwardDeclaredFunctions = Array.from(
            this.forwardUsedLocalSymbols
        ).some((x) => x[1]);
        for (const key in this.exportedVariables) {
            hasExportedVariables = true;
            break;
        }
        if (
            this.imports.length > 0 ||
            hasExportedVariables ||
            this.luaLib ||
            hasForwardDeclaredFunctions
        ) {
            //             const moduleName = this.sourceFile.moduleName;
            //             const modules = this.imports.map(x => (x.module.indexOf(".") == 0 ? "./" : "") + path.join(path.dirname(moduleName), x.module).replace("\\", "/"));
            //             if (this.imports.length > 0) {
            //                 this.result = `__addon.require("${moduleName}", { "${modules.join("\", \"")}" }, function(__exports, ${this.imports.map(x => x.variable).join(", ")})
            // ${this.result}end)
            // `;
            //             }
            //             else {
            //                 this.result = `__addon.require("${moduleName}", {}, function(__exports)
            // ${this.result}end)
            // `;
            //             }
            //             this.result = `local __addonName, __addon = ...
            //             ${this.result}`;
            let prehambule = "";
            let localPreamble = "";
            if (hasExportedVariables) {
                let fullModuleName: string;
                if (this.sourceFile.moduleName === "./index") {
                    fullModuleName = this.appName;
                } else if (this.sourceFile.moduleName) {
                    fullModuleName = `${
                        this.appName
                    }/${this.sourceFile.moduleName.replace(/^\.\//, "")}`;
                } else {
                    throw Error(
                        `Source ${this.sourceFile.fileName} has no module name`
                    );
                }
                prehambule += `local __exports = LibStub:NewLibrary("${fullModuleName}", ${this.moduleVersion})
if not __exports then return end
`;
            }

            if (this.luaLib) {
                if (this.luaLib === LuaLib.Class) {
                    prehambule +=
                        'local __class = LibStub:GetLibrary("tslib").newClass\n';
                } else {
                    prehambule +=
                        'local __tslib = LibStub:GetLibrary("tslib")\n';
                    if (this.luaLib & LuaLib.Class)
                        prehambule += "local __class = __tslib.newClass\n";
                    if (this.luaLib & LuaLib.Ternary)
                        prehambule +=
                            "local __ternaryWrap = __tslib.ternaryWrap\nlocal __ternaryUnwrap = __tslib.ternaryUwrap\n";
                }
            }

            if (this.imports.length > 0) {
                /*
                 * Only create the __imports table if we are importing
                 * anything not from a global module.
                 */
                let hasImports = false;
                for (const imp of this.imports) {
                    if (globalModules[imp.module] === undefined) {
                        hasImports = true;
                        break;
                    }
                }
                if (hasImports) {
                    prehambule += "local __imports = {}\n";
                }
            }
            for (const imp of this.imports) {
                let moduleVariableName: string;
                if (imp.variables && imp.variables.every((x) => x.usages == 0))
                    continue;
                imp.hasCode = true;

                if (globalModules[imp.module] === undefined) {
                    moduleVariableName =
                        imp.variable ||
                        "__" +
                            imp.module
                                .replace(/^@\w+\//, "")
                                .replace(/[^\w]/g, "");
                    let fullModuleName;
                    if (imp.module.indexOf(".") == 0) {
                        imp.path = path
                            .join(
                                path.dirname(this.sourceFile.fileName),
                                imp.module
                            )
                            .replace(this.rootDir, "")
                            .replace(/\\/g, "/")
                            .replace(/^\//, "");
                        if (imp.path === "index") {
                            fullModuleName = this.appName;
                        } else {
                            fullModuleName = `${this.appName}/${imp.path}`;
                        }
                        prehambule += `__imports.${moduleVariableName} = LibStub:GetLibrary("${fullModuleName}")\n`;
                    } else {
                        const extras = this.packageExtras.getExtras(imp.module);
                        let moduleName = extras.lua.name;
                        fullModuleName = `"${moduleName}"`;
                        if (extras.lua?.isGlobal) {
                            prehambule += `__imports.${moduleVariableName} = ${moduleName}\n`;
                        } else {
                            if (
                                globalModules[imp.module] === ModuleType.WithObject
                            ) {
                                prehambule += `__imports.${moduleVariableName} = LibStub:GetLibrary(${fullModuleName})\n`;
                            } else {
                                prehambule += `__imports.${moduleVariableName} = LibStub:GetLibrary(${fullModuleName}, true)\n`;
                            }
                        }
                        imp.isExternalLibraryImport = true;
                    }
                } else {
                    moduleVariableName = imp.module.replace(/^@\w+\//, "");
                    imp.isExternalLibraryImport = true;
                }
                if (imp.variable) {
                    // Namespace import
                    localPreamble += `local ${imp.variable} = __imports.${moduleVariableName}\n`;
                }
                if (imp.variables) {
                    // Count usages because couldn't find how to filter out Interfaces or this kind of symbols
                    for (const variable of imp.variables.filter(
                        (x) => x.usages > 0
                    )) {
                        if (
                            imp.module === "@wowts/lua" &&
                            variable.name === "kpairs"
                        ) {
                            localPreamble += `local ${variable.alias} = pairs\n`;
                        } else if (
                            globalModules[imp.module] ===
                            ModuleType.WithoutObject
                        ) {
                            localPreamble += `local ${variable.alias} = ${variable.name}\n`;
                        } else if (
                            globalModules[imp.module] ===
                            ModuleType.WithObject
                        ) {
                            localPreamble += `local ${variable.alias} = ${moduleVariableName}.${variable.name}\n`;
                        } else {
                            prehambule += `__imports.${variable.alias} = __imports.${moduleVariableName}.${variable.name}\n`;
                            localPreamble += `local ${variable.alias} = __imports.${variable.alias}\n`;
                        }
                    }
                }
            }

            if (hasForwardDeclaredFunctions) {
                localPreamble +=
                    Array.from(this.forwardUsedLocalSymbols)
                        .filter((x) => x[1])
                        .map(([s]) => `local ${s.name}`)
                        .join("\n") + "\n";
            }

            this.result = prehambule + localPreamble + this.result;
        }

        return this.result;
    }

    writeTabs(tabs: number) {
        for (let i = 0; i < tabs; i++) this.result += "    ";
    }

    addError(node: ts.Node) {
        this.addTextError(node, `Unsupported node ${ts.SyntaxKind[node.kind]}`);
    }

    addTextError(node: ts.Node, text: string) {
        const position = this.sourceFile.getLineAndCharacterOfPosition(
            node.pos
        );
        this.errors.push(
            `${text} in ${this.sourceFile.fileName}:${position.line + 1}:${
                position.character + 1
            }`
        );
    }

    writeArray<T extends ts.Node>(
        array: ts.NodeArray<T>,
        tabs: number,
        parent: ts.Node,
        separator: string = ", ",
        options?: Options
    ) {
        for (let i = 0; i < array.length; i++) {
            if (i > 0) this.result += separator;
            this.traverse(array[i], tabs, parent, options);
        }
    }

    writeClassMembers(
        members: ts.NodeArray<ts.ClassElement>,
        tabs: number,
        node: ts.Node
    ) {
        if (!this.currentClassDeclaration)
            throw Error("this.currentClassDeclaration must be defined");

        let constructorFound = false;
        let propertyFound = false;
        for (const member of members) {
            if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                const propertyDeclaration = <ts.PropertyDeclaration>member;
                if (
                    propertyDeclaration.modifiers &&
                    propertyDeclaration.modifiers.some(
                        (x) => x.kind === ts.SyntaxKind.StaticKeyword
                    )
                ) {
                    if (propertyDeclaration.initializer !== undefined)
                        this.traverse(member, tabs, node);
                    continue;
                }

                if (propertyDeclaration.initializer != undefined)
                    propertyFound = true;
                continue;
            }
            if (member.kind === ts.SyntaxKind.Constructor) {
                constructorFound = true;
            }
            this.traverse(member, tabs, node);
        }
        if (propertyFound && !constructorFound) {
            this.writeTabs(tabs);
            if (
                this.currentClassDeclaration.heritageClauses &&
                this.currentClassDeclaration.heritageClauses.find(
                    (x) => x.token === ts.SyntaxKind.ExtendsKeyword
                )
            ) {
                this.result += "constructor = function(self, ...)\n";
                this.writeTabs(tabs + 1);
                this.writeHeritage(this.currentClassDeclaration, tabs, node);
                this.result += ".constructor(self, ...)\n";
            } else {
                this.result += "constructor = function(self)\n";
            }
            for (const member of members) {
                if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                    const propertyDeclaration = <ts.PropertyDeclaration>member;
                    if (
                        propertyDeclaration.modifiers &&
                        propertyDeclaration.modifiers.some(
                            (x) => x.kind === ts.SyntaxKind.StaticKeyword
                        )
                    )
                        continue;
                    if (propertyDeclaration.initializer === undefined) continue;
                    this.traverse(member, tabs + 1, node);
                }
            }
            this.writeTabs(tabs);
            this.result += "end\n";
        }
    }

    public traverse(
        node: ts.Node,
        tabs: number,
        parent: ts.Node | undefined,
        options?: Options
    ) {
        switch (node.kind) {
            case ts.SyntaxKind.ArrayBindingPattern:
                const arrayBindingPattern = <ts.ArrayBindingPattern>node;
                this.writeArray(arrayBindingPattern.elements, tabs, node);
                break;
            case ts.SyntaxKind.ArrayLiteralExpression:
                const arrayLiteralExpression = <ts.ArrayLiteralExpression>node;
                this.writeArray(arrayLiteralExpression.elements, tabs, node);
                break;
            case ts.SyntaxKind.ArrowFunction:
                const arrowFunction = <ts.ArrowFunction>node;
                this.result += "function(";
                this.writeArray(arrowFunction.parameters, tabs, node);
                this.result += ")\n";
                if (arrowFunction.body.kind === ts.SyntaxKind.Block) {
                    this.traverse(arrowFunction.body, tabs + 1, node);
                } else {
                    this.writeTabs(tabs + 1);
                    this.result += "return ";
                    this.traverse(arrowFunction.body, tabs, node);
                    this.result += "\n";
                }

                this.writeTabs(tabs);
                this.result += "end";
                break;
            case ts.SyntaxKind.AsExpression: {
                const asExpression = <ts.AsExpression>node;
                this.traverse(asExpression.expression, tabs, node);
                break;
            }
            case ts.SyntaxKind.BinaryExpression:
                const binary = <ts.BinaryExpression>node;
                if (
                    binary.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                    ts.isParenthesizedExpression(binary.left)
                ) {
                    this.traverse(binary.left.expression, tabs, node);
                } else {
                    this.traverse(binary.left, tabs, node);
                }

                let parenthesis = false;

                switch (binary.operatorToken.kind) {
                    case ts.SyntaxKind.AmpersandAmpersandToken:
                        this.result += " and ";
                        break;
                    case ts.SyntaxKind.AsteriskToken:
                        this.result += " * ";
                        break;
                    case ts.SyntaxKind.AsteriskEqualsToken:
                        this.result += " = ";
                        this.traverse(binary.left, 0, node);
                        this.result += " * ";
                        parenthesis = true;
                        break;
                    case ts.SyntaxKind.BarBarToken:
                        this.result += " or ";
                        break;
                    case ts.SyntaxKind.CaretToken:
                        this.result += " ^ ";
                        break;
                    case ts.SyntaxKind.EqualsToken:
                        this.result += " = ";
                        break;
                    case ts.SyntaxKind.EqualsEqualsEqualsToken:
                    case ts.SyntaxKind.EqualsEqualsToken:
                        this.result += " == ";
                        break;
                    case ts.SyntaxKind.ExclamationEqualsToken:
                    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
                        this.result += " ~= ";
                        break;
                    case ts.SyntaxKind.GreaterThanToken:
                        this.result += " > ";
                        break;
                    case ts.SyntaxKind.GreaterThanEqualsToken:
                        this.result += " >= ";
                        break;
                    case ts.SyntaxKind.LessThanToken:
                        this.result += " < ";
                        break;
                    case ts.SyntaxKind.LessThanEqualsToken:
                        this.result += " <= ";
                        break;
                    case ts.SyntaxKind.MinusEqualsToken:
                        this.result += " = ";
                        this.traverse(binary.left, 0, node);
                        this.result += " - ";
                        parenthesis = true;
                        break;
                    case ts.SyntaxKind.MinusToken:
                        this.result += " - ";
                        break;
                    case ts.SyntaxKind.PercentToken:
                        this.result += " % ";
                        break;
                    case ts.SyntaxKind.PercentEqualsToken:
                        this.result += " = ";
                        this.traverse(binary.left, 0, node);
                        this.result += " % ";
                        parenthesis = true;
                        break;
                    case ts.SyntaxKind.PlusEqualsToken:
                        this.result += " = ";
                        this.traverse(binary.left, 0, node);
                        if (this.isStringBinaryOperator(binary)) {
                            this.result += " .. ";
                        } else {
                            this.result += " + ";
                        }
                        parenthesis = true;
                        break;
                    case ts.SyntaxKind.PlusToken: {
                        if (this.isStringBinaryOperator(binary)) {
                            this.result += " .. ";
                        } else {
                            this.result += " + ";
                        }
                        break;
                    }
                    case ts.SyntaxKind.SlashToken:
                        this.result += " / ";
                        break;
                    case ts.SyntaxKind.SlashEqualsToken:
                        this.result += " = ";
                        this.traverse(binary.left, 0, node);
                        this.result += " / ";
                        parenthesis = true;
                        break;
                    default:
                        this.addError(binary.operatorToken);
                        this.result += `{Binary ${
                            ts.SyntaxKind[binary.operatorToken.kind]
                        }}`;
                        break;
                }
                parenthesis =
                    parenthesis &&
                    binary.right.kind === ts.SyntaxKind.BinaryExpression;
                if (parenthesis) this.result += "(";
                this.traverse(binary.right, tabs, node);
                if (parenthesis) this.result += ")";
                break;
            case ts.SyntaxKind.BindingElement:
                const bindingElement = <ts.BindingElement>node;
                this.traverse(bindingElement.name, tabs, node);
                break;
            case ts.SyntaxKind.Block:
                if (
                    parent &&
                    (parent.kind == ts.SyntaxKind.Block ||
                        parent.kind == ts.SyntaxKind.SourceFile)
                ) {
                    this.writeTabs(tabs);
                    this.result += "do\n";
                    node.forEachChild((x) => this.traverse(x, tabs + 1, node));
                    this.writeTabs(tabs);
                    this.result += "end\n";
                } else {
                    node.forEachChild((x) => this.traverse(x, tabs, node));
                }
                break;
            case ts.SyntaxKind.BreakStatement:
                this.writeTabs(tabs);
                this.result += "break\n";
                break;
            case ts.SyntaxKind.CallExpression: {
                const callExpression = <ts.CallExpression>node;
                const text = callExpression.expression.getText();
                const importedVariable = this.importedVariables[text];
                if (
                    importedVariable &&
                    importedVariable.name === "lualength" &&
                    importedVariable.module === "@wowts/lua"
                ) {
                    this.result += "#";
                    this.writeArray(callExpression.arguments, tabs, node);
                } else if (
                    importedVariable &&
                    importedVariable.name === "truthy" &&
                    importedVariable.module === "@wowts/lua"
                ) {
                    this.writeArray(callExpression.arguments, tabs, node);
                } else if (
                    importedVariable &&
                    importedVariable.name === "pack" &&
                    importedVariable.module === "@wowts/lua"
                ) {
                    this.result += "{";
                    this.writeArray(callExpression.arguments, tabs, node);
                    this.result += "}";
                } else {
                    this.traverse(callExpression.expression, tabs, node, {
                        callee: true,
                    });
                    this.result += "(";
                    if (
                        callExpression.expression.kind ===
                        ts.SyntaxKind.SuperKeyword
                    ) {
                        this.result += "self";
                        if (callExpression.arguments.length)
                            this.result += ", ";
                    }
                    this.writeArray(callExpression.arguments, tabs, node);
                    this.result += ")";
                }
                break;
            }
            case ts.SyntaxKind.ClassDeclaration: {
                const classExpression = <ts.ClassDeclaration>node;
                if (this.currentClassDeclaration) {
                    this.classDeclarations.push(this.currentClassDeclaration);
                }
                this.currentClassDeclaration = classExpression;
                let className: string | undefined = undefined;
                let isExport: boolean = false;
                if (classExpression.name) {
                    isExport = this.writeLocalOrExport(classExpression);
                    this.traverse(classExpression.name, tabs, node);
                    className = classExpression.name.text;
                    if (isExport) {
                        this.exportedVariables[className] = true;
                    }
                    this.result += " = ";
                }
                this.luaLib |= LuaLib.Class;
                this.result += "__class(";
                if (!this.writeHeritage(classExpression, tabs, node)) {
                    this.result += "nil";
                }
                this.result += ", {\n";
                this.writeClassMembers(classExpression.members, tabs + 1, node);
                if (this.classDeclarations.length > 0) {
                    this.currentClassDeclaration = this.classDeclarations.pop();
                } else {
                    this.currentClassDeclaration = undefined;
                }
                this.writeTabs(tabs);
                this.result += "})\n";
                break;
            }
            case ts.SyntaxKind.ClassExpression: {
                const classExpression = <ts.ClassExpression>node;
                if (this.currentClassDeclaration) {
                    this.classDeclarations.push(this.currentClassDeclaration);
                }
                this.currentClassDeclaration = classExpression;
                this.luaLib |= LuaLib.Class;
                this.result += "__class(";
                if (classExpression.heritageClauses) {
                    this.writeHeritage(classExpression, tabs, node);
                } else {
                    this.result += "nil";
                }
                this.result += ", {\n";
                this.writeClassMembers(classExpression.members, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "})";
                if (this.classDeclarations.length > 0) {
                    this.currentClassDeclaration = this.classDeclarations.pop();
                } else {
                    this.currentClassDeclaration = undefined;
                }
                break;
            }
            case ts.SyntaxKind.ComputedPropertyName:
                const computedPropertyName = <ts.ComputedPropertyName>node;
                this.result += "[";
                this.traverse(computedPropertyName.expression, tabs, node);
                this.result += "]";
                break;
            case ts.SyntaxKind.ConditionalExpression: {
                const conditionalExpression = <ts.ConditionalExpression>node;
                const trueType = this.typeChecker.getTypeAtLocation(
                    conditionalExpression.whenTrue
                );
                const needWrap =
                    trueType.flags &
                    (ts.TypeFlags.BooleanLike |
                        ts.TypeFlags.StringLike |
                        ts.TypeFlags.NumberLike);
                if (needWrap) {
                    this.luaLib |= LuaLib.Ternary;
                    this.result += "__ternaryUnwrap(";
                }
                this.result += "(";
                this.traverse(conditionalExpression.condition, tabs, node);
                this.result += " and ";
                if (needWrap) {
                    this.result += "__ternaryWrap(";
                }
                this.traverse(conditionalExpression.whenTrue, tabs, node);
                if (needWrap) {
                    this.result += ")";
                }
                this.result += ") or ";
                this.traverse(conditionalExpression.whenFalse, tabs, node);
                if (needWrap) {
                    this.result += ")";
                }
                break;
            }
            case ts.SyntaxKind.Constructor: {
                const constr = <ts.ConstructorDeclaration>node;
                this.writeTabs(tabs);
                this.result += "constructor = function(self";
                if (constr.parameters.length > 0) {
                    this.result += ", ";
                    this.writeArray(constr.parameters, tabs, node);
                }
                this.result += ")\n";
                for (const parameter of constr.parameters) {
                    if (
                        parameter.modifiers &&
                        parameter.modifiers.some(
                            (x) =>
                                x.kind === ts.SyntaxKind.PrivateKeyword ||
                                x.kind === ts.SyntaxKind.PublicKeyword
                        )
                    ) {
                        this.writeTabs(tabs + 1);
                        this.result += `self.${parameter.name.getText()} = ${parameter.name.getText()}\n`;
                    }
                }
                if (constr.parent) {
                    for (const member of constr.parent.members) {
                        if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                            const propertyDeclaration = <
                                ts.PropertyDeclaration
                            >member;
                            if (propertyDeclaration.initializer === undefined)
                                continue;
                            if (
                                propertyDeclaration.modifiers !== undefined &&
                                propertyDeclaration.modifiers.some(
                                    (x) =>
                                        x.kind === ts.SyntaxKind.StaticKeyword
                                )
                            )
                                continue;
                            this.traverse(member, tabs + 1, constr.parent);
                        }
                    }
                }
                if (constr.body) this.traverse(constr.body, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "end,\n";
                break;
            }
            case ts.SyntaxKind.DeleteExpression: {
                const deleteExpression = <ts.DeleteExpression>node;
                this.traverse(deleteExpression.expression, tabs, node);
                this.result += " = nil";
                break;
            }
            case ts.SyntaxKind.DoStatement: {
                const doStatement = <ts.DoStatement>node;
                this.writeTabs(tabs);
                this.result += "repeat\n";
                this.traverse(doStatement.statement, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "until not (";
                this.traverse(doStatement.expression, tabs, node);
                this.result += ")\n";
                break;
            }
            case ts.SyntaxKind.ElementAccessExpression:
                const elementAccessExpression = <ts.ElementAccessExpression>(
                    node
                );
                this.traverse(elementAccessExpression.expression, tabs, node);
                this.result += "[";
                if (elementAccessExpression.argumentExpression) {
                    this.traverse(
                        elementAccessExpression.argumentExpression,
                        tabs,
                        node
                    );
                }
                this.result += "]";
                break;
            case ts.SyntaxKind.EndOfFileToken:
                break;
            case ts.SyntaxKind.EnumDeclaration:
                break;
            case ts.SyntaxKind.ExportAssignment: {
                const exportAssignment = <ts.ExportAssignment>node;
                this.writeTabs(tabs);
                this.result += "for k,v in pairs(";
                this.traverse(exportAssignment.expression, tabs, node);
                this.result += ") do __exports[k] = v end\n";
                this.hasExportDefault = true;
                break;
            }
            case ts.SyntaxKind.ExpressionStatement:
                this.writeTabs(tabs);
                this.traverse(
                    (<ts.ExpressionStatement>node).expression,
                    tabs,
                    node
                );
                this.result += "\n";
                break;
            case ts.SyntaxKind.ExpressionWithTypeArguments: {
                const expressionWithTypeArguments = <
                    ts.ExpressionWithTypeArguments
                >node;
                this.traverse(
                    expressionWithTypeArguments.expression,
                    tabs,
                    node
                );
                break;
            }
            case ts.SyntaxKind.FalseKeyword:
                this.result += "false";
                break;
            case ts.SyntaxKind.FirstLiteralToken:
                const firstLiteralToken = <ts.Identifier>node;
                this.result += firstLiteralToken.text;
                break;
            case ts.SyntaxKind.FirstTemplateToken:
                const firstTemplateToken = <ts.Identifier>node;
                this.result += `[[${firstTemplateToken.text}]]`;
                break;
            case ts.SyntaxKind.ForStatement:
                const forStatement = <ts.ForStatement>node;
                this.writeTabs(tabs);
                this.result += "for ";
                if (!forStatement.initializer) {
                    this.addTextError(
                        node,
                        "for statement needs an initializer"
                    );
                    break;
                }

                this.traverse(forStatement.initializer, tabs, node);
                this.result += ", ";
                if (!forStatement.condition) {
                    this.addTextError(node, "for statement needs a condition");
                    break;
                }

                if (
                    forStatement.condition.kind !==
                    ts.SyntaxKind.BinaryExpression
                ) {
                    this.addTextError(
                        node,
                        "for statement condition must be a binary expression"
                    );
                    break;
                }

                const binaryCondition = <ts.BinaryExpression>(
                    forStatement.condition
                );

                if (!forStatement.incrementor) {
                    this.addTextError(
                        node,
                        "for statement needs an incrementor"
                    );
                    break;
                }

                if (
                    forStatement.incrementor.kind ===
                    ts.SyntaxKind.PostfixUnaryExpression
                ) {
                    this.traverse(binaryCondition.right, tabs, node);
                    this.result += ", 1";
                } else if (
                    forStatement.incrementor.kind ===
                    ts.SyntaxKind.BinaryExpression
                ) {
                    const binaryIncrementor = <ts.BinaryExpression>(
                        forStatement.incrementor
                    );

                    if (
                        binaryIncrementor.operatorToken.kind ===
                        ts.SyntaxKind.PlusEqualsToken
                    ) {
                        this.traverse(binaryCondition.right, tabs, node);
                        this.result += ", ";
                        this.traverse(binaryIncrementor.right, tabs, node);
                    } else {
                        this.addTextError(
                            node,
                            "only supported incrementor is +="
                        );
                        break;
                    }
                } else {
                    this.addTextError(
                        node,
                        "for statement incrementor must be a binary expression"
                    );
                    break;
                }
                this.result += " do\n";
                this.traverse(forStatement.statement, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "end\n";
                break;
            case ts.SyntaxKind.ForOfStatement:
                this.writeTabs(tabs);
                this.result += "for ";
                const forOfStatement = <ts.ForOfStatement>node;
                if (
                    forOfStatement.initializer.kind ===
                    ts.SyntaxKind.ArrayLiteralExpression
                ) {
                    const initializer = <ts.ArrayLiteralExpression>(
                        forOfStatement.initializer
                    );
                    if (initializer.elements.length === 0) {
                        this.result += "_";
                    }
                }
                this.traverse(forOfStatement.initializer, tabs, node);
                this.result += " in ";
                this.traverse(forOfStatement.expression, tabs, node);
                this.result += " do\n";
                this.traverse(forOfStatement.statement, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "end\n";
                break;
            case ts.SyntaxKind.FunctionDeclaration: {
                const functionDeclaration = <ts.FunctionDeclaration>node;
                if (!functionDeclaration.body) break;
                const symbol =
                    functionDeclaration.name &&
                    this.typeChecker.getSymbolAtLocation(
                        functionDeclaration.name
                    );
                const isExport = this.hasExportModifier(functionDeclaration);
                const isForwardDeclared =
                    !isExport &&
                    symbol &&
                    this.forwardUsedLocalSymbols.get(symbol);
                if (!isForwardDeclared)
                    this.writeLocalOrExport(functionDeclaration);

                if (functionDeclaration.name) {
                    if (!isExport) {
                        if (!isForwardDeclared && symbol) {
                            this.result += "function ";
                            this.forwardUsedLocalSymbols.set(symbol, false);
                        }
                    }
                    this.traverse(functionDeclaration.name, tabs, node, {
                        export: isExport,
                    });
                }
                if (isExport || isForwardDeclared) {
                    this.result += " = function(";
                } else {
                    this.result += "(";
                }
                this.writeArray(functionDeclaration.parameters, tabs, node);
                this.result += ")\n";
                if (functionDeclaration.body) {
                    this.traverse(functionDeclaration.body, tabs + 1, node);
                }
                this.writeTabs(tabs);
                this.result += "end\n";
                break;
            }
            case ts.SyntaxKind.FunctionExpression:
                const functionExpression = <ts.FunctionExpression>node;
                this.result += "function(";
                this.writeArray(functionExpression.parameters, tabs, node);
                this.result += ")\n";
                this.traverse(functionExpression.body, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "end\n";
                break;
            case ts.SyntaxKind.Identifier:
                const identifier = <ts.Identifier>node;

                if (identifier.text === "undefined") {
                    this.result += "nil";
                } else {
                    if (this.typeChecker) {
                        const symbol = this.typeChecker.getSymbolAtLocation(
                            node
                        );
                        if (symbol) {
                            if (
                                symbol.valueDeclaration &&
                                symbol.valueDeclaration.kind ===
                                    ts.SyntaxKind.Parameter &&
                                (symbol.valueDeclaration as ts.ParameterDeclaration)
                                    .dotDotDotToken
                            ) {
                                this.result += "...";
                                break;
                            }
                            const importedVariable =
                                symbol.flags & ts.SymbolFlags.AliasExcludes
                                    ? this.importedVariables[identifier.text]
                                    : undefined;

                            if (
                                importedVariable &&
                                importedVariable.name === "version" &&
                                importedVariable.module === "@wowts/lua"
                            ) {
                                this.result += `"${this.moduleVersion}"`;
                                break;
                            }
                            if (this.exports.indexOf(symbol) >= 0) {
                                this.result += "__exports.";
                            } else if (
                                importedVariable &&
                                options &&
                                options.classConstructor
                            ) {
                                this.result += "__imports.";
                            } else if (
                                importedVariable === undefined &&
                                symbol.flags & ts.SymbolFlags.Function &&
                                !this.forwardUsedLocalSymbols.has(symbol)
                            ) {
                                this.forwardUsedLocalSymbols.set(symbol, true);
                            }
                            // this.typeChecker.getRootSymbols(symbol)
                            if (importedVariable) {
                                importedVariable.usages++;
                            }
                        }
                    }
                    if (options && options.export)
                        this.exportedVariables[identifier.text] = true;
                    this.result += identifier.text;
                }
                break;
            case ts.SyntaxKind.IfStatement:
                const ifStatement = <ts.IfStatement>node;
                if (!options || !options.elseIf) {
                    this.writeTabs(tabs);
                    this.result += "if ";
                }
                this.traverse(ifStatement.expression, tabs, node);
                this.result += " then\n";
                this.traverse(ifStatement.thenStatement, tabs + 1, node);
                if (ifStatement.elseStatement) {
                    this.writeTabs(tabs);
                    const innerStatement = ifStatement.elseStatement;
                    if (innerStatement.kind === ts.SyntaxKind.IfStatement) {
                        this.result += "elseif ";
                        this.traverse(ifStatement.elseStatement, tabs, node, {
                            elseIf: true,
                        });
                    } else {
                        this.result += "else\n";
                        this.traverse(
                            ifStatement.elseStatement,
                            tabs + 1,
                            node
                        );
                    }
                }
                if (!options || !options.elseIf) {
                    this.writeTabs(tabs);
                    this.result += "end\n";
                }
                break;
            case ts.SyntaxKind.ImportClause:
                const importClause = <ts.ImportClause>node;
                break;
            case ts.SyntaxKind.ImportDeclaration:
                const importDeclaration = <ts.ImportDeclaration>node;
                if (!importDeclaration.importClause) break;
                const module = <ts.StringLiteral>(
                    importDeclaration.moduleSpecifier
                );
                // if (module.text == "addon" && importDeclaration.importClause.name) {
                //     this.addonModule = importDeclaration.importClause.name.text;
                // }
                // else
                {
                    if (importDeclaration.importClause.name) {
                        this.imports.push({
                            module: module.text,
                            variable: importDeclaration.importClause.name.text,
                        });
                    } else if (importDeclaration.importClause.namedBindings) {
                        // const moduleName =  "__" + module.text.replace(/[^\w]/g, "");
                        const variables: ImportVariable[] = [];
                        this.imports.push({
                            module: module.text,
                            variables: variables,
                        });
                        const importClauseNamedBindings =
                            importDeclaration.importClause.namedBindings;
                        if (isNamedImports(importClauseNamedBindings)) {
                            const namedImports = importClauseNamedBindings;
                            for (const variable of namedImports.elements) {
                                const propertyName = variable.propertyName;
                                const description = {
                                    name: propertyName
                                        ? propertyName.text
                                        : variable.name.text,
                                    usages: 0,
                                    alias: variable.name.text,
                                    module: module.text,
                                };
                                variables.push(description);
                                this.importedVariables[
                                    description.alias
                                ] = description;
                            }
                        } else {
                            this.addError(importClauseNamedBindings);
                        }
                    }
                }
                break;
            case ts.SyntaxKind.IndexSignature:
                // Not needed, it's an index signature in a class declaration
                break;
            case ts.SyntaxKind.InterfaceDeclaration:
                // Interfaces are skipped
                break;
            case ts.SyntaxKind.ObjectLiteralExpression:
                const objectLiteralExpression = <ts.ObjectLiteralExpression>(
                    node
                );
                if (objectLiteralExpression.properties.length > 0) {
                    this.result += "{\n";
                    this.writeArray(
                        objectLiteralExpression.properties,
                        tabs + 1,
                        node,
                        ",\n"
                    );
                    this.result += "\n";
                    this.writeTabs(tabs);
                    this.result += "}";
                } else {
                    this.result += "{}";
                }
                break;
            case ts.SyntaxKind.OmittedExpression:
                this.result += "_";
                break;
            case ts.SyntaxKind.MethodDeclaration:
                const methodDeclaration = <ts.MethodDeclaration>node;
                this.writeTabs(tabs);
                this.traverse(methodDeclaration.name, tabs, node);
                this.result += " = function(self";
                if (methodDeclaration.parameters.length > 0) {
                    this.result += ", ";
                    this.writeArray(methodDeclaration.parameters, tabs, node);
                }
                this.result += ")\n";
                if (methodDeclaration.body)
                    this.traverse(methodDeclaration.body, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "end,\n";
                break;

            case ts.SyntaxKind.NewExpression:
                const newExpression = <ts.NewExpression>node;
                this.traverse(newExpression.expression, tabs, node, {
                    classConstructor: true,
                });
                this.result += "(";
                if (newExpression.arguments)
                    this.writeArray(newExpression.arguments, tabs, node);
                this.result += ")";
                break;
            case ts.SyntaxKind.NonNullExpression: {
                const nonNullExpression = <ts.NonNullExpression>node;
                this.traverse(nonNullExpression.expression, tabs, node);
                break;
            }
            case ts.SyntaxKind.Parameter:
                const parameter = <ts.ParameterDeclaration>node;
                if (parameter.dotDotDotToken) {
                    this.result += "...";
                } else {
                    this.traverse(parameter.name, tabs, node);
                }
                break;
            case ts.SyntaxKind.ParenthesizedExpression: {
                const parenthesizedExpression = <ts.ParenthesizedExpression>(
                    node
                );
                const parenthesis =
                    parenthesizedExpression.expression.kind !==
                        ts.SyntaxKind.AsExpression ||
                    (parenthesizedExpression.expression as ts.AsExpression)
                        .expression.kind !== ts.SyntaxKind.Identifier;
                if (parenthesis) this.result += "(";
                this.traverse(parenthesizedExpression.expression, tabs, node);
                if (parenthesis) this.result += ")";
                break;
            }
            case ts.SyntaxKind.PrefixUnaryExpression:
                const prefixUnaryExpression = <ts.PrefixUnaryExpression>node;
                switch (prefixUnaryExpression.operator) {
                    case ts.SyntaxKind.MinusToken:
                        this.result += "-";
                        break;
                    case ts.SyntaxKind.ExclamationToken:
                        this.result += " not ";
                        break;
                    default:
                        this.errors.push(
                            `Unsupported binary operator token ${
                                ts.SyntaxKind[prefixUnaryExpression.operator]
                            }`
                        );
                        this.result += `{${
                            ts.SyntaxKind[prefixUnaryExpression.operator]
                        }}`;
                        break;
                }
                this.traverse(prefixUnaryExpression.operand, tabs, node);
                break;
            case ts.SyntaxKind.PropertyAccessExpression: {
                const access = <ts.PropertyAccessExpression>node;
                const type = this.typeChecker.getTypeAtLocation(node);
                if (
                    type &&
                    type.symbol &&
                    type.symbol.flags & ts.SymbolFlags.EnumMember
                ) {
                    const propertyValueDeclaration = this.typeChecker.getTypeAtLocation(
                        node
                    ).symbol.valueDeclaration;
                    if (
                        propertyValueDeclaration &&
                        propertyValueDeclaration.kind ===
                            ts.SyntaxKind.EnumMember
                    ) {
                        const enumMember = propertyValueDeclaration as ts.EnumMember;
                        if (enumMember.initializer) {
                            this.traverse(enumMember.initializer, tabs, node);
                        } else {
                            // TODO better calculation (in case of intermediate values that initialize the const)
                            this.result += enumMember.parent.members.indexOf(
                                enumMember
                            );
                        }
                        break;
                    }
                }

                this.traverse(access.expression, tabs, node);

                let isMethodCall = false;
                if (options && options.callee) {
                    // const symbol = this.typeChecker.getSymbolAtLocation(access.expression);
                    // if (symbol) {
                    //     const typeOfSymbol = this.typeChecker.getTypeOfSymbolAtLocation(symbol, access.expression);
                    //     const property = typeOfSymbol.getProperty(access.name.text);
                    //     if (property && (property.flags & ts.SymbolFlags.Method)) {
                    //         isMethodCall = true;
                    //     }
                    // }
                    const symbol = this.typeChecker.getSymbolAtLocation(access);
                    if (symbol !== undefined) {
                        isMethodCall =
                            (symbol.getFlags() & ts.SymbolFlags.Method) > 0;
                    } else {
                        this.addTextError(
                            node,
                            "Unable to know the type of this expression"
                        );
                    }
                }
                this.result += isMethodCall ? ":" : ".";
                this.result += access.name.text;
                break;
            }
            case ts.SyntaxKind.PropertyAssignment:
                const propertyAssignment = <ts.PropertyAssignment>node;
                this.writeTabs(tabs);
                if (
                    propertyAssignment.name.kind !== ts.SyntaxKind.Identifier &&
                    propertyAssignment.name.kind !==
                        ts.SyntaxKind.ComputedPropertyName
                ) {
                    this.result += "[";
                    this.traverse(propertyAssignment.name, tabs, node);
                    this.result += "]";
                } else {
                    this.traverse(propertyAssignment.name, tabs, node);
                }
                this.result += " = ";
                this.traverse(propertyAssignment.initializer, tabs, node);
                break;
            case ts.SyntaxKind.PropertyDeclaration: {
                const propertyDeclaration = <ts.PropertyDeclaration>node;
                if (propertyDeclaration.initializer) {
                    this.writeTabs(tabs);
                    const staticProperty =
                        propertyDeclaration.modifiers &&
                        propertyDeclaration.modifiers.some(
                            (x) => x.kind === ts.SyntaxKind.StaticKeyword
                        );
                    if (!staticProperty) this.result += "self.";
                    this.traverse(propertyDeclaration.name, tabs, node);
                    this.result += " = ";
                    this.traverse(propertyDeclaration.initializer, tabs, node);
                    if (staticProperty) this.result += ",";
                    this.result += "\n";
                }
                break;
            }
            case ts.SyntaxKind.RegularExpressionLiteral: {
                const regularExpressionLiteral = <ts.RegularExpressionLiteral>(
                    node
                );
                this.result += "Regex(";
                this.writeQuotedString(regularExpressionLiteral.text);
                this.result += ")";
                break;
            }
            case ts.SyntaxKind.ReturnStatement:
                this.writeTabs(tabs);
                this.result += "return ";
                const returnStatement = <ts.ReturnStatement>node;
                if (returnStatement.expression) {
                    this.traverse(returnStatement.expression, tabs, node);
                }
                this.result += "\n";
                break;
            case ts.SyntaxKind.SourceFile:
                node.forEachChild((x) => this.traverse(x, tabs, node));
                break;
            case ts.SyntaxKind.SpreadElement:
                const spreadElement = <ts.SpreadElement>node;
                this.traverse(spreadElement.expression, tabs, node);
                break;
            case ts.SyntaxKind.StringLiteral:
                const stringLiteral = <ts.StringLiteral>node;
                this.writeQuotedString(stringLiteral.text);
                break;
            case ts.SyntaxKind.SuperKeyword: {
                if (!this.currentClassDeclaration) {
                    this.addTextError(
                        node,
                        "Unexpected super keyword outside of a class declaration"
                    );
                    break;
                }
                this.writeHeritage(this.currentClassDeclaration, tabs, node);
                this.result += ".constructor";
                break;
            }
            case ts.SyntaxKind.TemplateExpression: {
                const templateExpression = <ts.TemplateExpression>node;
                // for (const templateSpan of templateExpression.templateSpans) {
                if (
                    templateExpression.head &&
                    templateExpression.head.text.length > 0
                ) {
                    this.traverse(templateExpression.head, tabs, node);
                    if (templateExpression.templateSpans.length > 0)
                        this.result += " .. ";
                }
                this.writeArray(
                    templateExpression.templateSpans,
                    tabs,
                    node,
                    " .. "
                );
                break;
            }
            case ts.SyntaxKind.TemplateHead: {
                const templateHead = <ts.TemplateHead>node;
                this.writeQuotedString(templateHead.text);
                break;
            }
            case ts.SyntaxKind.TemplateSpan: {
                const templateSpan = <ts.TemplateSpan>node;
                if (
                    templateSpan.expression.kind ===
                    ts.SyntaxKind.BinaryExpression
                )
                    this.result += "(";
                this.traverse(templateSpan.expression, tabs, node);
                if (
                    templateSpan.expression.kind ===
                    ts.SyntaxKind.BinaryExpression
                )
                    this.result += ")";
                if (
                    templateSpan.literal &&
                    templateSpan.literal.text.length > 0
                ) {
                    this.result += " .. ";
                    this.writeQuotedString(templateSpan.literal.text);
                }
                break;
            }
            case ts.SyntaxKind.ThisKeyword:
                this.result += "self";
                break;
            case ts.SyntaxKind.TrueKeyword:
                this.result += "true";
                break;
            case ts.SyntaxKind.TypeAliasDeclaration:
                // Type alias declaration is not needed
                break;
            case ts.SyntaxKind.TypeAssertionExpression: {
                const typeAssertionExpression = <ts.TypeAssertion>node;
                this.traverse(typeAssertionExpression.expression, tabs, node);
                break;
            }
            case ts.SyntaxKind.VariableDeclaration:
                const variableDeclaration = <ts.VariableDeclaration>node;
                if (
                    variableDeclaration.name.kind ===
                    ts.SyntaxKind.ArrayBindingPattern
                ) {
                    const arrayBindingPattern = <ts.ArrayBindingPattern>(
                        variableDeclaration.name
                    );
                    if (arrayBindingPattern.elements.length == 0)
                        this.result += "_";
                }
                this.traverse(variableDeclaration.name, tabs, node, options);

                if (variableDeclaration.initializer) {
                    this.result += " = ";
                    this.traverse(variableDeclaration.initializer, tabs, node);
                }
                break;
            case ts.SyntaxKind.VariableDeclarationList:
                const variableDeclarationList = <ts.VariableDeclarationList>(
                    node
                );
                this.writeArray(
                    variableDeclarationList.declarations,
                    tabs,
                    node,
                    ", ",
                    options
                );
                break;
            case ts.SyntaxKind.VariableStatement:
                const variableStatement = <ts.VariableStatement>node;
                this.writeTabs(tabs);

                // if (variableStatement.declarationList.declarations.length === 1) {
                //     const variableDeclaration = variableStatement.declarationList.declarations[0];
                //     if (variableDeclaration.initializer && variableDeclaration.initializer.kind === ts.SyntaxKind.Identifier) {
                //         const identifier = <ts.Identifier>variableDeclaration.initializer;
                //         if (identifier.text === this.addonModule) {
                //             const left = <ts.ArrayBindingPattern>variableDeclaration.name
                //             this.addonNameVariable = (<ts.BindingElement>left.elements[0]).name.getText();
                //             this.addonVariable = (<ts.BindingElement>left.elements[1]).name.getText();
                //             break;
                //         }
                //     }
                // }

                if (
                    this.hasExportModifier(variableStatement) &&
                    variableStatement.declarationList.declarations.every(
                        (x) => x.initializer == undefined
                    )
                ) {
                    for (const declaration of variableStatement.declarationList
                        .declarations) {
                        this.exportedVariables[
                            declaration.name.getText()
                        ] = true;
                    }
                    break;
                }

                const isExport = this.writeLocalOrExport(variableStatement);
                this.traverse(variableStatement.declarationList, tabs, node, {
                    export: isExport,
                });
                this.result += "\n";
                break;
            case ts.SyntaxKind.WhileStatement:
                const whileStatement = <ts.WhileStatement>node;
                this.writeTabs(tabs);
                this.result += "while ";
                this.traverse(whileStatement.expression, tabs, node);
                this.result += " do\n";
                this.traverse(whileStatement.statement, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "end\n";
                break;
            case ts.SyntaxKind.YieldExpression:
                const yieldExpression = <ts.YieldExpression>node;
                this.result += "coroutine.yield(";
                if (yieldExpression.expression)
                    this.traverse(yieldExpression.expression, tabs, node);
                this.result += ")";
                break;
            default:
                this.writeTabs(tabs);
                this.addError(node);
                this.result += "{" + ts.SyntaxKind[node.kind] + "}\n";
                node.forEachChild((x) => this.traverse(x, tabs + 1, node));
                break;
        }
    }

    private writeHeritage(
        classExpression: ts.ClassLikeDeclaration,
        tabs: number,
        node: ts.Node
    ) {
        if (!classExpression.heritageClauses) return false;
        let found = false;
        for (const heritage of classExpression.heritageClauses) {
            if (heritage.token === ts.SyntaxKind.ExtendsKeyword) {
                this.writeArray(heritage.types, tabs, node);
                found = true;
            }
        }
        return found;
    }

    private writeLocalOrExport(node: ts.Node) {
        if (this.hasExportModifier(node)) {
            return true;
        } else {
            this.result += "local ";
            return false;
        }
    }

    private hasExportModifier(node: ts.Node) {
        return (
            node.modifiers &&
            node.modifiers.some((x) => x.kind === ts.SyntaxKind.ExportKeyword)
        );
    }

    private writeQuotedString(text: string) {
        this.result +=
            '"' +
            text
                .replace(/\\/g, "\\\\")
                .replace(/\r/g, "\\r")
                .replace(/\n/g, "\\n")
                .replace(/"/g, '\\"') +
            '"';
    }
}
