import '@testing-library/jest-dom/vitest';

/**
 * Geometria que o jsdom não implementa.
 *
 * O ProseMirror, sob o editor de e-mail, consulta posição de elementos para
 * decidir onde fica o cursor. No jsdom essas chamadas lançam, e o Vitest trata
 * exceção não capturada como falha da suíte — os testes passavam e o processo
 * saía com erro, que é o pior dos dois mundos: verde na tela, vermelho no
 * pipeline.
 *
 * Devolver retângulos zerados é suficiente porque nenhum teste depende de
 * posição real; o que se verifica é o HTML que sai do editor.
 */
const retanguloVazio = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
} as DOMRect;

if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
}

if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = () => retanguloVazio;
}

if (typeof Element.prototype.getClientRects !== 'function') {
  Element.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
}

if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

/**
 * O jsdom conhece o elemento <dialog> mas não implementa showModal/close — e o
 * criador de e-mails usa o modal nativo justamente para ganhar foco preso e
 * Esc de graça. O polyfill cobre só o que os testes exercitam: abrir, fechar
 * e o evento `close`.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}
