const parser = require('./parser')

const res1 = parser('', 'a+b', {a: 1, b: 'c', c:2}, [])
console.log(res1)

const res12 = parser('', 'a+b', {a: 'b', b: 'a', c:2}, [])
console.log(res2)