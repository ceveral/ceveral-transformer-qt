
import { isString, isStringArray, arrayToSet } from './utils';
import {
    Token, Type, BaseVisitor, IResult, TranspileOptions, RecordTypeExpression,
    PackageExpression, RecordExpression,
    AnnotationExpression, PropertyExpression, TypeExpression, ImportTypeExpression,
    RepeatedTypeExpression, MapTypeExpression, OptionalTypeExpression,
    StringEnumExpression, StringEnumMemberExpression, NumericEnumExpression, NumericEnumMemberExpression,
    ExpressionPosition, AnnotatedExpression, ServiceExpression, MethodExpression, AnonymousRecordExpression
} from 'ceveral-compiler';
import * as _ from 'lodash';
import * as fs from 'mz/fs';
import * as Path from 'path';
import * as hbs from 'handlebars';



interface ParseResult {
    namespace: string;
    imports: string[];
    records: any[];
    filename: string;
}

function recordToString(input, sourceTemplate: HandlebarsTemplateDelegate, headerTemplate: HandlebarsTemplateDelegate) {
    input.imports.sort((a, b) => {
        let ab = a[0] == '<', bb = b[0] == "<", e = ab === bb;
        return e ? ab[1] > bb[1] : ab < bb;
    })

    let header = headerTemplate(input),
        source = sourceTemplate(input);
    return [
        { filename: input.filename + '.cpp', buffer: new Buffer(source) },
        { filename: input.filename + '.hpp', buffer: new Buffer(header) }
    ]

}

export class QtVisitor extends BaseVisitor {
    imports: Set<string>;
    package: string;
    gotags: string[]
    pointer: boolean;

    constructor(public options: TranspileOptions) {
        super();
    }

    getAnnotation(exp: AnnotationExpression[], name: string) {
        let annotation = exp.find(m => m.name === name);
        return annotation ? (annotation.args != null ? annotation.args : true) : null;
    }

    async parse(expression: PackageExpression): Promise<IResult[]> {
        let result: ParseResult = this.visit(expression);
        //console.log(JSON.stringify(result, null, 2));

        let sourceBuf = await fs.readFile(Path.resolve(__dirname, "../templates/source.hbs"));
        let headerBuf = await fs.readFile(Path.resolve(__dirname, "../templates/header.hbs"));
        let docBuf = await fs.readFile(Path.resolve(__dirname, "../templates/doc.hbs"));
        let msgpackBuf = await fs.readFile(Path.resolve(__dirname, "../templates/msgpack.hbs"));

        hbs.registerPartial('Document', docBuf.toString());
        hbs.registerPartial("MsgPack", msgpackBuf.toString())
        let sourceTemplate = hbs.compile(sourceBuf.toString()),
            headerTemplate = hbs.compile(headerBuf.toString());

        let output: IResult[];
        if (/*this.options.split*/false) {
            let records = result.records.map(m => {
                return {
                    name: m.name,
                    filename: m.filename,
                    namespace: m.namespace,
                    records: [m],
                    imports: m.imports
                }
            })

            output = _.flatten(records.map(m => recordToString(m, sourceTemplate, headerTemplate)));
        } else {
            result.imports = [...arrayToSet(...result.records.map(m => m.imports))];

            let msgpack = result.records.find(m => m.msgpack )
            if (msgpack) result.imports.push('"ceveral.hpp"','<msgpack.hpp>')

            output = recordToString(result, sourceTemplate, headerTemplate);

        }

        let msgpack = result.records.find( m => m.msgpack)
        if (msgpack) output.push({
            filename: 'ceveral.hpp',
            buffer: await fs.readFile(Path.resolve(__dirname, "../templates/ceveral.hbs"))
        })

        return output
    }


    visitPackage(expression: PackageExpression): any {

        this.package = expression.name;
        let records = expression.children
            .filter(m => m.nodeType == Token.Record).map(m => this.visit(m));

        let enums  = expression.children
            .filter(m => m.nodeType == Token.NumericEnum).map(m => this.visit(m));

        return {
            namespace: this.package,
            imports: [],
            records: records,
            enums: enums,
            filename: Path.basename(this.options.fileName, Path.extname(this.options.fileName))
        }
    }

