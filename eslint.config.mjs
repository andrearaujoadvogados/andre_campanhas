import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Fronteira da arquitetura hexagonal — §5.1 e §8 de docs/ARQUITETURA.md.
 *
 * A regra de dependência não é disciplina, é build quebrado. `packages/core`
 * não conhece AWS, não conhece HTTP e não conhece os adaptadores. Sem esta
 * verificação, a fronteira degrada em poucos meses e o domínio deixa de ser
 * testável sem infraestrutura — que é a única razão de ela existir.
 */
const IMPORTS_PROIBIDOS_NO_CORE = [
  {
    group: ['@aws-sdk/*', 'aws-cdk-lib', 'aws-cdk-lib/*', 'aws-lambda', '@aws-lambda-powertools/*'],
    message:
      'packages/core não pode depender de AWS. Defina um port em src/application/ports e implemente em packages/adapters-aws.',
  },
  {
    group: ['@emailmkt/adapters-aws', '@emailmkt/adapters-aws/*', '@emailmkt/infra'],
    message:
      'Inversão de dependência: o core define a interface, o adaptador a implementa. Nunca o contrário.',
  },
  {
    group: ['hono', 'express', 'fastify', 'zod'],
    message:
      'packages/core não conhece transporte nem validação de borda. Schemas ficam em @emailmkt/contracts; o core recebe tipos de domínio já validados.',
  },
  {
    group: ['../../adapters-aws/**', '../../../adapters-aws/**', '../../../services/**'],
    message: 'Import relativo atravessando a fronteira do pacote. Use o domínio ou um port.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cdk.out/**',
      '**/coverage/**',
      '**/.turbo/**',
      'apps/admin-web/dist/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ⬇ A fronteira.
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: IMPORTS_PROIBIDOS_NO_CORE },
      ],
    },
  },

  // Contracts é puro Zod — não conhece domínio nem AWS.
  {
    files: ['packages/contracts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-sdk/*', 'aws-cdk-lib', '@emailmkt/core', '@emailmkt/adapters-aws'],
              message:
                '@emailmkt/contracts é a fronteira de dados entre frontend e backend. Mantenha-o sem dependências além do Zod.',
            },
          ],
        },
      ],
    },
  },

  // Testes podem usar console e afrouxar tipagem pontualmente.
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Infra é CDK — nada das regras acima se aplica.
  {
    files: ['infra/**/*.ts'],
    rules: {
      'no-new': 'off',
    },
  },
);
