// mjml-browser não publica tipos. A superfície usada é uma só: compilar MJML
// para HTML. `errors` vem junto para o painel de código repassar os avisos do
// compilador em vez de engoli-los.
declare module 'mjml-browser' {
  interface ResultadoMjml {
    html: string;
    errors: { line: number; message: string; tagName: string; formattedMessage: string }[];
  }
  // A v5 é assíncrona — compila num worker interno e devolve Promise.
  const mjml2html: (mjml: string, opts?: Record<string, unknown>) => Promise<ResultadoMjml>;
  export default mjml2html;
}
