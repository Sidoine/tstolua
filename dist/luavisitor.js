"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
class LuaVisitor {
    constructor(sourceFile, typeChecker, moduleVersion) {
        this.sourceFile = sourceFile;
        this.typeChecker = typeChecker;
        this.moduleVersion = moduleVersion;
        this.result = "";
        this.imports = [];
        this.importedVariables = {};
        this.exportedVariables = {};
        this.classDeclarations = [];
        this.currentClassDeclaration = undefined;
        this.exports = [];
        this.errors = [];
        if (typeChecker) {
            const currentModule = typeChecker.getSymbolAtLocation(sourceFile);
            if (currentModule) {
                this.exports = typeChecker.getExportsOfModule(currentModule);
            }
        }
    }
    getResult() {
        let hasExportedVariables = this.imports.length > 0;
        for (const key in this.exportedVariables) {
            hasExportedVariables = true;
            break;
        }
        if (hasExportedVariables) {
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
            let fullModuleName;
            if (this.sourceFile.moduleName === "index") {
                fullModuleName = "__addonName";
            }
            else {
                fullModuleName = `__addonName .. "/${this.sourceFile.moduleName}"`;
            }
            this.result = `local __addonName = ...
local __exports = LibStub:NewLibrary(${fullModuleName}, ${this.moduleVersion})
if not __exports then return end
${this.result}`;
        }
        return this.result;
    }
    writeTabs(tabs) {
        for (let i = 0; i < tabs; i++)
            this.result += "    ";
    }
    addError(node) {
        this.addTextError(node, `Unsupported node ${ts.SyntaxKind[node.kind]}`);
    }
    addTextError(node, text) {
        const position = this.sourceFile.getLineAndCharacterOfPosition(node.pos);
        this.errors.push(`${text} in ${this.sourceFile.fileName}:${position.line + 1}:${position.character + 1}`);
    }
    writeArray(array, tabs, parent, separator = ", ", options) {
        for (let i = 0; i < array.length; i++) {
            if (i > 0)
                this.result += separator;
            this.traverse(array[i], tabs, parent, options);
        }
    }
    traverse(node, tabs, parent, options) {
        node.parent = parent;
        switch (node.kind) {
            case ts.SyntaxKind.ArrayBindingPattern:
                const arrayBindingPattern = node;
                this.writeArray(arrayBindingPattern.elements, tabs, node);
                break;
            case ts.SyntaxKind.ArrayLiteralExpression:
                const arrayLiteralExpression = node;
                this.writeArray(arrayLiteralExpression.elements, tabs, node);
                break;
            case ts.SyntaxKind.ArrowFunction:
                const arrowFunction = node;
                this.result += "function(";
                this.writeArray(arrowFunction.parameters, tabs, node);
                this.result += ")\n";
                if (arrowFunction.body.kind === ts.SyntaxKind.Block) {
                    this.traverse(arrowFunction.body, tabs + 1, node);
                }
                else {
                    this.writeTabs(tabs + 1);
                    this.result += "return ";
                    this.traverse(arrowFunction.body, tabs, node);
                    this.result += "\n";
                }
                this.writeTabs(tabs);
                this.result += "end";
                break;
            case ts.SyntaxKind.BinaryExpression:
                const binary = node;
                this.traverse(binary.left, tabs, node);
                switch (binary.operatorToken.kind) {
                    case ts.SyntaxKind.AmpersandAmpersandToken:
                        this.result += " and ";
                        break;
                    case ts.SyntaxKind.AsteriskToken:
                        this.result += " * ";
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
                    case ts.SyntaxKind.MinusToken:
                        this.result += " - ";
                        break;
                    case ts.SyntaxKind.PercentToken:
                        this.result += " % ";
                        break;
                    case ts.SyntaxKind.PlusToken:
                        this.result += " + ";
                        break;
                    case ts.SyntaxKind.SlashToken:
                        this.result += " / ";
                        break;
                    default:
                        this.addError(binary.operatorToken);
                        this.result += `{Binary ${ts.SyntaxKind[binary.operatorToken.kind]}}`;
                        break;
                }
                this.traverse(binary.right, tabs, node);
                break;
            case ts.SyntaxKind.BindingElement:
                const bindingElement = node;
                this.traverse(bindingElement.name, tabs, node);
                break;
            case ts.SyntaxKind.Block:
                const block = node;
                if (parent && (parent.kind == ts.SyntaxKind.Block || parent.kind == ts.SyntaxKind.SourceFile)) {
                    this.writeTabs(tabs);
                    this.result += "do\n";
                    node.forEachChild(x => this.traverse(x, tabs + 1, node));
                    this.writeTabs(tabs);
                    this.result += "end\n";
                }
                else {
                    node.forEachChild(x => this.traverse(x, tabs, node));
                }
                break;
            case ts.SyntaxKind.BreakStatement:
                this.writeTabs(tabs);
                this.result += "break\n";
                break;
            case ts.SyntaxKind.CallExpression:
                const callExpression = node;
                if (callExpression.expression.getText() === "lualength") {
                    this.result += "#";
                    this.writeArray(callExpression.arguments, tabs, node);
                }
                else {
                    this.traverse(callExpression.expression, tabs, node, { callee: true });
                    this.result += "(";
                    if (callExpression.expression.kind === ts.SyntaxKind.SuperKeyword) {
                        this.result += "self";
                        if (callExpression.arguments.length)
                            this.result += ", ";
                    }
                    this.writeArray(callExpression.arguments, tabs, node);
                    this.result += ")";
                }
                break;
            case ts.SyntaxKind.ClassDeclaration:
                {
                    const classExpression = node;
                    if (this.currentClassDeclaration) {
                        this.classDeclarations.push(this.currentClassDeclaration);
                    }
                    this.currentClassDeclaration = classExpression;
                    let className = undefined;
                    let isExport = false;
                    if (classExpression.name) {
                        isExport = this.writeLocalOrExport(classExpression);
                        this.traverse(classExpression.name, tabs, node);
                        className = classExpression.name.text;
                        if (isExport) {
                            this.exportedVariables[className] = true;
                        }
                        this.result += " = ";
                    }
                    this.result += "__addon.__class(";
                    if (!this.writeHeritage(classExpression, tabs, node)) {
                        this.result += "nil";
                    }
                    this.result += ", {\n";
                    let constructorFound = false;
                    let propertyFound = false;
                    for (const member of classExpression.members) {
                        if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                            if (member.initializer != undefined)
                                propertyFound = true;
                            continue;
                        }
                        if (member.kind === ts.SyntaxKind.Constructor) {
                            constructorFound = true;
                        }
                        this.traverse(member, tabs + 1, node);
                    }
                    if (propertyFound && !constructorFound) {
                        this.writeTabs(tabs + 1);
                        this.result += "constructor = function(self)\n";
                        for (const member of classExpression.members) {
                            if (member.kind !== ts.SyntaxKind.PropertyDeclaration) {
                                if (member.initializer === undefined)
                                    continue;
                            }
                            this.traverse(member, tabs + 2, node);
                        }
                        this.writeTabs(tabs + 1);
                        this.result += "end\n";
                    }
                    if (this.classDeclarations.length > 0) {
                        this.currentClassDeclaration = this.classDeclarations.pop();
                    }
                    else {
                        this.currentClassDeclaration = undefined;
                    }
                    this.writeTabs(tabs);
                    this.result += "})\n";
                    break;
                }
            case ts.SyntaxKind.ClassExpression:
                {
                    const classExpression = node;
                    if (this.currentClassDeclaration) {
                        this.classDeclarations.push(this.currentClassDeclaration);
                    }
                    this.currentClassDeclaration = classExpression;
                    this.result += "__addon.__class(";
                    if (classExpression.heritageClauses) {
                        this.writeHeritage(classExpression, tabs, node);
                    }
                    else {
                        this.result += "nil";
                    }
                    this.result += ", {\n";
                    for (const member of classExpression.members) {
                        if (member.kind === ts.SyntaxKind.PropertyDeclaration)
                            continue;
                        this.traverse(member, tabs + 1, node);
                    }
                    this.writeTabs(tabs);
                    this.result += "})";
                    if (this.classDeclarations.length > 0) {
                        this.currentClassDeclaration = this.classDeclarations.pop();
                    }
                    else {
                        this.currentClassDeclaration = undefined;
                    }
                    break;
                }
            case ts.SyntaxKind.ComputedPropertyName:
                const computedPropertyName = node;
                this.result += "[";
                this.traverse(computedPropertyName.expression, tabs, node);
                this.result += "]";
                break;
            case ts.SyntaxKind.Constructor:
                {
                    const constr = node;
                    this.writeTabs(tabs);
                    this.result += "constructor = function(self";
                    if (constr.parameters.length > 0) {
                        this.result += ", ";
                        this.writeArray(constr.parameters, tabs, node);
                    }
                    this.result += ")\n";
                    for (const parameter of constr.parameters) {
                        if (parameter.modifiers && parameter.modifiers.some(x => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.PublicKeyword)) {
                            this.writeTabs(tabs + 1);
                            this.result += `self.${parameter.name.getText()} = ${parameter.name.getText()}\n`;
                        }
                    }
                    if (constr.parent) {
                        for (const member of constr.parent.members) {
                            if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                                this.traverse(member, tabs + 1, constr.parent);
                            }
                        }
                    }
                    if (constr.body)
                        this.traverse(constr.body, tabs + 1, node);
                    this.writeTabs(tabs);
                    this.result += "end,\n";
                    break;
                }
            case ts.SyntaxKind.DeleteExpression:
                {
                    const deleteExpression = node;
                    this.traverse(deleteExpression.expression, tabs, node);
                    this.result += " = nil";
                    break;
                }
            case ts.SyntaxKind.DoStatement:
                {
                    const doStatement = node;
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
                const elementAccessExpression = node;
                this.traverse(elementAccessExpression.expression, tabs, node);
                this.result += '[';
                if (elementAccessExpression.argumentExpression) {
                    this.traverse(elementAccessExpression.argumentExpression, tabs, node);
                }
                this.result += ']';
                break;
            case ts.SyntaxKind.EndOfFileToken:
                break;
            case ts.SyntaxKind.ExpressionStatement:
                this.writeTabs(tabs);
                this.traverse(node.expression, tabs, node);
                this.result += "\n";
                break;
            case ts.SyntaxKind.ExpressionWithTypeArguments:
                {
                    const expressionWithTypeArguments = node;
                    this.traverse(expressionWithTypeArguments.expression, tabs, node);
                    break;
                }
            case ts.SyntaxKind.FalseKeyword:
                this.result += "false";
                break;
            case ts.SyntaxKind.FirstLiteralToken:
                const firstLiteralToken = node;
                this.result += firstLiteralToken.text;
                break;
            case ts.SyntaxKind.FirstTemplateToken:
                const firstTemplateToken = node;
                this.result += `[[${firstTemplateToken.text}]]`;
                break;
            case ts.SyntaxKind.ForStatement:
                const forStatement = node;
                this.writeTabs(tabs);
                this.result += "for ";
                if (!forStatement.initializer) {
                    this.addTextError(node, "for statement needs an initializer");
                    break;
                }
                this.traverse(forStatement.initializer, tabs, node);
                this.result += ", ";
                if (!forStatement.condition) {
                    this.addTextError(node, "for statement needs a condition");
                    break;
                }
                if (forStatement.condition.kind !== ts.SyntaxKind.BinaryExpression) {
                    this.addTextError(node, "for statement condition must be a binary expression");
                    break;
                }
                const binaryCondition = forStatement.condition;
                if (!forStatement.incrementor) {
                    this.addTextError(node, "for statement needs an incrementor");
                    break;
                }
                if (forStatement.incrementor.kind !== ts.SyntaxKind.BinaryExpression) {
                    this.addTextError(node, "for statement incrementor must be a binary expression");
                    break;
                }
                const binaryIncrementor = forStatement.incrementor;
                if (binaryIncrementor.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
                    this.traverse(binaryCondition.right, tabs, node);
                    this.result += ", ";
                    this.traverse(binaryIncrementor.right, tabs, node);
                }
                else {
                    this.addTextError(node, "only supported incrementor is +=");
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
                const forOfStatement = node;
                if (forOfStatement.initializer.kind === ts.SyntaxKind.ArrayLiteralExpression) {
                    const initializer = forOfStatement.initializer;
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
            case ts.SyntaxKind.FunctionDeclaration:
                {
                    const functionDeclaration = node;
                    const isExport = this.writeLocalOrExport(functionDeclaration);
                    if (functionDeclaration.name) {
                        if (!isExport)
                            this.result += "function ";
                        this.traverse(functionDeclaration.name, tabs, node, { export: isExport });
                    }
                    if (isExport) {
                        this.result += " = function(";
                    }
                    else {
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
                const functionExpression = node;
                this.result += "function(";
                this.writeArray(functionExpression.parameters, tabs, node);
                this.result += ")\n";
                this.traverse(functionExpression.body, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "end\n";
                break;
            case ts.SyntaxKind.Identifier:
                const identifier = node;
                if (identifier.text === "rest") {
                    this.result += "...";
                }
                else if (identifier.text === "undefined") {
                    this.result += "nil";
                }
                else if (identifier.text === "__args") {
                    this.result += "...";
                }
                else {
                    if (this.typeChecker) {
                        const symbol = this.typeChecker.getSymbolAtLocation(node);
                        if (symbol) {
                            if (this.exports.indexOf(symbol) >= 0) {
                                this.result += "__exports.";
                            }
                            this.typeChecker.getRootSymbols(symbol);
                            if ((symbol.flags & ts.SymbolFlags.AliasExcludes) && this.importedVariables[identifier.text]) {
                                this.result += this.importedVariables[identifier.text] + ".";
                            }
                        }
                    }
                    if (options && options.export)
                        this.exportedVariables[identifier.text] = true;
                    this.result += identifier.text;
                }
                break;
            case ts.SyntaxKind.IfStatement:
                const ifStatement = node;
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
                        this.traverse(ifStatement.elseStatement, tabs, node, { elseIf: true });
                    }
                    else {
                        this.result += "else\n";
                        this.traverse(ifStatement.elseStatement, tabs + 1, node);
                    }
                }
                if (!options || !options.elseIf) {
                    this.writeTabs(tabs);
                    this.result += "end\n";
                }
                break;
            case ts.SyntaxKind.ImportClause:
                const importClause = node;
                break;
            case ts.SyntaxKind.ImportDeclaration:
                const importDeclaration = node;
                if (!importDeclaration.importClause)
                    break;
                const module = importDeclaration.moduleSpecifier;
                // if (module.text == "addon" && importDeclaration.importClause.name) {
                //     this.addonModule = importDeclaration.importClause.name.text;
                // }
                // else 
                {
                    if (importDeclaration.importClause.name) {
                        this.imports.push({ module: module.text, variable: importDeclaration.importClause.name.text });
                    }
                    else if (importDeclaration.importClause.namedBindings) {
                        const moduleName = "__" + module.text.replace(/[^\w]/g, "");
                        this.imports.push({ module: module.text, variable: moduleName });
                        const namedImports = importDeclaration.importClause.namedBindings;
                        for (const variable of namedImports.elements) {
                            this.importedVariables[variable.name.text] = moduleName;
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
                const objectLiteralExpression = node;
                if (objectLiteralExpression.properties.length > 0) {
                    this.result += "{\n";
                    this.writeArray(objectLiteralExpression.properties, tabs + 1, node, ",\n");
                    this.result += "\n";
                    this.writeTabs(tabs);
                    this.result += "}";
                }
                else {
                    this.result += "{}";
                }
                break;
            case ts.SyntaxKind.OmittedExpression:
                this.result += "_";
                break;
            case ts.SyntaxKind.MethodDeclaration:
                const methodDeclaration = node;
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
                const newExpression = node;
                this.traverse(newExpression.expression, tabs, node);
                this.result += "(";
                if (newExpression.arguments)
                    this.writeArray(newExpression.arguments, tabs, node);
                this.result += ")";
                break;
            case ts.SyntaxKind.Parameter:
                const parameter = node;
                this.traverse(parameter.name, tabs, node);
                break;
            case ts.SyntaxKind.ParenthesizedExpression:
                const parenthesizedExpression = node;
                this.result += '(';
                this.traverse(parenthesizedExpression.expression, tabs, node);
                this.result += ')';
                break;
            case ts.SyntaxKind.PrefixUnaryExpression:
                const prefixUnaryExpression = node;
                switch (prefixUnaryExpression.operator) {
                    case ts.SyntaxKind.MinusToken:
                        this.result += "-";
                        break;
                    case ts.SyntaxKind.ExclamationToken:
                        this.result += ' not ';
                        break;
                    default:
                        this.errors.push(`Unsupported binary operator token ${ts.SyntaxKind[prefixUnaryExpression.operator]}`);
                        this.result += `{${ts.SyntaxKind[prefixUnaryExpression.operator]}}`;
                        break;
                }
                this.traverse(prefixUnaryExpression.operand, tabs, node);
                break;
            case ts.SyntaxKind.PropertyAccessExpression:
                {
                    const access = node;
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
                            isMethodCall = (symbol.getFlags() & ts.SymbolFlags.Method) > 0;
                        }
                        else {
                            this.addTextError(node, "Unable to know the type of this expression");
                        }
                    }
                    this.result += isMethodCall ? ":" : ".";
                    this.result += access.name.text;
                    break;
                }
            case ts.SyntaxKind.PropertyAssignment:
                const propertyAssignment = node;
                this.writeTabs(tabs);
                if (propertyAssignment.name.getText().match(/^\d/)) {
                    this.result += "[";
                    this.traverse(propertyAssignment.name, tabs, node);
                    this.result += "]";
                }
                else {
                    this.traverse(propertyAssignment.name, tabs, node);
                }
                this.result += " = ";
                this.traverse(propertyAssignment.initializer, tabs, node);
                break;
            case ts.SyntaxKind.PropertyDeclaration:
                {
                    const propertyDeclaration = node;
                    if (propertyDeclaration.initializer) {
                        this.writeTabs(tabs);
                        this.result += "self.";
                        this.traverse(propertyDeclaration.name, tabs, node);
                        this.result += " = ";
                        this.traverse(propertyDeclaration.initializer, tabs, node);
                        this.result += "\n";
                    }
                    break;
                }
            case ts.SyntaxKind.ReturnStatement:
                this.writeTabs(tabs);
                this.result += "return ";
                const returnStatement = node;
                if (returnStatement.expression) {
                    this.traverse(returnStatement.expression, tabs, node);
                }
                this.result += "\n";
                break;
            case ts.SyntaxKind.SourceFile:
                node.forEachChild(x => this.traverse(x, tabs, node));
                break;
            case ts.SyntaxKind.SpreadElement:
                const spreadElement = node;
                this.traverse(spreadElement.expression, tabs, node);
                break;
            case ts.SyntaxKind.StringLiteral:
                const stringLiteral = node;
                this.writeQuotedString(stringLiteral.text);
                break;
            case ts.SyntaxKind.SuperKeyword:
                {
                    if (!this.currentClassDeclaration) {
                        this.addTextError(node, "Unexpected super keyword outside of a class declaration");
                        break;
                    }
                    this.writeHeritage(this.currentClassDeclaration, tabs, node);
                    this.result += ".constructor";
                    break;
                }
            case ts.SyntaxKind.TemplateExpression:
                {
                    const templateExpression = node;
                    // for (const templateSpan of templateExpression.templateSpans) {
                    if (templateExpression.head && templateExpression.head.text.length > 0) {
                        this.traverse(templateExpression.head, tabs, node);
                        if (templateExpression.templateSpans.length > 0)
                            this.result += " .. ";
                    }
                    this.writeArray(templateExpression.templateSpans, tabs, node, " .. ");
                    break;
                }
            case ts.SyntaxKind.TemplateHead:
                {
                    const templateHead = node;
                    this.writeQuotedString(templateHead.text);
                    break;
                }
            case ts.SyntaxKind.TemplateSpan:
                {
                    const templateSpan = node;
                    this.traverse(templateSpan.expression, tabs, node);
                    if (templateSpan.literal && templateSpan.literal.text.length > 0) {
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
            case ts.SyntaxKind.TypeAssertionExpression:
                {
                    const typeAssertionExpression = node;
                    this.traverse(typeAssertionExpression.expression, tabs, node);
                    break;
                }
            case ts.SyntaxKind.VariableDeclaration:
                const variableDeclaration = node;
                if (variableDeclaration.name.kind === ts.SyntaxKind.ArrayBindingPattern) {
                    const arrayBindingPattern = variableDeclaration.name;
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
                const variableDeclarationList = node;
                this.writeArray(variableDeclarationList.declarations, tabs, node, ", ", options);
                break;
            case ts.SyntaxKind.VariableStatement:
                const variableStatement = node;
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
                if (this.hasExportModifier(variableStatement) && variableStatement.declarationList.declarations.every(x => x.initializer == undefined)) {
                    for (const declaration of variableStatement.declarationList.declarations) {
                        this.exportedVariables[declaration.name.getText()] = true;
                    }
                    break;
                }
                const isExport = this.writeLocalOrExport(variableStatement);
                this.traverse(variableStatement.declarationList, tabs, node, { export: isExport });
                this.result += "\n";
                break;
            case ts.SyntaxKind.WhileStatement:
                const whileStatement = node;
                this.writeTabs(tabs);
                this.result += "while ";
                this.traverse(whileStatement.expression, tabs, node);
                this.result += " do\n";
                this.traverse(whileStatement.statement, tabs + 1, node);
                this.writeTabs(tabs);
                this.result += "end\n";
                break;
            case ts.SyntaxKind.YieldExpression:
                const yieldExpression = node;
                this.result += "coroutine.yield(";
                if (yieldExpression.expression)
                    this.traverse(yieldExpression.expression, tabs, node);
                this.result += ")";
                break;
            default:
                this.writeTabs(tabs);
                this.addError(node);
                this.result += "{" + ts.SyntaxKind[node.kind] + "}\n";
                node.forEachChild(x => this.traverse(x, tabs + 1, node));
                break;
        }
    }
    writeHeritage(classExpression, tabs, node) {
        if (!classExpression.heritageClauses)
            return false;
        let found = false;
        for (const heritage of classExpression.heritageClauses) {
            if (heritage.token === ts.SyntaxKind.ExtendsKeyword) {
                this.writeArray(heritage.types, tabs, node);
                found = true;
            }
        }
        return found;
    }
    writeLocalOrExport(node) {
        if (this.hasExportModifier(node)) {
            return true;
        }
        else {
            this.result += "local ";
            return false;
        }
    }
    hasExportModifier(node) {
        return node.modifiers && node.modifiers.some(x => x.kind === ts.SyntaxKind.ExportKeyword);
    }
    writeQuotedString(text) {
        this.result += '"' + text.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/"/g, '\\"') + '"';
    }
}
exports.LuaVisitor = LuaVisitor;
//# sourceMappingURL=luavisitor.js.map