const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

function loadCore() {
  const sandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} }, document: {} };
  new Function('window', 'localStorage', 'document', read('pathway.js'))(sandbox.window, sandbox.localStorage, sandbox.document);
  return sandbox.window.PathwayCore;
}

// The starting texts of a new step follow the language of the screen (2026-11-18); before they were always English.

test('a new step takes its starting texts from the screen, and stays English without them', () => {
  const C = loadCore();
  const words = { shortText: 'Uma pergunta para o candidato', singleChoice: 'Escolha uma opção', multiChoice: 'Selecione todas que se aplicam', options: ['Opção um', 'Opção dois'] };
  assert.equal(C.createNode('shortText', 0, 0, words).label, 'Uma pergunta para o candidato');
  const single = C.createNode('singleChoice', 0, 0, words);
  assert.equal(single.label, 'Escolha uma opção');
  assert.deepEqual(single.options, ['Opção um', 'Opção dois']);
  const multi = C.createNode('multiChoice', 0, 0, words);
  assert.equal(multi.label, 'Selecione todas que se aplicam');
  assert.deepEqual(multi.options, ['Opção um', 'Opção dois']);
  assert.notEqual(single.options, multi.options, 'each step has its own list');
  // without texts, or with a broken list, the English words are kept
  assert.equal(C.createNode('shortText', 0, 0).label, 'A question for your candidate');
  assert.deepEqual(C.createNode('singleChoice', 0, 0).options, ['Option one', 'Option two']);
  assert.deepEqual(C.createNode('multiChoice', 0, 0, { options: ['only one'] }).options, ['Option one', 'Option two']);
  assert.equal(C.createNode('candidateInfo', 0, 0, words).label, 'Your details');
});

test('the editor translates the starting texts when a step is added, and both languages have them', () => {
  const builder = read('builder.js');
  const add = builder.slice(builder.indexOf('function addNode(type)'), builder.indexOf('selectedId = newNode.id'));
  for (const key of ['A question for your candidate', 'Choose one option', 'Select all that apply', 'Option one', 'Option two']) {
    assert.ok(add.includes("t('" + key + "')"), 'addNode translates ' + key);
    for (const file of ['locales/pt-BR.js', 'locales/es.js']) assert.ok(read(file).includes("'" + key + "':"), file + ' ' + key);
  }
});
