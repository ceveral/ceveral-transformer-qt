"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const utils_1 = require("./utils");
const ceveral_compiler_1 = require("ceveral-compiler");
const _ = require("lodash");
const fs = require("mz/fs");
const Path = require("path");
const hbs = require("handlebars");
function recordToString(input, sourceTemplate, headerTemplate) {
    input.imports.sort((a, b) => {
        let ab = a[0] == '<', bb = b[0] == "<", e = ab === bb;
        return e ? ab[1] > bb[1] : ab < bb;
    });
    let header = headerTemplate(input), source = sourceTemplate(input);
    return [
        { filename: input.filename + '.cpp', buffer: new Buffer(source) },
        { filename: input.filename + '.hpp', buffer: new Buffer(header) }
    ];
}
class QtVisitor extends ceveral_compiler_1.BaseVisitor {
    constructor(options) {
        super();
        this.options = options;
    }
    getAnnotation(exp, name) {
        let annotation = exp.find(m => m.name === name);
        return annotation ? (annotation.args != null ? annotation.args : true) : null;
    }
    parse(expression) {
        return __awaiter(this, void 0, void 0, function* () {
            let result = this.visit(expression);
            //console.log(JSON.stringify(result, null, 2));
            let sourceBuf = yield fs.readFile(Path.resolve(__dirname, "../templates/source.hbs"));
            let headerBuf = yield fs.readFile(Path.resolve(__dirname, "../templates/header.hbs"));
            let docBuf = yield fs.readFile(Path.resolve(__dirname, "../templates/doc.hbs"));
            let msgpackBuf = yield fs.readFile(Path.resolve(__dirname, "../templates/msgpack.hbs"));
            hbs.registerPartial('Document', docBuf.toString());
            hbs.registerPartial("MsgPack", msgpackBuf.toString());
            let sourceTemplate = hbs.compile(sourceBuf.toString()), headerTemplate = hbs.compile(headerBuf.toString());
            let output;
            if (false) {
                let records = result.records.map(m => {
                    return {
                        name: m.name,
                        filename: m.filename,
                        namespace: m.namespace,
                        records: [m],
                        imports: m.imports
                    };
                });
                output = _.flatten(records.map(m => recordToString(m, sourceTemplate, headerTemplate)));
            }
            else {
                result.imports = [...utils_1.arrayToSet(...result.records.map(m => m.imports))];
                let msgpack = result.records.find(m => m.msgpack);
                if (msgpack)
                    result.imports.push('"ceveral.hpp"', '<msgpack.hpp>');
                output = recordToString(result, sourceTemplate, headerTemplate);
            }
            let msgpack = result.records.find(m => m.msgpack);
            if (msgpack)
                output.push({
                    filename: 'ceveral.hpp',
                    buffer: yield fs.readFile(Path.resolve(__dirname, "../templates/ceveral.hbs"))
                });
            return output;
        });
    }
    visitPackage(expression) {
        this.package = expression.name;
        let records = expression.children
            .filter(m => m.nodeType == ceveral_compiler_1.Token.Record).map(m => this.visit(m));
        let enums = expression.children
            .filter(m => m.nodeType == ceveral_compiler_1.Token.NumericEnum).map(m => this.visit(m));
        return {
            namespace: this.package,
            imports: [],
            records: records,
            filename: 'qt' + Path.basename(this.options.fileName, Path.extname(this.options.fileName)),
            enums: enums
        };
    }
    visitRecord(expression) {
        this.imports = new Set();
        return {
            name: "Qt" + expression.name,
            package: this.package,
            pod: false,
            comment: this.getAnnotation(expression.annotations, 'doc'),
            properties: expression.properties.map(m => this.visit(m)),
            imports: [...this.imports],
            filename: "qt" + expression.name.toLowerCase(),
            namespace: this.package,
            msgpack: !!expression.get('qtmsgpack')
        };
    }
    visitUserType(expression) {
        return { type: expression.name, ref: true };
    }
    visitProperty(expression) {
        this.pointer = !!this.getAnnotation(expression.annotations, 'cpppointer');
        let type = this.visit(expression.type);
        type.pointer = this.pointer;
        if (this.pointer) {
            //type.type += '*';
            type.ref = false;
            this.imports.add('<memory>');
        }
        return _.extend({
            name: expression.name,
            comment: expression.get('doc')
        }, type);
    }
    visitType(expression) {
        switch (expression.type) {
            case ceveral_compiler_1.Type.String:
                this.imports.add('<QString>');
                return { type: "QString", ref: true, stdType: "std::string" };
            case ceveral_compiler_1.Type.Boolean: return { type: "bool", ref: false, stdType: "bool" };
            case ceveral_compiler_1.Type.Bytes:
                this.imports.add('<QByteArray>');
                return { type: "QByteArray", ref: true, stdType: "std::vector<unsigned char> " };
            case ceveral_compiler_1.Type.Float:
            case ceveral_compiler_1.Type.Double:
            case ceveral_compiler_1.Type.Int:
                return { type: ceveral_compiler_1.Type[expression.type].toLowerCase(), ref: false };
            case ceveral_compiler_1.Type.Uint:
                return { type: 'unsigned int', ref: false, stdType: 'unsigned int' };
            case ceveral_compiler_1.Type.Date:
                this.imports.add('<QDateTime>');
                return { type: 'QDateTime', ref: false };
            default:
                let type = ceveral_compiler_1.Type[expression.type].toLowerCase();
                return { type: 'q' + type, ref: false };
        }
    }
    visitImportType(expression) {
        //let base = Path.basename(this.options.fileName, Path.extname(this.options.fileName));
        let file = expression.name.toLowerCase() + ".hpp"; // (this.options.split ? expression.name.toLowerCase() + '.hpp' : base + '.hpp');
        this.imports.add(`"${file}"`);
        return { type: `${expression.packageName}::${expression.name}`, ref: true };
    }
    visitOptionalType(expression) {
        return this.visit(expression.type);
    }
    visitRepeatedType(expression) {
        this.imports.add("<QList>");
        let type = this.visit(expression.type);
        return { type: `QList<${type.type}>`, ref: true, stdType: `std::vector<${type.stdType}>` };
    }
    visitMapType(expression) {
        let key = this.visit(expression.key).type;
        let value = this.visit(expression.value).type;
        this.imports.add('<map>');
        return {
            type: `QHash<${key},${value}>`,
            ref: true
        };
    }
    visitAnnotation(expression) {
        return expression;
    }
    visitNumericEnum(expression) {
        /*let e = `type ${ucFirst(expression.name)} int32\n\nconst (\n  `
        this.firstMember = true;
        this.enumName = ucFirst(expression.name);
        e += expression.members.map(m => this.visit(m)).join('\n  ')
        e += '\n)'
        return e;*/
        return {
            name: expression.name,
            members: expression.members.map(m => this.visit(m))
        };
    }
    visitNumericEnumMember(expression) {
        /*let e = ucFirst(expression.name)
        if (expression.value != null) {
            if (this.firstMember) e += ' ' + this.enumName
            e += ' = ' + (this.firstMember ? 'iota + ' : '') + expression.value;
        } else {
            e += (this.firstMember ? `${this.enumName} = iota + ` : '')
        }
        this.firstMember = false;
        return e*/
        return expression.name + (expression.value == null ? '' : ' = ' + expression.value);
    }
    visitStringEnum(expression) {
        /*let e = `type ${ucFirst(expression.name)} string\n\nconst (\n  `
        this.firstMember = true;
        this.enumName = ucFirst(expression.name);
        e += expression.members.map(m => this.visit(m)).join('\n  ')

        e += '\n)';
        return e;*/
    }
    visitStringEnumMember(expression) {
        /*let e = ucFirst(expression.name)
        e += ` ${this.enumName} = "${expression.value}"`;
        this.firstMember = false;
        return e*/
    }
}
exports.QtVisitor = QtVisitor;
