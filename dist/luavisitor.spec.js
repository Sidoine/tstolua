"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ava_1 = require("ava");
const compiler_1 = require("./helpers/compiler");
ava_1.default("simple assignation", (t) => {
    t.is(compiler_1.testTransform(t, "let a = 2 + 3;"), `local a = 2 + 3
`);
});
ava_1.default("function call", (t) => {
    t.is(compiler_1.testTransform(t, "a.b = a.c(a.d)", true), `a.b = a.c(a.d)
`);
});
ava_1.default("if else", (t) => {
    t.is(compiler_1.testTransform(t, `if (!a != 4) {
    b = 3.5;
} else if (a == 4) {
    b = 4 + (3 * 4);
} else {
    c = 4;
}
`), `if  not a ~= 4 then
    b = 3.5
elseif a == 4 then
    b = 4 + (3 * 4)
else
    c = 4
end
`);
});
ava_1.default("table iteration", (t) => {
    t.is(compiler_1.testTransform(t, `for (let k = lualength(test); k >= 1; k += -1) {
}`), `for k = #test, 1, -1 do
end
`);
});
ava_1.default("class inheritance", (t) => {
    t.is(compiler_1.testTransform(t, `class Test extends Base {
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
ava_1.default.skip("module import", (t) => {
    t.is(compiler_1.testTransform(t, `import { OvaleScripts } from "./OvaleScripts";
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
ava_1.default("litteral object", (t) => {
    t.is(compiler_1.testTransform(t, `let a = {
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
`);
});
ava_1.default("class inheritance with property access", (t) => {
    t.is(compiler_1.testTransform(t, `class Test extends Base {
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
`);
});
ava_1.default("simple lambda function", (t) => {
    t.is(compiler_1.testTransform(t, `(a,b) => 18`), `function(a, b)
    return 18
end
`);
});
ava_1.default("do while", (t) => {
    t.is(compiler_1.testTransform(t, `do {
        a = a + 1;
    }
    while (!(a > 5));
    `), `repeat
    a = a + 1
until not ( not (a > 5))
`);
});
ava_1.default("dynamic class", (t) => {
    t.is(compiler_1.testTransform(t, `return class extends Base {
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
ava_1.default("+ opereator", (t) => {
    t.is(compiler_1.testTransform(t, "3 + 3"), "3 + 3\n");
});
ava_1.default("for of with unused keys", (t) => {
    t.is(compiler_1.testTransform(t, "for (const [] of toto) {}"), "for _ in toto do\nend\n");
});
ava_1.default("initialize an array with a number as key", (t) => {
    t.is(compiler_1.testTransform(t, "a = { 1: 'a' }"), `a = {
    [1] = "a"
}
`);
});
ava_1.default("simple string template", (t) => {
    t.is(compiler_1.testTransform(t, "`${'3'}${3}`"), '"3" .. 3\n');
});
ava_1.default("more complex template string", (t) => {
    t.is(compiler_1.testTransform(t, "`z${'3'}${3}z`"), '"z" .. "3" .. 3 .. "z"\n');
});
ava_1.default("string template with parenthesis", (t) => {
    t.is(compiler_1.testTransform(t, "`z${2 + 3}`"), '"z" .. (2 + 3)\n');
});
ava_1.default("function that returns a new object that is declared after the call", (t) => {
    t.is(compiler_1.testTransform(t, `function a(){
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
ava_1.default("class with methods", (t) => {
    t.is(compiler_1.testTransform(t, `class Test {
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
`);
});
ava_1.default.skip("class declaration with class extension", (t) => {
    t.is(compiler_1.testTransform(t, `
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
    z() {
        this.a();
    }
}

function testCall(a: A) {
    a.b();
    a.a();
}
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
local function testCall(a)
    a:b()
    a:a()
end
`);
});
ava_1.default("imports mock modules", (t) => {
    t.is(compiler_1.testTransform(t, `import { a, b } from "@wowts/table";
import { c } from "@wowts/lua";
const z = a;
c();
    `), `local a = table.a
local c = c
local z = a
c()
`);
});
ava_1.default("class with inheritance but no explicit constructor", (t) => {
    t.is(compiler_1.testTransform(t, `class Test extends BaseClass {
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
ava_1.default("class with interface inheritance but no explicit constructor", (t) => {
    t.is(compiler_1.testTransform(t, `class Test implements Interface {
    v = true
}`), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(nil, {
    constructor = function(self)
        self.v = true
    end
})
`);
});
ava_1.default("add strings", (t) => {
    t.is(compiler_1.testTransform(t, `"a" + 3`), `"a" .. 3
`);
});
ava_1.default("class with static property", (t) => {
    t.is(compiler_1.testTransform(t, `class Test {
    static v = true;
    static x = 2;
    static w;
}`), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(nil, {
    v = true,
    x = 2,
})
`);
});
ava_1.default("class with static property and constructor", (t) => {
    t.is(compiler_1.testTransform(t, `class Test {
    static v = true;
    static x = 2;
    static w;
    constructor() {
        let a = 2;
    }
}`), `local __class = LibStub:GetLibrary("tslib").newClass
local Test = __class(nil, {
    v = true,
    x = 2,
    constructor = function(self)
        local a = 2
    end,
})
`);
});
ava_1.default("+=", (t) => {
    t.is(compiler_1.testTransform(t, `let a = 3;
a += 5;`), `local a = 3
a = a + 5
`);
});
ava_1.default("+= with strings", (t) => {
    t.is(compiler_1.testTransform(t, `let a = "3";
a += "5";`), `local a = "3"
a = a .. "5"
`);
});
ava_1.default("-=", (t) => {
    t.is(compiler_1.testTransform(t, `let a = 3;
a -= 5;`), `local a = 3
a = a - 5
`);
});
ava_1.default("-= with parenthesis", (t) => {
    t.is(compiler_1.testTransform(t, `let a = 3;
a -= 5 + 2;`), `local a = 3
a = a - (5 + 2)
`);
});
ava_1.default("object literal with string keys", (t) => {
    t.is(compiler_1.testTransform(t, `const a = { "foo": "bar", bar: "foo" }`), `local a = {
    ["foo"] = "bar",
    bar = "foo"
}
`);
});
ava_1.default("object literal with number keys", (t) => {
    t.is(compiler_1.testTransform(t, `const a = { 2: "bar" }`), `local a = {
    [2] = "bar"
}
`);
});
ava_1.default("forward reference to local function", (t) => {
    t.is(compiler_1.testTransform(t, `function a() {
    f(2);
}
function f(i: number) {
    return i * i;
}`), `local f
local function a()
    f(2)
end
f = function(i)
    return i * i
end
`);
});
ava_1.default("cast on left side of an assignement", (t) => {
    t.is(compiler_1.testTransform(t, `let a: string;
(<any>a) = "toto";`), `local a
a = "toto"
`);
});
ava_1.default("ternary on reference type", (t) => {
    t.is(compiler_1.testTransform(t, `let a = { a: 3 };
const b = true ? a : 2;`), `local a = {
    a = 3
}
local b = (true and a) or 2
`);
});
ava_1.default("ternary on value type", (t) => {
    t.is(compiler_1.testTransform(t, `const b = true ? 3 : 2;`), `local __tslib = LibStub:GetLibrary("tslib")
local __ternaryWrap = __tslib.ternaryWrap
local __ternaryUnwrap = __tslib.ternaryUwrap
local b = __ternaryUnwrap((true and __ternaryWrap(3)) or 2)
`);
});
ava_1.default("increment in a loop", (t) => {
    t.is(compiler_1.testTransform(t, `let a = 0;
    for (let i = 0; i<5; i ++) {
        a = a + 1;
    }`), `local a = 0
for i = 0, 5, 1 do
    a = a + 1
end
`);
});
ava_1.default.only("const enum", (t) => {
    t.is(compiler_1.testTransform(t, `const enum Test {
        One,
        Two
}
    let toto: Test = Test.Two;
`), `local toto = 1
`);
});
//# sourceMappingURL=luavisitor.spec.js.map