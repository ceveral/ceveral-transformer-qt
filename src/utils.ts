
import * as _ from 'lodash';

export function isString(a:any): a is string {
    return typeof a === 'string';
}

export function isStringArray(a: any): a is string[] {
    if (!Array.isArray(a)) {
        return false;
    }

    return a.reduce<number>((l, c) => {
        if (typeof c === 'string') return l + 1
        return l;
    }, 0) == a.length;

}

export function ucFirst(name: string) {
    return _.upperFirst(_.camelCase(name));
    //return name[0].toUpperCase() + name.substr(1)
}

export function arrayToSet(...arrays: string[]) {
    let out = new Set<string>()
    for (let array of arrays) {
        for (let item of array) {
            out.add(item)
        }
    }
    return out;
}