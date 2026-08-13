// mjml (Node) também não publica tipos na v5 — mesma superfície do shim do
// painel (mjml-browser.d.ts): compilar e devolver html + erros, assíncrono.
declare module 'mjml' {
  interface ResultadoMjml {
    html: string;
    errors: { line: number; message: string; tagName: string; formattedMessage: string }[];
  }
  const mjml2html: (mjml: string, opts?: Record<string, unknown>) => Promise<ResultadoMjml>;
  export default mjml2html;
}
