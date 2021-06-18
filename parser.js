/* eslint-disable */
const unparse = require('escodegen').generate;
const parse = require('esprima').parse;

const syntaxError = '表达式语法错误';
const useUndefinedVariablesError = '使用了未定义的变量';
const variableRecursiveUseError = '存在变量循环引用';
const singleQuoteExp = /^\'.*\'$/;
const doubleQuoteExp = /^\".*\"$/;

const isUnSafeProperty = function(name) {
    return name === 'constructor' || name === '__proto__';
}

/**
 * @description 解析表达式核心函数
 * @param variableFullKey 当前解析的表达式名
 * @param exp 当前解析的表达式
 * @param vars 当前一定义的变量
 * @param referencedVariables 当前表达式所引用的变量
 */

const parser =  function(variableFullKey, exp, vars, referencedVariables) {
    if (referencedVariables.includes(variableFullKey)) {
        throw new Error(variableRecursiveUseError);
    } else {
        referencedVariables.push(variableFullKey);
    }

    let ast;
    try {
        if (!!exp && (singleQuoteExp.test(exp) || doubleQuoteExp.test(exp))) {
            // 处理LITERAL，直接原样输出，ast解析有些复杂的LITERAL是会报错的
            // slice(1, -1) 的目的是去除开头末尾多余的双引号
            ast = {type: 'Literal', value: exp.splice(1, -1)};
        } else {
            ast = parse(exp).body[0].expression;
        }
    } catch (e) {
        throw new Error(syntaxError);
    }

    const rejectAccessToMethodsOnFunctions = true;

    if(!vars) vars = {};
    const FAIL = {};

    const result = (function walk (node, noExecute) {
        if (node.type === 'Literal') {
            // 已经是字面量的，推出去
            const referencedVariableIndex = referencedVariables.findIndex(item => item === variableFullKey);
            if (referencedVariableIndex > -1) {
                referencedVariables.splice(referencedVariableIndex, 1);
            }
            return node.value;
        }
        else if (node.type === 'UnaryExpression'){
            const val = walk(node.argument, noExecute)
            if (node.operator === '+') return +val
            if (node.operator === '-') return -val
            if (node.operator === '~') return ~val
            if (node.operator === '!') return !val
            return FAIL
        }
        else if (node.type === 'ArrayExpression') {
            let xs = [];
            for (let i = 0, l = node.elements.length; i < l; i++) {
                let x = walk(node.elements[i], noExecute);
                if (x === FAIL) return FAIL;
                xs.push(x);
            }
            return xs;
        }
        else if (node.type === 'ObjectExpression') {
            let obj = {};
            for (let i = 0; i < node.properties.length; i++) {
                let prop = node.properties[i];
                let value = prop.value === null
                    ? prop.value
                    : walk(prop.value, noExecute)
                ;
                if (value === FAIL) return FAIL;
                obj[prop.key.value || prop.key.name] = value;
            }
            return obj;
        }
        else if (node.type === 'BinaryExpression' ||
            node.type === 'LogicalExpression') {
            let op = node.operator;

            if (op === '&&') {
                let l = walk(node.left);
                if (l === FAIL) return FAIL;
                if (!l) return l;
                let r = walk(node.right);
                if (r === FAIL) return FAIL;
                return r;
            }
            else if (op === '||') {
                let l = walk(node.left);
                if (l === FAIL) return FAIL;
                if (l) return l;
                let r = walk(node.right);
                if (r === FAIL) return FAIL;
                return r;
            }

            let l = walk(node.left, noExecute);
            if (l === FAIL) return FAIL;
            let r = walk(node.right, noExecute);
            if (r === FAIL) return FAIL;

            if (op === '==') return l == r;
            if (op === '===') return l === r;
            if (op === '!=') return l != r;
            if (op === '!==') return l !== r;
            if (op === '+') return l + r;
            if (op === '-') return l - r;
            if (op === '*') return l * r;
            if (op === '/') return l / r;
            if (op === '%') return l % r;
            if (op === '<') return l < r;
            if (op === '<=') return l <= r;
            if (op === '>') return l > r;
            if (op === '>=') return l >= r;
            if (op === '|') return l | r;
            if (op === '&') return l & r;
            if (op === '^') return l ^ r;

            return FAIL;
        }
        else if (node.type === 'Identifier') {
            if ({}.hasOwnProperty.call(vars, node.name)) {
                if (typeof vars[node.name] === 'string') {
                    let res = parser(node.name, vars[node.name], vars, referencedVariables);
                    return res === undefined ? FAIL : res;
                } else {
                    return vars[node.name]
                }
            } else return FAIL;
        }
        else if (node.type === 'ThisExpression') {
            if ({}.hasOwnProperty.call(vars, 'this')) {
                return vars['this'];
            }
            else return FAIL;
        }
        else if (node.type === 'CallExpression') {
            let callee = walk(node.callee, noExecute);
            if (callee === FAIL) return FAIL;
            if (typeof callee !== 'function') return FAIL;

            let ctx = node.callee.object ? walk(node.callee.object, noExecute) : FAIL;
            if (ctx === FAIL) ctx = null;

            let args = [];
            for (let i = 0, l = node.arguments.length; i < l; i++) {
                let x = walk(node.arguments[i], noExecute);
                if (x === FAIL) return FAIL;
                args.push(x);
            }

            if (noExecute) {
                return undefined;
            }

            return callee.apply(ctx, args);
        }
        else if (node.type === 'MemberExpression') {
            let obj = walk(node.object, noExecute);
            if((obj === FAIL) || (
                (typeof obj == 'function') && rejectAccessToMethodsOnFunctions
            )){
                return FAIL;
            }
            if (node.property.type === 'Identifier' && !node.computed) {
                if (isUnsafeProperty(node.property.name)) return FAIL;
                return obj[node.property.name];
            }
            let prop = walk(node.property, noExecute);
            if (prop === null || prop === FAIL) return FAIL;
            if (isUnsafeProperty(prop)) return FAIL;
            return obj[prop];
        }
        else if (node.type === 'ConditionalExpression') {
            let val = walk(node.test, noExecute)
            if (val === FAIL) return FAIL;
            return val ? walk(node.consequent) : walk(node.alternate, noExecute)
        }
        else if (node.type === 'ExpressionStatement') {
            let val = walk(node.expression, noExecute)
            if (val === FAIL) return FAIL;
            return val;
        }
        else if (node.type === 'ReturnStatement') {
            return walk(node.argument, noExecute)
        }
        else if (node.type === 'FunctionExpression') {
            let bodies = node.body.body;

            // Create a "scope" for our arguments
            let oldVars = {};
            Object.keys(vars).forEach(function(element){
                oldVars[element] = vars[element];
            })

            for(let i=0; i<node.params.length; i++){
                let key = node.params[i];
                if(key.type == 'Identifier'){
                    vars[key.name] = null;
                }
                else return FAIL;
            }
            for(let i in bodies){
                if(walk(bodies[i], true) === FAIL){
                    return FAIL;
                }
            }
            // restore the vars and scope after we walk
            vars = oldVars;

            let keys = Object.keys(vars);
            let vals = keys.map(function(key) {
                return vars[key];
            });
            return Function(keys.join(', '), 'return ' + unparse(node)).apply(null, vals);
        }
        else if (node.type === 'TemplateLiteral') {
            let str = '';
            let i;
            for (i = 0; i < node.expressions.length; i++) {
                str += walk(node.quasis[i], noExecute);
                str += walk(node.expressions[i], noExecute);
            }
            str += walk(node.quasis[i], noExecute);
            return str;
        }
        else if (node.type === 'TaggedTemplateExpression') {
            let tag = walk(node.tag, noExecute);
            let quasi = node.quasi;
            let strings = quasi.quasis.map(walk);
            let values = quasi.expressions.map(walk);
            return tag.apply(null, [strings].concat(values));
        }
        else if (node.type === 'TemplateElement') {
            return node.value.cooked;
        }
        else return FAIL;
    })(ast);

    let finalRes = result === FAIL ? undefined : result;
    if (finalRes === undefined) {
        throw new Error(useUndefinedVariablesError);
    } else {
        return finalRes;
    }
};

module.exports = parser;