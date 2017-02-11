"use strict";
const _ = require("lodash");
function isString(a) {
    return typeof a === 'string';
}
exports.isString = isString;
function isStringArray(a) {
    if (!Array.isArray(a)) {
        return false;
    }
    return a.reduce((l, c) => {
        if (typeof c === 'string')
            return l + 1;
        return l;
    }, 0) == a.length;
}
exports.isStringArray = isStringArray;
function ucFirst(name) {
    return _.upperFirst(_.camelCase(name));
    //return name[0].toUpperCase() + name.substr(1)
}
exports.ucFirst = ucFirst;
function arrayToSet(...arrays) {
    let out = new Set();
    for (let array of arrays) {
        for (let item of array) {
            out.add(item);
        }
    }
    return out;
}
exports.arrayToSet = arrayToSet;
