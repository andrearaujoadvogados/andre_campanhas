// Painel lateral do Criador — paleta (estruturas, blocos, módulos), inspetores
// do que está selecionado e configurações globais.
//
// Diferença deliberada em relação à referência: SEM upload de imagem. Este
// sistema não tem infraestrutura de upload (imagem entra por URL — decisão
// registrada quando o editor nasceu), então o inspetor de imagem oferece o
// campo de URL e nada finge o contrário.

import { useMemo, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ChevronDown,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  Plus,
  Search,
  Share2,
  Trash2,
  Type,
} from 'lucide-react';

import { cn } from '../../lib/criador/cn.js';
import { findBlock } from '../../lib/criador/ops.js';
import { BLOCK_LABELS, FONT_OPTIONS, STRUCTURES } from '../../lib/criador/presets.js';
import type {
  Block,
  BlockType,
  DesignSettings,
  EmailDesign,
  Row,
  SavedModule,
} from '../../lib/criador/tipos.js';
import { RowView, type DragState, type Selection } from './Canvas.tsx';

// ─── Campos reutilizáveis ────────────────────────────────────────

const classeCampo =
  'h-10 w-full rounded-md border border-line bg-paper-light px-3 text-sm text-ink';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-ink-suave">{label}</span>
      {children}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
  allowInherit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowInherit?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-ink-suave">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-md border border-line bg-transparent p-1"
          aria-label={label}
        />
        <input
          value={value}
          placeholder={allowInherit === true ? 'herdar' : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} (hex)`}
          className={cn(classeCampo, 'font-mono text-xs')}
        />
        {allowInherit === true && value !== '' ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs text-ink-suave hover:text-ink"
            title="Herdar da configuração global"
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AlignField({
  value,
  onChange,
}: {
  value: 'left' | 'center' | 'right';
  onChange: (value: 'left' | 'center' | 'right') => void;
}) {
  const options = [
    { key: 'left' as const, rotulo: 'Alinhar à esquerda', icon: AlignLeft },
    { key: 'center' as const, rotulo: 'Centralizar', icon: AlignCenter },
    { key: 'right' as const, rotulo: 'Alinhar à direita', icon: AlignRight },
  ];
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-ink-suave">Alinhamento</span>
      <div className="flex gap-1 rounded-md border border-line p-0.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-label={option.rotulo}
            aria-pressed={value === option.key}
            onClick={() => onChange(option.key)}
            className={cn(
              'flex h-8 flex-1 items-center justify-center rounded [&_svg]:size-4',
              value === option.key ? 'bg-wine/10 text-wine' : 'text-ink-suave hover:text-ink',
            )}
          >
            <option.icon />
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  suffix = 'px',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <Field label={`${label} (${suffix})`}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={classeCampo}
      />
    </Field>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ink hover:bg-accent-mist/60"
      >
        {title}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

// ─── Inspetores ──────────────────────────────────────────────────

const BLOCK_ICONS: Record<BlockType, React.ElementType> = {
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  spacer: MoveVertical,
  divider: Minus,
  social: Share2,
};

function BlockInspector({
  block,
  onUpdate,
}: {
  block: Block;
  onUpdate: (updater: (block: Block) => Block) => void;
}) {
  const patchAttrs = (patch: Record<string, unknown>) =>
    onUpdate((b) => ({ ...b, attrs: { ...b.attrs, ...patch } }) as Block);

  return (
    <div className="grid gap-4">
      {block.type === 'text' ? (
        <>
          <p className="text-xs text-ink-suave">
            Edite o texto direto no e-mail. Selecione um trecho e use a barra do bloco para
            negrito/itálico/link, aumentar ou diminuir a fonte só daquele trecho, ou limpar a
            formatação. Texto colado de fora entra com a tipografia do e-mail. Variáveis:{' '}
            {'{{contato.primeiroNome}}, {{contato.nome}}, {{contato.email}}'}.
          </p>
          <NumberField
            label="Tamanho da fonte (bloco todo)"
            value={block.attrs.fontSize}
            min={8}
            max={60}
            onChange={(v) => patchAttrs({ fontSize: v })}
          />
          <AlignField value={block.attrs.align} onChange={(v) => patchAttrs({ align: v })} />
          <ColorField
            label="Cor do texto"
            value={block.attrs.color}
            onChange={(v) => patchAttrs({ color: v })}
            allowInherit
          />
        </>
      ) : null}

      {block.type === 'image' ? (
        <>
          <Field label="URL da imagem">
            <input
              value={block.src}
              onChange={(e) => onUpdate((b) => ({ ...b, src: e.target.value }))}
              className={classeCampo}
            />
          </Field>
          <p className="text-xs text-ink-suave">
            A imagem entra por endereço: hospede o arquivo (no site do escritório, por exemplo) e
            cole a URL aqui. Imagem embutida é bloqueada pela maioria dos clientes de e-mail.
          </p>
          <Field label="Texto alternativo">
            <input
              value={block.alt}
              onChange={(e) => onUpdate((b) => ({ ...b, alt: e.target.value }))}
              className={classeCampo}
            />
          </Field>
          <Field label="Link ao clicar (opcional)">
            <input
              value={block.href}
              placeholder="https://..."
              onChange={(e) => onUpdate((b) => ({ ...b, href: e.target.value }))}
              className={classeCampo}
            />
          </Field>
          <NumberField
            label="Largura fixa (0 = total)"
            value={block.attrs.width ?? 0}
            max={600}
            onChange={(v) => patchAttrs({ width: v > 0 ? v : null })}
          />
          <NumberField
            label="Arredondamento"
            value={block.attrs.borderRadius}
            max={60}
            onChange={(v) => patchAttrs({ borderRadius: v })}
          />
          <AlignField value={block.attrs.align} onChange={(v) => patchAttrs({ align: v })} />
        </>
      ) : null}

      {block.type === 'button' ? (
        <>
          <Field label="Texto do botão">
            <input
              value={block.text}
              onChange={(e) => onUpdate((b) => ({ ...b, text: e.target.value }))}
              className={classeCampo}
            />
          </Field>
          <Field label="Link (href)">
            <input
              value={block.href}
              placeholder="https://..."
              onChange={(e) => onUpdate((b) => ({ ...b, href: e.target.value }))}
              className={classeCampo}
            />
          </Field>
          <ColorField
            label="Cor de fundo"
            value={block.attrs.backgroundColor}
            onChange={(v) => patchAttrs({ backgroundColor: v })}
          />
          <ColorField
            label="Cor do texto"
            value={block.attrs.color}
            onChange={(v) => patchAttrs({ color: v })}
          />
          <NumberField
            label="Tamanho da fonte"
            value={block.attrs.fontSize}
            min={10}
            max={30}
            onChange={(v) => patchAttrs({ fontSize: v })}
          />
          <NumberField
            label="Arredondamento"
            value={block.attrs.borderRadius}
            max={40}
            onChange={(v) => patchAttrs({ borderRadius: v })}
          />
          <AlignField value={block.attrs.align} onChange={(v) => patchAttrs({ align: v })} />
        </>
      ) : null}

      {block.type === 'spacer' ? (
        <NumberField
          label="Altura"
          value={block.attrs.height}
          min={4}
          max={200}
          onChange={(v) => patchAttrs({ height: v })}
        />
      ) : null}

      {block.type === 'divider' ? (
        <>
          <ColorField
            label="Cor da linha"
            value={block.attrs.borderColor}
            onChange={(v) => patchAttrs({ borderColor: v })}
          />
          <NumberField
            label="Espessura"
            value={block.attrs.borderWidth}
            min={1}
            max={10}
            onChange={(v) => patchAttrs({ borderWidth: v })}
          />
        </>
      ) : null}

      {block.type === 'social' ? (
        <>
          <NumberField
            label="Tamanho dos ícones"
            value={block.attrs.iconSize}
            min={20}
            max={64}
            onChange={(v) => patchAttrs({ iconSize: v })}
          />
          <AlignField value={block.attrs.align} onChange={(v) => patchAttrs({ align: v })} />
          <div className="grid gap-3">
            <span className="text-xs text-ink-suave">Redes</span>
            {block.items.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-md border border-line p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink">{item.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate((b) =>
                        b.type === 'social'
                          ? { ...b, items: b.items.filter((_, i) => i !== index) }
                          : b,
                      )
                    }
                    className="text-ink-suave hover:text-erro"
                    aria-label={`Remover ${item.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <input
                  value={item.href}
                  placeholder="https://..."
                  aria-label={`Link de ${item.label}`}
                  onChange={(e) =>
                    onUpdate((b) =>
                      b.type === 'social'
                        ? {
                            ...b,
                            items: b.items.map((it, i) =>
                              i === index ? { ...it, href: e.target.value } : it,
                            ),
                          }
                        : b,
                    )
                  }
                  className={cn(classeCampo, 'text-xs')}
                />
                <input
                  value={item.iconSrc}
                  placeholder="URL do ícone"
                  aria-label={`Ícone de ${item.label}`}
                  onChange={(e) =>
                    onUpdate((b) =>
                      b.type === 'social'
                        ? {
                            ...b,
                            items: b.items.map((it, i) =>
                              i === index ? { ...it, iconSrc: e.target.value } : it,
                            ),
                          }
                        : b,
                    )
                  }
                  className={cn(classeCampo, 'text-xs')}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {'padding' in block.attrs ? (
        <Field label="Espaçamento (padding CSS)">
          <input
            value={(block.attrs as { padding: string }).padding}
            placeholder="10px 24px"
            onChange={(e) => patchAttrs({ padding: e.target.value })}
            className={cn(classeCampo, 'font-mono text-xs')}
          />
        </Field>
      ) : null}
    </div>
  );
}