    visitRecord(expression: RecordExpression): any {
        this.imports = new Set();
        return {
            package: this.package,
            name: expression.name,
            pod: false,
            comment: this.getAnnotation(expression.annotations, 'doc'),
            properties: expression.properties.map(m => this.visit(m)),
            imports: [...this.imports],
            filename: expression.name.toLowerCase(),
            namespace: this.package,
            msgpack: !!expression.get('qtmsgpack')
        }

    }

    visitUserType(expression: RecordTypeExpression) {
        return { type: expression.name, ref: true }
    }

    visitProperty(expression: PropertyExpression): any {
        this.pointer = !!this.getAnnotation(expression.annotations, 'cpppointer')

        let type = this.visit(expression.type)
        type.pointer = this.pointer;
        if (this.pointer) {
            //type.type += '*';
            type.ref = false;
            this.imports.add('<memory>')
        }

        return _.extend({
            name: expression.name,
            comment: expression.get('doc')
        }, type);
    }

    visitType(expression: TypeExpression): any {
        switch (expression.type) {
            case Type.String:
                this.imports.add('<QString>');
                return { type: "QString", ref: true, stdType: "std::string" };
            case Type.Boolean: return { type: "bool", ref: false, stdType:"bool" };
            case Type.Bytes:
                this.imports.add('<QByteArray>');
                return { type: "QByteArray", ref: true, stdType:"std::vector<unsigned char> " };
            case Type.Float:
            case Type.Double:
            case Type.Int:
                return { type: Type[expression.type].toLowerCase(), ref: false };
            case Type.Uint:
                return { type: 'unsigned int', ref: false, stdType: 'unsigned int' };
            case Type.Date:
                this.imports.add('<QDateTime>');
                return { type: 'QDateTime', ref: false };
            default: return { type: "unimplemented", ref: false };
        }
    }

    visitImportType(expression: ImportTypeExpression): any {

        
        //let base = Path.basename(this.options.fileName, Path.extname(this.options.fileName));
        
        let file = expression.name.toLowerCase() + ".hpp" // (this.options.split ? expression.name.toLowerCase() + '.hpp' : base + '.hpp');
        this.imports.add(`"${file}"`);

        return { type: `${expression.packageName}::${expression.name}`, ref: true };
    }

    visitOptionalType(expression: OptionalTypeExpression): any {
        return this.visit(expression.type);
    }

    visitRepeatedType(expression: RepeatedTypeExpression): any {
        this.imports.add("<QList>");
        let type = this.visit(expression.type);
        return { type: `QList<${type.type}>`, ref: true, stdType: `std::vector<${type.stdType}>` };
    }

    visitMapType(expression: MapTypeExpression): any {
        let key = this.visit(expression.key).type;
        let value = this.visit(expression.value).type;
        this.imports.add('<map>');
        return {
            type: `QHash<${key},${value}>`,
            ref: true
        }
    }

    visitAnnotation(expression: AnnotationExpression): any {
        return expression;
    }

    visitNumericEnum(expression: NumericEnumExpression): any {
        /*let e = `type ${ucFirst(expression.name)} int32\n\nconst (\n  `
        this.firstMember = true;
        this.enumName = ucFirst(expression.name);
        e += expression.members.map(m => this.visit(m)).join('\n  ')
        e += '\n)'
        return e;*/
        return {
            name: expression.name,
            members: expression.members.map( m => this.visit(m))
        }
    }

    visitNumericEnumMember(expression: NumericEnumMemberExpression): any {
        /*let e = ucFirst(expression.name)
        if (expression.value != null) {
            if (this.firstMember) e += ' ' + this.enumName
            e += ' = ' + (this.firstMember ? 'iota + ' : '') + expression.value;
        } else {
            e += (this.firstMember ? `${this.enumName} = iota + ` : '') 
        }
        this.firstMember = false;
        return e*/
        return expression.name + (expression.value == null ? '' : ' = ' + expression.value)
    }
    visitStringEnum(expression: StringEnumExpression): any {
        /*let e = `type ${ucFirst(expression.name)} string\n\nconst (\n  `
        this.firstMember = true;
        this.enumName = ucFirst(expression.name);
        e += expression.members.map(m => this.visit(m)).join('\n  ')

        e += '\n)';
        return e;*/
    }
    visitStringEnumMember(expression: StringEnumMemberExpression): any {
        /*let e = ucFirst(expression.name)
        e += ` ${this.enumName} = "${expression.value}"`;
        this.firstMember = false;
        return e*/
    }


}

