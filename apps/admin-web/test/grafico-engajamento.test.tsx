import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraficoEngajamento, preencherDias } from '../src/componentes/GraficoEngajamento.tsx';

describe('preenchimento dos dias sem atividade', () => {
  it('liga segunda a sexta passando por zeros — não por uma reta enganosa', () => {
    const serie = preencherDias([
      { dia: '2026-08-10', aberturas: 10, cliques: 2 },
      { dia: '2026-08-14', aberturas: 6, cliques: 1 },
    ]);

    expect(serie.map((p) => p.dia)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
    ]);
    expect(serie[1]).toEqual({ dia: '2026-08-11', aberturas: 0, cliques: 0 });
  });

  it('ordena pontos que chegarem fora de ordem', () => {
    const serie = preencherDias([
      { dia: '2026-08-12', aberturas: 1, cliques: 0 },
      { dia: '2026-08-10', aberturas: 3, cliques: 1 },
    ]);

    expect(serie[0]?.dia).toBe('2026-08-10');
    expect(serie).toHaveLength(3);
  });

  it('vazio continua vazio — sem inventar um intervalo', () => {
    expect(preencherDias([])).toEqual([]);
  });
});

describe('o gráfico', () => {
  it('desenha as duas séries com legenda', () => {
    render(
      <GraficoEngajamento
        pontos={[
          { dia: '2026-08-10', aberturas: 10, cliques: 2 },
          { dia: '2026-08-11', aberturas: 4, cliques: 1 },
        ]}
      />,
    );

    expect(screen.getByRole('img', { name: /aberturas e cliques por dia/i })).toBeInTheDocument();
    expect(screen.getByText('Aberturas')).toBeInTheDocument();
    expect(screen.getByText('Cliques')).toBeInTheDocument();
  });

  it('sem pontos, explica que a série acumula a partir de agora', () => {
    // A série nasceu com esta versão: campanhas antigas não têm pontos, e a
    // tela precisa dizer isso em vez de parecer quebrada.
    render(<GraficoEngajamento pontos={[]} />);

    expect(screen.getByText(/a partir dos próximos eventos/i)).toBeInTheDocument();
  });
});
