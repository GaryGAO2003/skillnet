#!/usr/bin/env node
// save-hello skill
// Writes "Hello, World!" in English, French, and Spanish to hello.txt

const fs = require('fs')
const path = require('path')

const outputPath = path.join(__dirname, 'hello.txt')
const content = 'Hello, World!\nBonjour, le Monde!\nHola, Mundo!\n'

fs.writeFileSync(outputPath, content)
console.log(`Skill executed: wrote hello.txt → ${outputPath}`)
