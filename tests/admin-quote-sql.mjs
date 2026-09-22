import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Isolated test dependency; does not add a production dependency or use a URL.
// npm.cmd install --prefix tmp/sql-validation --no-save --package-lock=false @electric-sql/pglite
const moduleUrl = new URL('../tmp/sql-validation/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url);
export const hasLocalPostgres = existsSync(moduleUrl);

export async function verifyQuoteSql(t) {
  const { PGlite } = await import(moduleUrl.href);
  const db = new PGlite();
  const dir = 'supabase/migrations/';
  const signatures = [
    'public.preview_quote_coupon(uuid,jsonb,text)',
    'public.preview_quote_coupon(uuid,jsonb,text,uuid)',
    'public.preview_multi_quote_coupon(jsonb,text)',
    'public.create_quote(uuid,jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,text,uuid,uuid)',
    'public.create_multi_quote(jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,uuid)',
  ];
  try {
    // Minimal Supabase system schemas; all application schema/functions below
    // come unchanged from the repository migrations.
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
    `);
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql') && name < '20260922000029').sort()) {
      try { await db.exec(readFileSync(dir + file, 'utf8')); }
      catch (error) { throw new Error(`Fixture migration ${file}: ${error.message}`, { cause: error }); }
    }
    const metadata = async () => (await db.query(`
      select p.oid, p.oid::regprocedure::text as signature,
        pg_get_function_identity_arguments(p.oid) as identity_arguments,
        p.proowner, p.proacl::text, p.prosecdef, p.proconfig,
        l.lanname, p.prosrc
      from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid = any($1::regprocedure[]) order by p.oid
    `, [signatures])).rows;
    const before = await metadata();
    assert.equal(before.length, 5);

    await t.test('00029 failure rolls back; 00030 works independently and is repeatable', async () => {
      await assert.rejects(db.exec(readFileSync(dir + '20260922000029_admin_quote_access.sql', 'utf8')), /Expected exactly one role guard/);
      await db.exec('rollback;');
      assert.deepEqual(await metadata(), before);
      const sql = readFileSync(dir + '20260922000030_admin_quote_access_fix.sql', 'utf8');
      await db.exec(sql);
      const after = await metadata();
      await db.exec(sql);
      assert.deepEqual(await metadata(), after);
      const properties = (rows) => rows.map(({ prosrc, ...rest }) => { assert.ok(prosrc); return rest; });
      assert.deepEqual(properties(after), properties(before));
    });

    const advisor = randomUUID();
    const inactiveAdvisor = randomUUID();
    const machine = randomUUID();
    await db.query('insert into public.salespeople(id, full_name, active) values ($1, $2, true), ($3, $4, false)', [advisor, 'Commercial advisor', inactiveAdvisor, 'Inactive advisor']);
    await db.query(`insert into public.machines(id,name,slug,short_description,base_price,number_of_bases)
      values ($1,'Test machine','admin-access-test','Test',1160,1)`, [machine]);
    await db.exec("insert into public.coupons(name,code,discount_type,discount_value) values ('Test','ADMIN-TEST','PERCENTAGE',10)");
    const items = JSON.stringify([{ machine_id: machine, addon_quantities: {}, quantity: 2, delivery_type: 'LATER' }]);
    const calls = [
      ['preview legacy', 'select * from public.preview_quote_coupon($1::uuid,$2::jsonb,$3::text)', [machine, '{}', 'ADMIN-TEST']],
      ['preview variant', 'select * from public.preview_quote_coupon($1::uuid,$2::jsonb,$3::text,$4::uuid)', [machine, '{}', 'ADMIN-TEST', null]],
      ['preview multi', 'select * from public.preview_multi_quote_coupon($1::jsonb,$2::text)', [items, 'ADMIN-TEST']],
      ['create single', `select * from public.create_quote($1::uuid,$2::jsonb,'Customer','','5555555555','','LATER'::public.quote_delivery_type,'ADMIN-TEST',null::uuid,null::text,null::text,null::uuid,$3::uuid)`, [machine, '{}', advisor]],
      ['create multi', `select * from public.create_multi_quote($1::jsonb,'Customer','','5555555555','','LATER'::public.quote_delivery_type,'ADMIN-TEST',null::uuid,null::text,$2::uuid)`, [items, advisor]],
    ];
    for (const role of ['admin', 'seller', 'expo']) {
      const id = randomUUID();
      await db.query('insert into auth.users(id,email) values ($1,$2)', [id, `${role}@example.test`]);
      await db.query('update public.profiles set role=$1::public.profile_role, salesperson_id=$2 where id=$3', [role, role === 'seller' ? advisor : null, id]);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      await db.exec('set role authenticated;');
      for (const [name, sql, params] of calls) {
        await t.test(`${role}: ${name}`, async () => {
          const result = (await db.query(sql, params)).rows[0];
          assert.equal(Number(result.total), name.includes('multi') ? 2088 : 1044);
          if (name.startsWith('create')) {
            const quote = (await db.query('select created_by_user_id,salesperson_id,salesperson_name_snapshot from public.quotes where id=$1', [result.quote_id])).rows[0];
            assert.equal(quote.created_by_user_id, id);
            assert.equal(quote.salesperson_id, advisor);
            assert.equal(quote.salesperson_name_snapshot, 'Commercial advisor');
          }
        });
      }
      if (role !== 'seller') {
        for (const [name, sql, params] of calls.filter(([name]) => name.startsWith('create'))) {
          await t.test(`${role}: ${name} rejects missing/inactive salesperson`, async () => {
            for (const value of [null, inactiveAdvisor]) {
              const invalid = [...params]; invalid[invalid.length - 1] = value;
              await assert.rejects(db.query(sql, invalid), /must select an active salesperson|selected salesperson is not available/i);
            }
          });
        }
      }
      await db.exec('reset role;');
      await db.query('update public.profiles set active=false where id=$1', [id]);
      await db.exec('set role authenticated;');
      for (const [name, sql, params] of calls) {
        await t.test(`inactive ${role}: ${name} rejected`, async () => {
          await assert.rejects(db.query(sql, params), /Only active/);
        });
      }
      await db.exec('reset role;');
    }
    // Current enum contains only the three allowed roles. Add a test-only role
    // to prove an arbitrary authenticated profile is still rejected.
    await db.exec("alter type public.profile_role add value 'test_unprivileged'");
    const denied = randomUUID();
    await db.query('insert into auth.users(id) values ($1)', [denied]);
    await db.query("update public.profiles set role='test_unprivileged' where id=$1", [denied]);
    for (const identity of [denied, randomUUID(), '']) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [identity]);
      await db.exec('set role authenticated;');
      for (const [name, sql, params] of calls) {
        await t.test(`unauthorized identity ${identity || 'anonymous'}: ${name} rejected`, async () => {
          await assert.rejects(db.query(sql, params), /Only active|Authentication is required/);
        });
      }
      await db.exec('reset role;');
    }
  } finally {
    await db.close();
  }
}
