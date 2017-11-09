import { test, TestContext } from "ava";
import * as ts from "typescript";
import { LuaVisitor } from "../luavisitor";
import * as fs from "fs";

let i = 0;
if (!fs.existsSync("testfiles")) fs.mkdirSync("testfiles");

function testTransform(t:TestContext, source: string) {
    const dir = "testfiles/test" + (i++);
    const fileName = dir + "/source.ts";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(fileName, source);
    const program = ts.createProgram([fileName], { module: ts.ModuleKind.CommonJS, emitDecoratorMetadata: false, rootDir: dir });
    t.deepEqual(program.getSyntacticDiagnostics().map(x => {
        return x.messageText + " at " + (x.file && x.start && x.file.getLineAndCharacterOfPosition(x.start).line)
    } ), []);
    let sourceFile = program.getSourceFile(fileName);
    sourceFile.moduleName = "./source";
    //const sourceFile = ts.createSourceFile("source.ts", source, ts.ScriptTarget.ES2015, false);
    // TODO how to create the type checker without the program or how to create a program from a source file?
    const visitor = new LuaVisitor(sourceFile, program.getTypeChecker(), 1, "test", "");
    visitor.traverse(sourceFile, 0, undefined);
    fs.unlinkSync(fileName);
    return visitor.getResult();
}

test(t => {
    t.is(testTransform(t, "let a = 2 + 3;"), `local a = 2 + 3
`);
});

test(t =>  {
    t.is(testTransform(t, "a.b = a.c(a.d)"), `a.b = a.c(a.d)
`);
});

test(t => {
    t.is(testTransform(t, `if (!a != 4) {
    b = 3.5;
} else if (a == 4) {
    b = 4 + (3 * 4);
} else {
    c = 4;
}
`),`if  not a ~= 4 then
    b = 3.5
elseif a == 4 then
    b = 4 + (3 * 4)
else
    c = 4
end
`);
});


test(t => {
    t.is(testTransform(t, `for (let k = lualength(test); k >= 1; k += -1) {
}`), `for k = #test, 1, -1 do
end
`);
});

test(t => {
    t.is(testTransform(t, `class Test extends Base {
        constructor() {
            super(16);
        }
}`), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(Base, {
    constructor = function(self)
        Base.constructor(self, 16)
    end,
})
`); 
});

test(t => {
    t.is(testTransform(t, `import { OvaleScripts } from "./OvaleScripts";
let a = OvaleScripts;
import Test from 'Test';
import AceAddon from "ace_addon-3.0";
export const bla = 3;
`), `local __exports = LibStub:NewLibrary("test/source", 1)
if not __exports then return end
local __OvaleScripts = LibStub:GetLibrary("test/testfiles/test5/OvaleScripts")
local OvaleScripts = __OvaleScripts.OvaleScripts
local Test = LibStub:GetLibrary("Test", true)
local AceAddon = LibStub:GetLibrary("AceAddon-3.0", true)
local a = OvaleScripts
__exports.bla = 3
`);
});


test(t => {
    t.is(testTransform(t, `let a = {
        TEST: 'a',
        ["a"]: 'b',
        c: {
            d: "z"
        }
    }
    `), `local a = {
    TEST = "a",
    ["a"] = "b",
    c = {
        d = "z"
    }
}
`)
});

test(t => {
    t.is(testTransform(t, `class Test extends Base {
    a = 3;
    constructor(a) {
        this.a = a;
    }

    bla() {
        this.a = 4;
    }
}
    `), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(Base, {
    constructor = function(self, a)
        self.a = 3
        self.a = a
    end,
    bla = function(self)
        self.a = 4
    end,
})
`)
});

test(t => {
    t.is(testTransform(t, `(a,b) => 18`), `function(a, b)
    return 18
end
`);
});

test(t => {
    t.is(testTransform(t, `do {
        a = a + 1;
    }
    while (!(a > 5));
    `), `repeat
    a = a + 1
until not ( not (a > 5))
`);
});


test(t => {
    t.is(testTransform(t, `return class extends Base {
    value = 3;
    constructor(...rest:any[]) {
        super(...rest);

    }
    getValue() {
        return this.value;
    }
}
    `), `local __class = LibStub:GetLibrary("tslib").newClass
return __class(Base, {
    constructor = function(self, ...)
        self.value = 3
        Base.constructor(self, ...)
    end,
    getValue = function(self)
        return self.value
    end,
})
`);
});

test(t => {
    t.is(testTransform(t, "3 + 3"), "3 + 3\n");
});

test(t => {
    t.is(testTransform(t, "for (const [] of toto) {}"), "for _ in toto do\nend\n");
});


test(t => {
    t.is(testTransform(t, "a = { 1: 'a' }"), `a = {
    [1] = "a"
}
`);
});

test(t => {
    t.is(testTransform(t, "`${'3'}${3}`"), "\"3\" .. 3\n");
});


test(t => {
    t.is(testTransform(t, "`z${'3'}${3}z`"), "\"z\" .. \"3\" .. 3 .. \"z\"\n");
});

test(t => {
    t.is(testTransform(t, `function a(){
    return new Test();
}
export class Test {}
`), `local __exports = LibStub:NewLibrary("test/source", 1)
if not __exports then return end
local __class = LibStub:GetLibrary("tslib").newClass
local function a()
    return __exports.Test()
end
__exports.Test = __class(nil, {
})
`);
});

test(t => {
    t.is(testTransform(t, `class Test {
    a: (a) => number;
    b(c):number {}
    c() {
        this.b(12);
        this.a(13);
    }
    d = () => {
        this.a(2);
        this.b(14);
    }
}
const a:Test;
a.a(18);
a.b(23);
`), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(nil, {
    b = function(self, c)
    end,
    c = function(self)
        self:b(12)
        self.a(13)
    end,
    constructor = function(self)
        self.d = function()
            self.a(2)
            self:b(14)
        end
    end
})
local a
a.a(18)
a:b(23)
`)
})


test(t => {
    t.is(testTransform(t, `
type Constructor<T> = new(...args: any[]) => T;    
class Test {
    b() { return 4 }
}
function Debug<T extends Constructor<{}>>(Base:T) {
    return class extends Base {
        a() { return 3 }
    };
}
class A extends Debug(Test) {
    z(){
        this.a();
    }
}

const a: A;
a.b();
a.a();
`), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(nil, {
    b = function(self)
        return 4
    end,
})
local function Debug(Base)
    return __class(Base, {
        a = function(self)
            return 3
        end,
    })
end
local A = __class(Debug(Test), {
    z = function(self)
        self:a()
    end,
})
local a
a:b()
a:a()
`)
})

test("imports mock modules", t => {
    t.is(testTransform(t, `import { a, b } from "@wowts/table";
import { c } from "@wowts/lua";
const z = a;
c();
    `), `local a = table.a
local c = c
local z = a
c()
`);
});

test("class with inheritance but no explicit constructor",  t => {
    t.is(testTransform(t, `class Test extends BaseClass {
    v = true
}`), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(BaseClass, {
    constructor = function(self, ...)
        BaseClass.constructor(self, ...)
        self.v = true
    end
})
`);
});

test("class with interface inheritance but no explicit constructor",  t => {
    t.is(testTransform(t, `class Test implements Interface {
    v = true
}`), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(nil, {
    constructor = function(self)
        self.v = true
    end
})
`);
});

test("add strings", t => {
    t.is(testTransform(t, `"a" + 3`), `"a" .. 3
`);
});