function RowInspector({
  row,
  onUpdate,
}: {
  row: Row;
  onUpdate: (patch: Partial<Row['attrs']>) => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-xs text-ink-suave">
        Linha com {row.columns.length} coluna{row.columns.length > 1 ? 's' : ''}. Selecione uma
        coluna vazia no e-mail e clique num bloco abaixo para inseri-lo nela.
      </p>
      <ColorField
        label="Cor de fundo da linha"
        value={row.attrs.backgroundColor}
        onChange={(v) => onUpdate({ backgroundColor: v })}
        allowInherit
      />
      <Field label="Espaçamento (padding CSS)">
        <input
          value={row.attrs.padding}
          placeholder="0px 0px"
          onChange={(e) => onUpdate({ padding: e.target.value })}
          className={cn(classeCampo, 'font-mono text-xs')}
        />
      </Field>
    </div>
  );
}

// ─── Painel lateral ──────────────────────────────────────────────

export function Sidebar({
  design,
  selection,
  modules,
  onAddStructure,
  onAddBlock,
  onInsertModule,
  onDeleteModule,
  onUpdateBlock,
  onUpdateRowAttrs,
  onUpdateSettings,
  onClearSelection,
  onDragChange,
}: {
  design: EmailDesign;
  selection: Selection | null;
  modules: SavedModule[];
  onAddStructure: (widths: number[]) => void;
  onAddBlock: (type: BlockType) => void;
  onInsertModule: (module: SavedModule) => void;
  onDeleteModule: (id: string) => void;
  onUpdateBlock: (blockId: string, updater: (block: Block) => Block) => void;
  onUpdateRowAttrs: (rowId: string, patch: Partial<Row['attrs']>) => void;
  onUpdateSettings: (patch: Partial<DesignSettings>) => void;
  onClearSelection: () => void;
  onDragChange: (drag: DragState | null) => void;
}) {
  const [tab, setTab] = useState<'content' | 'settings'>('content');
  const [openSections, setOpenSections] = useState({
    structures: true,
    blocks: true,
    modules: true,
  });
  const [moduleSearch, setModuleSearch] = useState('');

  const selectedBlock =
    selection?.blockId !== undefined ? findBlock(design, selection.blockId) : null;
  const selectedRow =
    selection !== null && selection.blockId === undefined
      ? (design.rows.find((r) => r.id === selection.rowId) ?? null)
      : null;

  const filteredModules = useMemo(() => {
    const term = moduleSearch.trim().toLowerCase();
    if (term === '') return modules;
    return modules.filter((m) => m.name.toLowerCase().includes(term));
  }, [modules, moduleSearch]);

  const toggle = (key: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  return (
    // max-h em vh (não h-full/%) porque a porcentagem de altura não resolve
    // de forma confiável através de um ancestral position:sticky — vh
    // independe da altura de qualquer contêiner pai.
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper-light lg:max-h-[calc(100vh-13rem)]">
      {/* Abas */}
      <div role="tablist" aria-label="Painel do criador" className="flex border-b border-line">
        {(
          [
            { key: 'content', label: 'Conteúdo' },
            { key: 'settings', label: 'Configurações globais' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 border-b-2 px-3 py-2.5 text-sm font-medium',
              tab === t.key
                ? 'border-wine text-wine'
                : 'border-transparent text-ink-suave hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'settings' ? (
          <div className="grid gap-4 p-4">
            <ColorField
              label="Fundo da página"
              value={design.settings.bodyBackground}
              onChange={(v) => onUpdateSettings({ bodyBackground: v })}
            />
            <ColorField
              label="Fundo do conteúdo"
              value={design.settings.contentBackground}
              onChange={(v) => onUpdateSettings({ contentBackground: v })}
            />
            <ColorField
              label="Cor padrão do texto"
              value={design.settings.textColor}
              onChange={(v) => onUpdateSettings({ textColor: v })}
            />
            <ColorField
              label="Cor dos links"
              value={design.settings.linkColor}
              onChange={(v) => onUpdateSettings({ linkColor: v })}
            />
            <Field label="Fonte">
              <select
                value={design.settings.fontFamily}
                onChange={(e) => onUpdateSettings({ fontFamily: e.target.value })}
                className={classeCampo}
              >
                {FONT_OPTIONS.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : selectedBlock !== null ? (
          <div>
            <button
              type="button"
              onClick={onClearSelection}
              className="flex w-full items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold text-ink hover:bg-accent-mist/60"
            >
              <ArrowLeft className="size-4" />
              Bloco: {BLOCK_LABELS[selectedBlock.block.type]}
            </button>
            <div className="p-4">
              {selectedBlock.block.customHtml?.trim() !== undefined &&
              selectedBlock.block.customHtml.trim() !== '' ? (
                <AvisoDeCodigoProprio o="bloco" />
              ) : null}
              <BlockInspector
                block={selectedBlock.block}
                onUpdate={(updater) => onUpdateBlock(selectedBlock.block.id, updater)}
              />
            </div>
          </div>
        ) : selectedRow !== null ? (
          <div>
            <button
              type="button"
              onClick={onClearSelection}
              className="flex w-full items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold text-ink hover:bg-accent-mist/60"
            >
              <ArrowLeft className="size-4" />
              Linha selecionada
            </button>
            <div className="p-4">
              {selectedRow.customHtml?.trim() !== undefined &&
              selectedRow.customHtml.trim() !== '' ? (
                <AvisoDeCodigoProprio o="estrutura" />
              ) : null}
              <RowInspector
                row={selectedRow}
                onUpdate={(patch) => onUpdateRowAttrs(selectedRow.id, patch)}
              />
            </div>
            <div className="border-t border-line">
              <Section title="Blocos" open={openSections.blocks} onToggle={() => toggle('blocks')}>
                <BlockPalette onAddBlock={onAddBlock} onDragChange={onDragChange} />
              </Section>
            </div>
          </div>
        ) : (
          <>
            <Section
              title="Estruturas"
              open={openSections.structures}
              onToggle={() => toggle('structures')}
            >
              <div className="grid gap-2">
                {STRUCTURES.map((structure) => (
                  <button
                    key={structure.label}
                    type="button"
                    draggable
                    onClick={() => onAddStructure(structure.widths)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', structure.label);
                      e.dataTransfer.effectAllowed = 'move';
                      // Adiar evita o Chrome cancelar o arraste ao re-renderizar.
                      window.setTimeout(
                        () =>
                          onDragChange({
                            kind: 'new-structure',
                            widths: structure.widths,
                          }),
                        0,
                      );
                    }}
                    onDragEnd={() => onDragChange(null)}
                    title={`${structure.label} — clique ou arraste para o e-mail`}
                    className="flex cursor-grab gap-1.5 rounded-md border border-line p-2.5 hover:border-wine/60 active:cursor-grabbing"
                  >
                    {structure.widths.map((width, index) => (
                      <span
                        key={index}
                        style={{ width: `${String(width)}%` }}
                        className="h-7 rounded border border-dashed border-gold/60 bg-accent-mist/60"
                      />
                    ))}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Blocos" open={openSections.blocks} onToggle={() => toggle('blocks')}>
              <BlockPalette onAddBlock={onAddBlock} onDragChange={onDragChange} />
            </Section>

            <Section title="Módulos" open={openSections.modules} onToggle={() => toggle('modules')}>
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-suave" />
                <input
                  value={moduleSearch}
                  onChange={(e) => setModuleSearch(e.target.value)}
                  placeholder="Nome do módulo…"
                  aria-label="Buscar módulo"
                  className={cn(classeCampo, 'h-9 pl-8 text-xs')}
                />
              </div>
              {filteredModules.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-suave">
                  {modules.length === 0
                    ? 'Nenhum módulo salvo. Selecione uma linha no e-mail e use o ícone de marcador para salvá-la.'
                    : 'Nenhum módulo com esse nome.'}
                </p>
              ) : (
                <div className="grid gap-2">
                  {filteredModules.map((module) => (
                    <div key={module.id} className="overflow-hidden rounded-md border border-line">
                      <button
                        type="button"
                        onClick={() => onInsertModule(module)}
                        title="Inserir módulo"
                        className="block w-full bg-white"
                      >
                        <div className="pointer-events-none origin-top-left scale-50 [width:200%]">
                          <RowView row={module.design} design={design} readOnly />
                        </div>
                      </button>
                      <div className="flex items-center justify-between border-t border-line px-2.5 py-1.5">
                        <span className="truncate text-xs font-medium text-ink">{module.name}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onInsertModule(module)}
                            className="text-ink-suave hover:text-wine"
                            aria-label={`Inserir ${module.name}`}
                          >
                            <Plus className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteModule(module.id)}
                            className="text-ink-suave hover:text-erro"
                            aria-label={`Excluir ${module.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Dica acima dos controles quando o pedaço tem HTML próprio.
 *
 * Nada fica travado: os ajustes abaixo são aplicados direto no código, e o
 * texto continua editável no e-mail. A dica só explica onde mexer no que os
 * controles não cobrem (a estrutura do código em si).
 */
function AvisoDeCodigoProprio({ o }: { o: 'bloco' | 'estrutura' }) {
  const rotulo = o === 'bloco' ? 'Código do bloco' : 'Código da estrutura';
  return (
    <div className="mb-4 rounded-md border border-gold/30 bg-accent-mist px-3 py-2.5 text-xs text-ink-suave">
      {o === 'bloco' ? 'Este bloco' : 'Esta estrutura'} está com{' '}
      <span className="font-medium">HTML próprio</span>. Os ajustes abaixo são aplicados direto no
      código, e o texto segue editável no e-mail. Para mudar a estrutura do código — ou voltar ao
      gerado — use o botão <span className="font-medium">{rotulo}</span>, acima do e-mail.
    </div>
  );
}

function BlockPalette({
  onAddBlock,
  onDragChange,
}: {
  onAddBlock: (type: BlockType) => void;
  onDragChange: (drag: DragState | null) => void;
}) {
  return (
    <div className="grid gap-2">
      {(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => {
        const Icon = BLOCK_ICONS[type];
        return (
          <button
            key={type}
            type="button"
            draggable
            onClick={() => onAddBlock(type)}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', BLOCK_LABELS[type]);
              e.dataTransfer.effectAllowed = 'move';
              // Adiar evita o Chrome cancelar o arraste ao re-renderizar.
              window.setTimeout(() => onDragChange({ kind: 'new-block', blockType: type }), 0);
            }}
            onDragEnd={() => onDragChange(null)}
            title={`${BLOCK_LABELS[type]} — clique ou arraste para o e-mail`}
            className="flex cursor-grab items-center gap-3 rounded-md border border-line px-3 py-2.5 text-sm font-medium text-ink hover:border-wine/60 active:cursor-grabbing"
          >
            <Icon className="size-4 text-ink-suave" />
            {BLOCK_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}
