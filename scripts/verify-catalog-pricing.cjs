/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader tests production TS without additional runtime dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Exercise production TypeScript directly, without maintaining a duplicate formula.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.resolve('src', request.slice(2)) : request, ...args);
};
const { grossToNet, calculateIncludedTaxBreakdown, netDiscount } = require('../src/lib/quotes/tax.ts');
const { calculateConfiguration, validateOfflineCoupon } = require('../src/lib/offline/quote-calculation.ts');

async function main() {
  const oldSql = fs.readFileSync('supabase/migrations/20260825000018_variant_descriptions_and_tax.sql', 'utf8');
  const newSql = fs.readFileSync('supabase/migrations/20260905000020_machine_images.sql', 'utf8');
  const normalizedRpc = (sql) => sql.slice(sql.indexOf('create or replace function public.create_quote('), sql.lastIndexOf('commit;'))
    .replace(/  v_image_url :=[\s\S]*?  insert into public.customers/, '  IMAGE_VALIDATION\n  insert into public.customers').trim();
  assert.equal(normalizedRpc(newSql), normalizedRpc(oldSql), 'RPC auth, commercial calculations and fiscal snapshots must remain unchanged');
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    return request === 'server-only' ? {} : originalLoad.call(this, request, ...args);
  };
  const { uploadMachineImage, logMachineImageStorageError } = require('../src/lib/machine-images.server.ts');
  const sharp = require('sharp');
  let uploadedBytes;
  const machineId = '11111111-1111-4111-8111-111111111111';
  let profile = { role: 'admin', active: true };
  let authenticatedUser = { id: 'test-admin' };
  let returnedError = null;
  let uploadCount = 0;
  const paths = [];
  const storageClient = {
    auth: { getUser: async () => ({ data: { user: authenticatedUser }, error: null }) },
    from: (table) => {
      assert.equal(table, 'profiles');
      return { select: () => ({ eq: (column, id) => {
        assert.equal(column, 'id'); assert.equal(id, authenticatedUser.id);
        return { maybeSingle: async () => ({ data: profile, error: null }) };
      } }) };
    },
    storage: { from: (bucket) => {
    assert.equal(bucket, 'machine-images');
    return {
      upload: async (key, bytes, options) => {
        assert.ok(key.startsWith(`machines/${machineId}/`)); assert.match(key, /\/[0-9a-f-]{36}\.jpg$/);
        assert.equal(options.upsert, false); assert.equal(options.contentType, 'image/jpeg');
        uploadCount++; paths.push(key); uploadedBytes = bytes; return { error: returnedError };
      },
      getPublicUrl: (key) => ({ data: { publicUrl: `https://project.test/storage/v1/object/public/machine-images/${key}` } }),
    };
  } } };
  const inputPhoto = fs.readFileSync('public/machines/hyro-set-ome.png');
  for (const [format, type] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const file = new File([await sharp(inputPhoto).toFormat(format).toBuffer()], `photo.${format}`, { type });
    await uploadMachineImage(storageClient, machineId, file);
    const metadata = await sharp(uploadedBytes).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.ok(metadata.width <= 2000 && metadata.height <= 2000);
  }
  assert.equal(new Set(paths).size, 3, 'Replacement uses a fresh path');
  await assert.rejects(uploadMachineImage(storageClient, machineId, new File(['invalid'], 'bad.png', { type: 'image/png' })));
  await assert.rejects(uploadMachineImage(storageClient, machineId, new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })));
  const photo = new File([inputPhoto], 'photo.png', { type: 'image/png' });
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logs.push(values);
  try {
    for (const invalidProfile of [{ role: 'seller', active: true }, { role: 'expo', active: true }, { role: 'admin', active: false }, null]) {
      profile = invalidProfile;
      await assert.rejects(uploadMachineImage(storageClient, machineId, photo), /No autorizado/);
    }
    authenticatedUser = null;
    await assert.rejects(uploadMachineImage(storageClient, machineId, photo), /No autorizado/);
    assert.equal(uploadCount, 3, 'Unauthorized requests never reach Storage');
    authenticatedUser = { id: 'test-admin' }; profile = { role: 'admin', active: true };
    await assert.rejects(uploadMachineImage(storageClient, 'undefined', photo), /identificador/);
    const { StorageApiError } = require('@supabase/storage-js');
    returnedError = new StorageApiError('Bucket not found', 400, '404', 'storage', 'NoSuchBucket');
    returnedError.headers = { authorization: 'DO_NOT_LOG' };
    returnedError.originalError = { cookies: 'DO_NOT_LOG' };
    await assert.rejects(uploadMachineImage(storageClient, machineId, photo), /No se pudo subir la fotografía/);
    const errorLog = logs.find(([label]) => label === '[machine image upload error]')[1];
    assert.deepEqual(errorLog, { name: 'StorageApiError', message: 'Bucket not found', statusCode: '404', status: 400, code: 'NoSuchBucket' });
    const context = logs.find(([label]) => label === '[machine image upload context]')[1];
    assert.equal(context.contentType, 'image/jpeg'); assert.equal(context.role, 'admin');
    assert.equal(context.active, true); assert.ok(paths.includes(context.path));
    logMachineImageStorageError('optional field', { name: 'StorageError', error: 'Unauthorized', token: 'DO_NOT_LOG' });
    assert.deepEqual(logs.at(-1)[1], { name: 'StorageError', error: 'Unauthorized' });
    assert.ok(!JSON.stringify(logs).includes('DO_NOT_LOG'));
  } finally { console.error = originalConsoleError; }
  if (process.argv.includes('--upload-only')) {
    console.log('PASS: upload/replace mocks, real JPEG conversion, admin getUser/profile checks, non-admin rejection, path/MIME, exact error allowlist without credentials. No live Storage writes.');
    return;
  }
  for (const [gross, net, tax] of [[249990, 215508.62, 34481.38], [118000, 101724.14, 16275.86], [4000, 3448.28, 551.72]]) {
    assert.equal(grossToNet(gross), net);
    assert.equal(calculateIncludedTaxBreakdown(gross).taxAmount, tax);
  }
  const machine = { basePrice: 249990, supportsAddons: true, numberOfBases: 8 };
  const addon = { id: 'acople', unitPrice: 100, calculationType: 'PER_BASE', name: 'Acople' };
  const result = calculateConfiguration(machine, [addon], { acople: 1 }, new Map([['acople', { unitPriceOverride: 6250 }]]));
  assert.equal(result.quoteAddons[0].quantity, 8);
  assert.equal(result.quoteAddons[0].lineTotal, 50000);
  assert.equal(grossToNet(result.quoteAddons[0].unitPrice), 5387.93);
  assert.equal(grossToNet(result.quoteAddons[0].lineTotal), 43103.45);
  for (const type of ['FIXED', 'QUANTITY']) {
    const quantity = type === 'FIXED' ? 1 : 3;
    const line = calculateConfiguration(machine, [{ ...addon, unitPrice: 4000, calculationType: type }], { acople: quantity }, new Map([['acople', {}]])).quoteAddons[0];
    assert.equal(line.lineTotal, 4000 * quantity);
  }
  for (const discountType of ['PERCENTAGE', 'FIXED_AMOUNT']) {
    const coupon = validateOfflineCoupon({ active: true, appliesToAllMachines: true, discountType, discountValue: 10 }, 'ome', new Set(), result.subtotal);
    const total = Math.round((result.subtotal - coupon.discountAmount) * 100) / 100;
    const fiscal = calculateIncludedTaxBreakdown(total);
    assert.equal(Math.round((fiscal.subtotalBeforeTax + fiscal.taxAmount) * 100), Math.round(total * 100));
    assert.equal(Math.round((grossToNet(result.subtotal) - netDiscount(result.subtotal, total)) * 100), Math.round(fiscal.subtotalBeforeTax * 100));
  }
  for (let cents = 1; cents < 10000000; cents += 137) {
    const fiscal = calculateIncludedTaxBreakdown(cents / 100);
    assert.equal(Math.round(fiscal.subtotalBeforeTax * 100) + Math.round(fiscal.taxAmount * 100), cents);
  }

  const assets = new Map();
  global.caches = { open: async () => ({
    match: async (url) => assets.get(url)?.clone(),
    put: async (url, response) => assets.set(url, response.clone()),
  }) };
  const jpeg = fs.readFileSync('public/machines/hyro-set-ome.png');
  global.fetch = async () => new Response(jpeg, { headers: { 'Content-Type': 'image/png' } });
  const { cacheMachineImage, loadMachineImageBytes } = require('../src/lib/offline/machine-image-cache.ts');
  await cacheMachineImage('https://example.test/v1.jpg', true);
  await cacheMachineImage('https://example.test/v2.jpg', true);
  global.fetch = async () => { throw new Error('offline'); };
  assert.deepEqual(Buffer.from(await loadMachineImageBytes('https://example.test/v1.jpg')), jpeg);
  assert.deepEqual(Buffer.from(await loadMachineImageBytes('https://example.test/v2.jpg')), jpeg);
  assert.equal(await loadMachineImageBytes('https://example.test/missing.jpg'), undefined);

  const { generateQuotePdf } = require('../src/lib/pdf/quote-pdf.ts');
  const { PDFDocument } = require('pdf-lib');
  const snapshot = {
    folio: 'VALIDACION-OME', createdAt: '2026-09-05T12:00:00Z',
    customer: { name: 'Cliente de prueba', company: null, whatsapp: '525555555555', email: null },
    sellerName: 'Vendedor', machine: { name: 'HYRO SET OME', basePrice: 249990, numberOfBases: 8, imageUrl: 'https://example.test/v2.jpg', variant: { type: 'AUTOMATIC', name: 'Automática', price: 249990, description: null } },
    addons: result.quoteAddons, subtotal: result.subtotal, discountAmount: 10000,
    total: result.subtotal - 10000, coupon: { code: 'EXPO', name: 'Expo', discountType: 'FIXED_AMOUNT', discountValue: 10000, discountAmount: 10000 },
    delivery: { type: 'LATER', note: null }, notes: null,
  };
  const logoBytes = await sharp(fs.readFileSync('public/brand/NAHUITECH LOGO.png')).trim().png().toBuffer();
  const bytes = await generateQuotePdf(snapshot, { logoBytes });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  fs.mkdirSync('tmp/pdfs', { recursive: true });
  fs.writeFileSync('tmp/pdfs/catalog-validation.pdf', bytes);
  console.log('PASS: A–E, FIXED/QUANTITY/PER_BASE, cent consistency, versioned offline bytes, PDF generated with network disabled.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
