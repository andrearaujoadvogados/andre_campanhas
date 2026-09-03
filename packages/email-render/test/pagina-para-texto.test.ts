import { describe, it, expect } from 'vitest';
import { paginaParaTexto } from '../src/index.js';

const PAGINA =
  '<html><body><nav>Menu principal</nav>' +
  '<main><h1>Manchete do dia</h1><p>Corpo da matéria.</p></main>' +
  '<aside><h2>Mais lidas</h2><p>Matéria popular da semana</p></aside>' +
  '<footer>Rodapé institucional</footer></body></html>';

describe('página para texto', () => {
  it('por padrão descarta menu, rodapé e laterais — só o miolo interessa à coleta de novidades', () => {
    const texto = paginaParaTexto(PAGINA);

    expect(texto).toMatch(/manchete do dia/i);
    expect(texto).not.toContain('Menu principal');
    expect(texto).not.toContain('Rodapé institucional');
    expect(texto).not.toMatch(/matéria popular/i);
  });

  it('completo mantém as laterais, onde os sites põem as "mais lidas" — e continua sem menu e rodapé', () => {
    const texto = paginaParaTexto(PAGINA, 30_000, { completo: true });

    expect(texto).toMatch(/manchete do dia/i);
    expect(texto).toMatch(/mais lidas/i);
    expect(texto).toContain('Matéria popular da semana');
    expect(texto).not.toContain('Menu principal');
    expect(texto).not.toContain('Rodapé institucional');
  });
});
