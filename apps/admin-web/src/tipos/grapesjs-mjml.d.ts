// grapesjs-mjml não publica tipos. O preset é uma função-plugin do GrapesJS:
// recebe o editor e opções. Mantemos a assinatura frouxa de propósito — só
// precisamos passá-la em `plugins`.
declare module 'grapesjs-mjml' {
  const plugin: (editor: unknown, opts?: Record<string, unknown>) => void;
  export default plugin;
}
