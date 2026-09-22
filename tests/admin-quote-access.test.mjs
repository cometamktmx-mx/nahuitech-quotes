import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, webcrypto } from 'node:crypto';
import { hasLocalPostgres, verifyQuoteSql } from './admin-quote-sql.mjs';

test('PostgreSQL execution of the five exact signatures', {
  skip: hasLocalPostgres ? false : 'Install isolated PGlite: npm install --prefix tmp/sql-validation --no-save --package-lock=false @electric-sql/pglite',
}, verifyQuoteSql);

const migrations = 'supabase/migrations/';
const fixSql = readFileSync(`${migrations}20260922000030_admin_quote_access_fix.sql`, 'utf8');
const sqlFunctions = [
  ['20260824000010_catalog_rules_data.sql', 'preview_quote_coupon', 'uuid,jsonb,text', 'v_seller_role'],
  ['20260825000013_expo_access_and_machine_variants.sql', 'preview_quote_coupon', 'uuid,jsonb,text,uuid', 'v_role'],
  ['20260907000022_multi_machine_quotes.sql', 'preview_multi_quote_coupon', 'jsonb,text', null],
  ['20260905000020_machine_images.sql', 'create_quote', 'uuid,jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,text,uuid,uuid', 'v_creator_role'],
  ['20260907000022_multi_machine_quotes.sql', 'create_multi_quote', 'jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,uuid', 'v_creator_role'],
];

function definitions(sql) {
  return [...sql.matchAll(/create(?: or replace)? function public\.(\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$;/gi)].map((match) => ({
    name: match[1],
    signature: match[2].split(',').map((arg) => arg.trim().split(/\s+/)[1]).join(','),
    text: match[0].replace(/^create(?: or replace)? function/i, 'CREATE OR REPLACE FUNCTION').replaceAll('\r\n', '\n'),
  }));
}

test('00030 explicitly replaces all five signatures without changing ACLs or RLS', () => {
  const functions = definitions(fixSql);
  assert.equal(functions.length, 5);
  assert.equal(functions.filter((fn) => fn.name === 'preview_quote_coupon').length, 2);
  const statements = fixSql.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(statements, /^\s*(drop|grant|revoke|alter)\b|\b(proname|pg_get_functiondef)\b|execute\s+replace\s*\(/im);
  assert.match(statements, /to_regprocedure\(signature\)/);
  for (const [, name, signature] of sqlFunctions) {
    assert.ok(functions.some((fn) => fn.name === name && fn.signature === signature));
    assert.ok(fixSql.includes(`'public.${name}(${signature})'`));
  }
});

for (const [file, name, signature, variable] of sqlFunctions) {
  test(`SQL implementation unchanged except role authorization: ${name}(${signature})`, () => {
    const before = definitions(readFileSync(migrations + file, 'utf8')).find((fn) => fn.name === name && fn.signature === signature);
    const after = definitions(fixSql).find((fn) => fn.name === name && fn.signature === signature);
    assert.ok(before);
    assert.ok(after);
    const addition = variable === 'v_seller_role'
      ? "\n    and v_seller_role is distinct from 'expo'::public.profile_role\n    and v_seller_role is distinct from 'admin'::public.profile_role"
      : variable ? `\n    and ${variable} is distinct from 'admin'::public.profile_role` : ",'admin'";
    assert.equal(after.text.split(addition).length, 2);
    assert.equal(after.text.replace(addition, ''), before.text);
    assert.match(after.text, /language plpgsql\s+security definer\s+set search_path\s*=\s*''/i);
    assert.match(after.text, /(?:profile|p)\.active|and active/);
  });
}

test('failed 00029 is untouched', () => {
  const hash = createHash('sha256').update(readFileSync(`${migrations}20260922000029_admin_quote_access.sql`, 'utf8').replaceAll('\r\n', '\n')).digest('hex');
  const original = '1a01820915eb063b97f64ecafa0ec9ad5e11a3a8d36e8f469834c7ed1903e51a';
  assert.equal(hash, original);
});

function load(path, dependencies) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, crypto: webcrypto, require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test' } },
  });
  return exports;
}

function client(profile, authenticated = true) {
  return {
    auth: { getClaims: async () => ({ data: { claims: { sub: authenticated ? 'admin-user-id' : null } } }) },
    from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: profile }) }),
  };
}

