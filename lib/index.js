"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
const visitor_1 = require("./visitor");
__export(require("./visitor"));
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    name: 'Qt',
    annotations: {
        records: {
            pod: {
                arguments: 'boolean'
            },
            doc: {
                arguments: "string"
            }
        },
        properties: {
            cpppointer: {
                arguments: "boolean"
            },
            doc: {
                arguments: "string"
            }
        }
    },
    transform(ast, options) {
        let visitor = new visitor_1.QtVisitor(options);
        return Promise.resolve(visitor.parse(ast));
    }
};
