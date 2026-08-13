// Núcleo do Criador de e-mails — o modelo de documento e tudo que é PURO.
//
// Vive num pacote próprio, e não dentro do painel, por uma razão que vai além
// de organização: **a automação de boletins roda num worker**. A rotina que vai
// pesquisar as notícias e disparar a campanha periódica monta o design chamando
// as fábricas de `boletim.ts` e compila com `compileDesignToMjml` — o mesmo
// código que o painel usa, importado do mesmo lugar. Se este núcleo morasse no
// admin-web, o worker teria que duplicá-lo ou importar de dentro de uma SPA.
//
// A regra de fronteira: aqui NADA toca DOM, `window` ou `mjml-browser`. O que
// depende de navegador (compilação MJML→HTML no cliente, absorção de HTML
// editado, colagem, realce) continua em `apps/admin-web/src/lib/criador/`.
// Um worker que precise do HTML final usa o pacote `mjml` do Node sobre o MJML
// que `compileDesignToMjml` produz.

export * from './tipos.js';
export * from './ops.js';
export * from './compile.js';
export * from './presets.js';
export * from './boletim.js';