for (const role of ['admin', 'seller', 'expo', 'unknown']) {
  for (const active of [true, false]) {
    test(`page and action access: ${role}, active=${active}`, async () => {
      const profile = { role, active, salesperson_id: null };
      const supabase = client(profile);
      const deps = {
        '@/lib/supabase/server': { createClient: async () => supabase },
        'next/navigation': { redirect: (path) => { throw new Error(`redirect:${path}`); } },
      };
      const guards = load('src/lib/auth/require-role.ts', deps);
      const actions = load('src/lib/auth/get-seller-client.ts', deps);
      if (active && role !== 'unknown') {
        assert.equal(await guards.requireSellerFlowRole(), profile);
        assert.equal(await actions.getSellerClient(), supabase);
      } else {
        await assert.rejects(guards.requireSellerFlowRole(), /redirect:\/login/);
        await assert.rejects(actions.getSellerClient(), /No autorizado/);
      }
      if (active && role === 'admin') assert.equal(await guards.requireRole('admin'), profile);
      else await assert.rejects(guards.requireRole('admin'), /redirect:/);
    });
  }
}

for (const role of ['admin', 'seller', 'expo']) {
  for (const path of ['/admin', '/seller', '/seller/quote/machine', '/login']) {
    test(`proxy: ${role} visiting ${path}`, async () => {
      const response = { cookies: { getAll: () => [], set() {} }, headers: { get: () => null } };
      const { updateSession } = load('src/lib/supabase/proxy.ts', {
        '@supabase/ssr': { createServerClient: () => client({ role, active: true }) },
        'next/server': { NextResponse: { next: () => response, redirect: (url) => ({ ...response, redirect: url.pathname }) } },
      });
      const result = await updateSession({ nextUrl: { pathname: path, clone: () => ({ pathname: path, search: '' }) } });
      const expected = path === '/login' || (path === '/admin' && role !== 'admin')
        ? role === 'admin' ? '/admin' : '/seller' : undefined;
      assert.equal(result.redirect, expected);
    });
  }
}

test('unauthenticated callers cannot use the page or action guards', async () => {
  const deps = {
    '@/lib/supabase/server': { createClient: async () => client(null, false) },
    'next/navigation': { redirect: (path) => { throw new Error(`redirect:${path}`); } },
  };
  await assert.rejects(load('src/lib/auth/require-role.ts', deps).requireSellerFlowRole(), /redirect:\/login/);
  await assert.rejects(load('src/lib/auth/get-seller-client.ts', deps).getSellerClient(), /No autorizado/);
});

for (const role of ['admin', 'expo', 'seller']) {
  test(`offline attribution and salesperson restrictions: ${role}`, async () => {
    const profile = { role, active: true, fullName: 'Account name', salespersonId: role === 'seller' ? 'advisor' : null };
    const emptyQuery = { where() { return this; }, equals() { return this; }, toArray: async () => [] };
    const storedQuotes = [];
    const db = {
      sellerProfiles: { get: async () => profile },
      machines: { get: async () => ({ id: 'machine', name: 'Machine', active: true, basePrice: 100, deliveryPolicy: 'FLEXIBLE' }) },
      machineAddons: emptyQuery, machineVariants: emptyQuery,
      addons: { bulkGet: async () => [] },
      salespeople: { get: async (id) => ({ id, fullName: 'Commercial advisor', active: id === 'advisor' }) },
      offlineCustomers: { put: async () => {} },
      offlineQuotes: { put: async (quote) => storedQuotes.push(quote) },
      syncQueue: { put: async () => {} },
      transaction: async (_mode, _tables, operation) => operation(),
    };
    const { createOfflineQuote } = load('src/lib/offline/offline-quotes.ts', {
      './offline-db': { offlineDb: db },
      './quote-calculation': {
        OfflineQuoteValidationError: Error,
        calculateConfiguration: () => ({ subtotal: 100, quoteAddons: [] }),
      },
      '@/lib/quotes/tax': { calculateIncludedTaxBreakdown: () => ({ subtotalBeforeTax: 100, taxRate: 0, taxAmount: 0 }) },
    });
    const input = { sellerId: 'authenticated-user', salespersonId: 'advisor', machineId: 'machine', machineVariantId: null,
      addonQuantities: {}, customerName: 'Customer', customerCompany: '', customerWhatsapp: '5555555555',
      customerEmail: '', deliveryType: 'LATER', couponCode: '' };
    const quote = await createOfflineQuote(input);
    assert.equal(quote.sellerId, 'authenticated-user');
    assert.equal(quote.salespersonId, 'advisor');
    assert.equal(quote.salespersonNameSnapshot, 'Commercial advisor');
    assert.equal(quote.pdfSnapshot.sellerName, 'Commercial advisor');
    assert.equal(storedQuotes.length, 1);
    if (role !== 'seller') {
      await assert.rejects(createOfflineQuote({ ...input, salespersonId: null }));
      await assert.rejects(createOfflineQuote({ ...input, salespersonId: 'inactive' }));
    } else {
      await assert.rejects(createOfflineQuote({ ...input, salespersonId: 'another-advisor' }));
    }
    assert.equal(storedQuotes.length, 1);
  });
}
